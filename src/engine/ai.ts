import { WIN_SCORE } from "./constants";
import {
  cloneBoard,
  cloneInventory,
  countTowers,
  checkGameOverState,
  featureSimilarity,
  generateAllLegalMoves,
  getBannedShape,
  getFeatureVector,
  hashBoard,
  hashMove,
  pieceCounts,
} from "./rules";
import type {
  AIWeights,
  Cell,
  Color,
  FullLegalMove,
  Inventory,
  LastMove,
  LostPattern,
  SearchStats,
  Shape,
  WinPattern,
} from "./types";

function tacticalThreatScore(board: Cell[][], inv: Inventory): number {
  let whiteThreats = 0;
  let blackThreats = 0;
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const cell = board[r][c];
      const pieces = pieceCounts(cell);
      const sum = pieces.white + pieces.black;
      if (sum !== 2) continue;
      const missing: "square" | "triangle" | "circle" = !cell.square ? "square" : !cell.triangle ? "triangle" : "circle";
      // Immediate tower-completion threat if player can place missing shape and would own tower.
      if (inv.white[missing] > 0 && pieces.white + 1 >= 2 && pieces.white + 1 > pieces.black) whiteThreats++;
      if (inv.black[missing] > 0 && pieces.black + 1 >= 2 && pieces.black + 1 > pieces.white) blackThreats++;
    }
  }
  return (whiteThreats - blackThreats) * 120;
}

function evaluateBoard(
  board: Cell[][],
  whiteMovesCount: number,
  blackMovesCount: number,
  inv: Inventory,
  weights: AIWeights,
  currentMove: FullLegalMove | null,
  currentPlayer: Color,
  lostPatterns: LostPattern[],
  winPatterns: WinPattern[],
): number {
  const f = getFeatureVector(board, whiteMovesCount, blackMovesCount, inv);

  let baseScore =
    f.tower * weights.tower +
    f.partial2 * weights.partial2 +
    f.partial1 * weights.partial1 +
    f.mobility * weights.mobility +
    f.sqInv * weights.sqInv +
    f.trInv * weights.trInv +
    f.ciInv * weights.ciInv +
    f.center * weights.center +
    f.completion * weights.completion +
    tacticalThreatScore(board, inv);

  if (currentMove && lostPatterns.length > 0) {
    const boardHash = hashBoard(board, currentPlayer);

    for (const lp of lostPatterns) {
      if (lp.boardHash === boardHash && lp.player === currentPlayer) {
        const moveHash = hashMove(currentMove);
        const lpMoveHash = hashMove(lp.move);
        if (moveHash === lpMoveHash) {
          baseScore -= weights.patternAvoid * 2;
        }
      }

      const similarity = featureSimilarity(f, lp.features);
      if (similarity > 0.85 && lp.player === currentPlayer) {
        const moveHash = hashMove(currentMove);
        const lpMoveHash = hashMove(lp.move);
        if (moveHash === lpMoveHash) {
          baseScore -= weights.patternAvoid * similarity;
        }
      }
    }
  }

  if (currentMove && winPatterns.length > 0) {
    const boardHash = hashBoard(board, currentPlayer);

    for (const wp of winPatterns) {
      if (wp.boardHash === boardHash && wp.player === currentPlayer) {
        const moveHash = hashMove(currentMove);
        const wpMoveHash = hashMove(wp.move);
        if (moveHash === wpMoveHash) {
          baseScore += weights.patternAvoid * 0.5;
        }
      }
    }
  }

  return baseScore;
}

function scoreMoveHeuristically(m: FullLegalMove, board: Cell[][], player: Color): number {
  let score = 0;
  const cell = board[m.row][m.col];
  const pieces = pieceCounts(cell);

  if (!cell[m.shape]) {
    const sum = pieces.white + pieces.black;
    if (sum === 2) {
      if (pieces[player] >= 1) score += 2000;
      else score -= 200;
    }
  }

  if (m.row >= 1 && m.row <= 2 && m.col >= 1 && m.col <= 2) {
    score += 30;
  }

  if (m.shape === "circle") score += 5;
  if (m.shape === "triangle") score += 2;

  return score;
}

export function applyMove(board: Cell[][], inv: Inventory, m: FullLegalMove, player: Color): { board: Cell[][]; inv: Inventory } {
  const nextBoard = cloneBoard(board);
  const nextInv = cloneInventory(inv);

  if (m.shape === "square") nextBoard[m.row][m.col].square = player;
  else if (m.shape === "triangle") nextBoard[m.row][m.col].triangle = { color: player, dir: m.dir! };
  else nextBoard[m.row][m.col].circle = player;

  nextInv[player][m.shape]--;
  return { board: nextBoard, inv: nextInv };
}

export interface AlphaBetaOptions {
  useTranspositionTable?: boolean;
  transpositionTable?: Map<string, { depth: number; score: number; flag: "exact" | "lower" | "upper"; move: FullLegalMove | null }>;
  nodeLimit?: number;
  deadlineMs?: number;
}

