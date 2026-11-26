import { alphaBeta, applyMove } from "./ai";
import { MAX_PATTERNS } from "./constants";
import {
  checkGameOverState,
  cloneBoard,
  countTowers,
  emptyBoard,
  generateAllLegalMoves,
  getBannedShape,
  getFeatureVector,
  hashBoard,
  hashMove,
  startingInventory,
} from "./rules";
import type {
  AIWeights,
  Color,
  FullLegalMove,
  GameRecord,
  Inventory,
  LastMove,
  LostPattern,
  Shape,
  WinPattern,
} from "./types";

export function runSelfPlayGame(
  weights: AIWeights,
  lostPatterns: LostPattern[],
  winPatterns: WinPattern[],
  epsilon: number,
): GameRecord {
  let board = emptyBoard();
  let inv: Inventory = startingInventory();
  let lastMove: LastMove | null = null;
  let whiteFirst: Shape | null = null;
  let player: Color = "white";
  let moveCount = 0;
  const moves: GameRecord["moves"] = [];

  while (moveCount < 120) {
    const banned = getBannedShape(player, moveCount, whiteFirst);
    const legals = generateAllLegalMoves(board, lastMove, inv[player], banned);
    const towers = countTowers(board);
    const check = checkGameOverState(board, legals.length, towers);

    if (check.isOver) {
      return {
        moves,
        winner: check.winner || "draw",
        loser: check.winner ? (check.winner === "white" ? "black" : "white") : null,
      };
    }

    const opp: Color = player === "white" ? "black" : "white";
    const oppBanned = getBannedShape(opp, moveCount, whiteFirst);
    const oppMoves = generateAllLegalMoves(board, lastMove, inv[opp], oppBanned).length;
    const whiteMovesCount = player === "white" ? legals.length : oppMoves;
    const blackMovesCount = player === "black" ? legals.length : oppMoves;
    const features = getFeatureVector(board, whiteMovesCount, blackMovesCount, inv);

    let selectedMove: FullLegalMove;
    if (Math.random() < epsilon) {
      selectedMove = legals[Math.floor(Math.random() * legals.length)];
    } else {
      const stats = { nodes: 0, patternsAvoided: 0 };
      const result = alphaBeta(
        board,
        lastMove,
        whiteFirst,
        moveCount,
        2,
        -Infinity,
        Infinity,
        player === "white",
        inv,
        weights,
        stats,
        lostPatterns,
        winPatterns,
      );
      selectedMove = result.move || legals[Math.floor(Math.random() * legals.length)];
    }

    const boardCopy = cloneBoard(board);
    moves.push({ board: boardCopy, move: { ...selectedMove }, player, features });

    const applied = applyMove(board, inv, selectedMove, player);
    board = applied.board;
    inv = applied.inv;

    if (moveCount === 0 && player === "white") {
      whiteFirst = selectedMove.shape;
    }

    lastMove = {
      shape: selectedMove.shape,
      row: selectedMove.row,
      col: selectedMove.col,
      dir: selectedMove.dir,
      by: player,
    };

    player = player === "white" ? "black" : "white";
    moveCount++;
  }

  return { moves, winner: "draw", loser: null };
}