export function alphaBeta(
  board: Cell[][],
  lastMove: LastMove | null,
  whiteFirstShape: Shape | null,
  historyLen: number,
  depth: number,
  alpha: number,
  beta: number,
  isMax: boolean,
  inv: Inventory,
  weights: AIWeights,
  stats: SearchStats,
  lostPatterns: LostPattern[],
  winPatterns: WinPattern[],
  currentMove: FullLegalMove | null = null,
  options: AlphaBetaOptions = {},
): { score: number; move: FullLegalMove | null } {
  stats.nodes++;
  if ((options.nodeLimit && stats.nodes > options.nodeLimit) || (options.deadlineMs && (stats.nodes & 1023) === 0 && Date.now() > options.deadlineMs)) {
    const wMoves = generateAllLegalMoves(board, lastMove, inv.white, getBannedShape("white", historyLen, whiteFirstShape)).length;
    const bMoves = generateAllLegalMoves(board, lastMove, inv.black, getBannedShape("black", historyLen, whiteFirstShape)).length;
    return { score: evaluateBoard(board, wMoves, bMoves, inv, weights, currentMove, isMax ? "white" : "black", lostPatterns, winPatterns), move: null };
  }

  const currentPlayer: Color = isMax ? "white" : "black";
  const bannedShape = getBannedShape(currentPlayer, historyLen, whiteFirstShape);

  const alphaOrig = alpha;
  const betaOrig = beta;
  const ttKey = options.useTranspositionTable
    ? `${hashBoard(board, currentPlayer)}|${historyLen}`
    : null;
  if (ttKey && options.transpositionTable) {
    const hit = options.transpositionTable.get(ttKey);
    if (hit && hit.depth >= depth) {
      if (hit.flag === "exact") return { score: hit.score, move: hit.move };
      if (hit.flag === "lower") alpha = Math.max(alpha, hit.score);
      else if (hit.flag === "upper") beta = Math.min(beta, hit.score);
      if (alpha >= beta) return { score: hit.score, move: hit.move };
    }
  }

  const moves = generateAllLegalMoves(board, lastMove, inv[currentPlayer], bannedShape);
  const towers = countTowers(board);

  const goState = checkGameOverState(board, moves.length, towers);
  if (goState.isOver) {
    if (goState.winner === "white") return { score: WIN_SCORE + depth, move: null };
    if (goState.winner === "black") return { score: -WIN_SCORE - depth, move: null };
    return { score: 0, move: null };
  }

  if (depth === 0) {
    const opp: Color = isMax ? "black" : "white";
    const oppBanned = getBannedShape(opp, historyLen, whiteFirstShape);
    const oppMovesCount = generateAllLegalMoves(board, lastMove, inv[opp], oppBanned).length;
    const whiteMovesCount = isMax ? moves.length : oppMovesCount;
    const blackMovesCount = isMax ? oppMovesCount : moves.length;
    const score = evaluateBoard(board, whiteMovesCount, blackMovesCount, inv, weights, currentMove, currentPlayer, lostPatterns, winPatterns);
    return { score, move: null };
  }

  // Move ordering: heuristic + TT move preference
  const ttMove = ttKey && options.transpositionTable ? options.transpositionTable.get(ttKey)?.move : null;
  const scoredMoves = moves
    .map((m) => {
      let hScore = scoreMoveHeuristically(m, board, currentPlayer);
      if (ttMove && m.row === ttMove.row && m.col === ttMove.col && m.shape === ttMove.shape && m.dir === ttMove.dir) hScore += 10000;
      return { move: m, hScore };
    })
    .sort((a, b) => b.hScore - a.hScore);

  let bestMove: FullLegalMove | null = null;

  if (isMax) {
    let maxEval = -Infinity;
    for (const sm of scoredMoves) {
      const m = sm.move;
      const { board: nextBoard, inv: nextInv } = applyMove(board, inv, m, "white");
      const nextLast: LastMove = { shape: m.shape, row: m.row, col: m.col, dir: m.dir, by: "white" };
      const evalResult = alphaBeta(nextBoard, nextLast, whiteFirstShape, historyLen + 1, depth - 1, alpha, beta, false, nextInv, weights, stats, lostPatterns, winPatterns, m, options);
      if (evalResult.score > maxEval) { maxEval = evalResult.score; bestMove = m; }
      alpha = Math.max(alpha, evalResult.score);
      if (beta <= alpha) break;
    }
    if (ttKey && options.transpositionTable) {
      const flag = maxEval <= alphaOrig ? "upper" : maxEval >= betaOrig ? "lower" : "exact";
      options.transpositionTable.set(ttKey, { depth, score: maxEval, flag, move: bestMove });
    }
    return { score: maxEval, move: bestMove };
  }

  let minEval = Infinity;
  for (const sm of scoredMoves) {
    const m = sm.move;
    const { board: nextBoard, inv: nextInv } = applyMove(board, inv, m, "black");
    const nextLast: LastMove = { shape: m.shape, row: m.row, col: m.col, dir: m.dir, by: "black" };
    const evalResult = alphaBeta(nextBoard, nextLast, whiteFirstShape, historyLen + 1, depth - 1, alpha, beta, true, nextInv, weights, stats, lostPatterns, winPatterns, m, options);
    if (evalResult.score < minEval) { minEval = evalResult.score; bestMove = m; }
    beta = Math.min(beta, evalResult.score);
    if (beta <= alpha) break;
  }
  if (ttKey && options.transpositionTable) {
    const flag = minEval <= alphaOrig ? "upper" : minEval >= betaOrig ? "lower" : "exact";
    options.transpositionTable.set(ttKey, { depth, score: minEval, flag, move: bestMove });
  }
  return { score: minEval, move: bestMove };
}