export function extractLearningPatterns(
  gameRecord: GameRecord,
  lostPatterns: LostPattern[],
  winPatterns: WinPattern[],
): { newLostPatterns: LostPattern[]; newWinPatterns: WinPattern[] } {
  const newLostPatterns: LostPattern[] = [];
  const newWinPatterns: WinPattern[] = [];

  if (gameRecord.winner === "draw") {
    return { newLostPatterns, newWinPatterns };
  }

  const loser = gameRecord.loser!;
  const winner = gameRecord.winner as Color;

  const loserMoves = gameRecord.moves.filter((m) => m.player === loser);
  const criticalMoves = loserMoves.slice(-5);

  for (const m of criticalMoves) {
    const boardHash = hashBoard(m.board, m.player);
    const exists = lostPatterns.some((p) => p.boardHash === boardHash && hashMove(p.move) === hashMove(m.move));
    if (!exists) {
      newLostPatterns.push({
        boardHash,
        features: m.features,
        move: m.move,
        player: m.player,
        gamePhase: gameRecord.moves.indexOf(m),
        timestamp: Date.now(),
      });
    }
  }

  const winnerMoves = gameRecord.moves.filter((m) => m.player === winner);
  const winnerCritical = winnerMoves.slice(-3);

  for (const m of winnerCritical) {
    const boardHash = hashBoard(m.board, m.player);
    const exists = winPatterns.some((p) => p.boardHash === boardHash && hashMove(p.move) === hashMove(m.move));
    if (!exists) {
      newWinPatterns.push({
        boardHash,
        features: m.features,
        move: m.move,
        player: m.player,
        gamePhase: gameRecord.moves.indexOf(m),
        timestamp: Date.now(),
      });
    }
  }

  return { newLostPatterns, newWinPatterns };
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

const WEIGHT_KEYS: (keyof AIWeights)[] = [
  "tower","partial2","partial1","mobility","sqInv","trInv","ciInv","center","completion","patternAvoid",
  "threat","oppThreat","doubleThreat","lineControl","cornerControl","shapeDiversity",
];

export function sanitizeWeights(weights: AIWeights, defaults: AIWeights): AIWeights {
  const out = { ...defaults };
  for (const k of WEIGHT_KEYS) {
    const val = (weights as any)[k];
    const num = typeof val === "number" && Number.isFinite(val) ? val : defaults[k];
    out[k] = clamp(num, -5000, 5000);
  }
  out.patternAvoid = clamp(out.patternAvoid, 0, 5000);
  out.tower = clamp(out.tower, 100, 5000);
  out.completion = clamp(out.completion, 0, 5000);
  out.threat = clamp(out.threat, 0, 5000);
  out.oppThreat = clamp(out.oppThreat, 0, 5000);
  out.doubleThreat = clamp(out.doubleThreat, 0, 5000);
  return out;
}

export function updateWeightsTD(weights: AIWeights, gameRecord: GameRecord, learningRate: number): AIWeights {
  const newWeights = { ...weights };
  if (gameRecord.winner === "draw" || gameRecord.moves.length === 0) return newWeights;

  const terminal = gameRecord.winner === "white" ? 1.0 : -1.0;
  const gamma = 0.98;
  const lambda = 0.8;
  const lr = clamp(learningRate, 0.0001, 0.05);
  const maxAbsDelta = 4;

  const keys: (keyof AIWeights)[] = ["tower","partial2","partial1","mobility","sqInv","trInv","ciInv","center","completion","threat","oppThreat","doubleThreat","lineControl","cornerControl","shapeDiversity"];

  const valueOf = (f: AIWeights) =>
    f.tower * weights.tower +
    f.partial2 * weights.partial2 +
    f.partial1 * weights.partial1 +
    f.mobility * weights.mobility +
    f.sqInv * weights.sqInv +
    f.trInv * weights.trInv +
    f.ciInv * weights.ciInv +
    f.center * weights.center +
    f.completion * weights.completion +
    f.threat * weights.threat -
    f.oppThreat * weights.oppThreat +
    f.doubleThreat * weights.doubleThreat +
    f.lineControl * weights.lineControl +
    f.cornerControl * weights.cornerControl +
    f.shapeDiversity * weights.shapeDiversity;

  const values = gameRecord.moves.map((m) => valueOf(m.features));
  const n = gameRecord.moves.length;
  const returns: number[] = new Array(n).fill(0);
  returns[n - 1] = terminal * 1000;
  for (let i = n - 2; i >= 0; i--) {
    const nextV = values[i + 1];
    returns[i] = terminal * 1000 * Math.pow(gamma, (n - 1 - i)) * 0.15 + gamma * ((1 - lambda) * nextV + lambda * returns[i + 1]);
  }

  const accum: Record<string, number> = {};
  for (const k of keys) accum[k] = 0;
  for (let i = 0; i < n; i++) {
    const tdError = clamp(returns[i] - values[i], -4000, 4000);
    const f = gameRecord.moves[i].features;
    for (const k of keys) {
      const sign = k === "oppThreat" ? -1 : 1;
      accum[k] += tdError * sign * clamp(f[k] || 0, -10, 10);
    }
  }

  for (const k of keys) {
    const delta = clamp((lr * accum[k]) / Math.max(1, n), -maxAbsDelta, maxAbsDelta);
    newWeights[k] = clamp((newWeights[k] as number) + delta, -2000, 5000);
  }

  newWeights.tower = clamp(newWeights.tower, 100, 5000);
  newWeights.completion = clamp(newWeights.completion, 0, 5000);
  newWeights.patternAvoid = clamp(newWeights.patternAvoid, 0, 5000);
  newWeights.threat = clamp(newWeights.threat, 0, 5000);
  newWeights.oppThreat = clamp(newWeights.oppThreat, 0, 5000);
  newWeights.doubleThreat = clamp(newWeights.doubleThreat, 0, 5000);
  return newWeights;
}

export function appendBoundedPatterns<T>(existing: T[], incoming: T[], max: number = MAX_PATTERNS): T[] {
  if (incoming.length === 0) return existing;
  return [...existing, ...incoming].slice(-max);
}


export function evaluateAgainstBaseline(
  weights: AIWeights,
  baseline: AIWeights,
  games: number = 20,
): { wins: number; losses: number; draws: number } {
  let wins = 0, losses = 0, draws = 0;
  for (let g = 0; g < games; g++) {
    const candidatePlaysWhite = g % 2 === 0;
    let board = emptyBoard();
    let inv: Inventory = startingInventory();
    let lastMove: LastMove | null = null;
    let whiteFirst: Shape | null = null;
    let player: Color = "white";
    let moveCount = 0;
    while (moveCount < 120) {
      const banned = getBannedShape(player, moveCount, whiteFirst);
      const legals = generateAllLegalMoves(board, lastMove, inv[player], banned);
      const towers = countTowers(board);
      const check = checkGameOverState(board, legals.length, towers);
      if (check.isOver) {
        if (check.winner === "draw" || !check.winner) draws++;
        else {
          const candidateWon = (check.winner === "white") === candidatePlaysWhite;
          if (candidateWon) wins++; else losses++;
        }
        break;
      }
      const isCandidate = (player === "white") === candidatePlaysWhite;
      const useWeights = isCandidate ? weights : baseline;
      const stats = { nodes: 0, patternsAvoided: 0 };
      const result = alphaBeta(board, lastMove, whiteFirst, moveCount, 2, -Infinity, Infinity, player === "white", inv, useWeights, stats, [], []);
      const selectedMove = result.move || legals[0];
      const applied = applyMove(board, inv, selectedMove, player);
      board = applied.board; inv = applied.inv;
      if (moveCount === 0 && player === "white") whiteFirst = selectedMove.shape;
      lastMove = { shape: selectedMove.shape, row: selectedMove.row, col: selectedMove.col, dir: selectedMove.dir, by: player };
      player = player === "white" ? "black" : "white";
      moveCount++;
      if (moveCount >= 120) { draws++; break; }
    }
  }
  return { wins, losses, draws };
}