export interface AIMoveOptions {
  enableOpeningBook?: boolean;
  enableTemperature?: boolean;
  enableTransposition?: boolean;
  temperature?: number;
  nodeLimit?: number;
  timeLimitMs?: number;
}

export function getAIMove(
  board: Cell[][],
  lastMove: LastMove | null,
  whiteFirstShape: Shape | null,
  historyLen: number,
  player: Color,
  inv: Inventory,
  weights: AIWeights,
  difficulty: "easy" | "normal" | "hard" | "master",
  lostPatterns: LostPattern[],
  winPatterns: WinPattern[],
  options: AIMoveOptions = {},
): { move: FullLegalMove; stats: SearchStats & { eval: number } } {
  const isMax = player === "white";
  const bannedShape = getBannedShape(player, historyLen, whiteFirstShape);
  const moves = generateAllLegalMoves(board, lastMove, inv[player], bannedShape);

  if (moves.length === 0) throw new Error("No legal moves available for AI");

  if (difficulty === "easy") {
    const m = moves[Math.floor(Math.random() * moves.length)];
    return { move: m, stats: { nodes: 1, patternsAvoided: 0, eval: 0 } };
  }

  if (options.enableOpeningBook && historyLen < 6 && winPatterns.length > 0) {
    const boardHash = hashBoard(board, player);
    const candidates = winPatterns.filter((wp) => wp.player === player && wp.boardHash === boardHash);
    for (const wp of candidates) {
      const found = moves.find((m) => hashMove(m) === hashMove(wp.move));
      if (found) return { move: found, stats: { nodes: 0, patternsAvoided: 0, eval: 0 } };
    }
  }

  const maxDepth = difficulty === "normal" ? 2 : difficulty === "hard" ? 3 : 4;
  const stats: SearchStats = { nodes: 0, patternsAvoided: 0 };
  const tt = options.enableTransposition ? new Map<string, { depth: number; score: number; flag: "exact" | "lower" | "upper"; move: FullLegalMove | null }>() : undefined;
  const nodeLimit = options.nodeLimit ?? (difficulty === "master" ? 40000 : 15000);
  const deadlineMs = Date.now() + (options.timeLimitMs ?? (difficulty === "master" ? 1800 : difficulty === "hard" ? 900 : 450));

  if (options.enableTemperature) {
    const temp = Math.max(0.1, options.temperature ?? 0.5);
    const scored = moves.map((m) => {
      const { board: nextBoard, inv: nextInv } = applyMove(board, inv, m, player);
      const nextLast: LastMove = { shape: m.shape, row: m.row, col: m.col, dir: m.dir, by: player };
      const res = alphaBeta(nextBoard, nextLast, whiteFirstShape, historyLen + 1, Math.max(1, maxDepth - 1), -Infinity, Infinity, !isMax, nextInv, weights, stats, lostPatterns, winPatterns, m, { useTranspositionTable: !!options.enableTransposition, transpositionTable: tt, nodeLimit, deadlineMs });
      return { move: m, score: isMax ? res.score : -res.score };
    }).sort((a, b) => b.score - a.score);
    const top = scored.slice(0, Math.min(5, scored.length));
    const maxScore = top[0].score;
    const exps = top.map((t) => Math.exp((t.score - maxScore) / Math.max(1, temp * 500)));
    const sum = exps.reduce((a, b) => a + b, 0);
    let r = Math.random() * sum;
    for (let i = 0; i < top.length; i++) { r -= exps[i]; if (r <= 0) return { move: top[i].move, stats: { ...stats, eval: isMax ? top[i].score : -top[i].score } }; }
    return { move: top[0].move, stats: { ...stats, eval: isMax ? top[0].score : -top[0].score } };
  }

  // Iterative deepening: keep best move from last completed depth.
  let bestMove: FullLegalMove | null = null;
  let bestScore = isMax ? -Infinity : Infinity;
  for (let d = 1; d <= maxDepth; d++) {
    const res = alphaBeta(board, lastMove, whiteFirstShape, historyLen, d, -Infinity, Infinity, isMax, inv, weights, stats, lostPatterns, winPatterns, null, { useTranspositionTable: !!options.enableTransposition, transpositionTable: tt, nodeLimit, deadlineMs });
    if (res.move) { bestMove = res.move; bestScore = res.score; }
    if ((options.nodeLimit && stats.nodes > options.nodeLimit) || Date.now() > deadlineMs) break;
    if (Math.abs(res.score) >= WIN_SCORE) break; // found forced win/loss
  }

  return { move: bestMove || moves[Math.floor(Math.random() * moves.length)], stats: { ...stats, eval: bestScore } };
}
