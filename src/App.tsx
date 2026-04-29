import { useMemo, useState, useEffect, useCallback } from "react";

// ============================================================
// Types
// ============================================================
type Color = "white" | "black";
type Shape = "square" | "triangle" | "circle";
type Direction = "up" | "down" | "left" | "right";

interface Cell {
  square: Color | null;
  triangle: { color: Color; dir: Direction } | null;
  circle: Color | null;
}

interface LastMove {
  shape: Shape;
  row: number;
  col: number;
  dir?: Direction;
  by: Color;
}

interface LegalMove {
  row: number;
  col: number;
  shape: Shape;
}

interface FullLegalMove {
  row: number;
  col: number;
  shape: Shape;
  dir?: Direction;
}

type Inventory = Record<Color, Record<Shape, number>>;

// 強化学習の特徴量ウェイト
interface AIWeights {
  tower: number;
  partial2: number;
  partial1: number;
  mobility: number;
  sqInv: number; // ■残り数の差
  trInv: number; // ▲残り数の差
  ciInv: number; // ●残り数の差
  center: number;
  completion: number;
  // パターン回避重み
  patternAvoid: number;
}

// 盤面のハッシュ（簡易版）
type BoardHash = string;

// 負けパターン記録
interface LostPattern {
  boardHash: BoardHash;
  features: AIWeights;
  move: FullLegalMove;
  player: Color;
  gamePhase: number; // ゲームの進行度（手数）
  timestamp: number;
}

// 勝ちパターン記録
interface WinPattern {
  boardHash: BoardHash;
  features: AIWeights;
  move: FullLegalMove;
  player: Color;
  gamePhase: number;
  timestamp: number;
}

// 盤面アーカイブ
interface SavedGame {
  id: string;
  name: string;
  winner: Color | "draw";
  moveCount: number;
  date: string;
  board: Cell[][];
  lastMove: LastMove | null;
}

// 学習履歴
interface LearningHistory {
  totalGames: number;
  whiteWins: number;
  blackWins: number;
  draws: number;
  patternsLearned: number;
  lastUpdateTime: number;
}

// ============================================================
// Constants & Pure Game Logic
// ============================================================
const SIZE = 4;
const SHAPES: Shape[] = ["square", "triangle", "circle"];
const DIRS: Direction[] = ["up", "right", "down", "left"];

const DEFAULT_WEIGHTS: AIWeights = {
  tower: 1200.0,
  partial2: 180.0,
  partial1: 40.0,
  mobility: 25.0,
  sqInv: 15.0,
  trInv: 15.0,
  ciInv: 15.0,
  center: 10.0,
  completion: 350.0,
  patternAvoid: 200.0,
};

const WIN_SCORE = 1000000;
const MAX_PATTERNS = 500; // 保存するパターンの最大数

function emptyBoard(): Cell[][] {
  return Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () => ({
      square: null,
      triangle: null,
      circle: null,
    })),
  );
}

function startingInventory(): Inventory {
  return {
    white: { square: 5, triangle: 5, circle: 5 },
    black: { square: 5, triangle: 5, circle: 5 },
  };
}

function dirVector(dir: Direction): [number, number] {
  switch (dir) {
    case "up": return [-1, 0];
    case "down": return [1, 0];
    case "left": return [0, -1];
    case "right": return [0, 1];
  }
}

function inBounds(r: number, c: number) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

function isDirValidForCell(row: number, col: number, dir: Direction): boolean {
  const [dr, dc] = dirVector(dir);
  return inBounds(row + dr, col + dc);
}

function rule2Cells(lastMove: LastMove | null): { row: number; col: number }[] {
  if (!lastMove) return [];
  if (lastMove.shape === "square") {
    return [
      [-1, 0], [1, 0], [0, -1], [0, 1],
    ]
      .map(([dr, dc]) => ({ row: lastMove.row + dr, col: lastMove.col + dc }))
      .filter(({ row, col }) => inBounds(row, col));
  }
  if (lastMove.shape === "circle") {
    return [{ row: lastMove.row, col: lastMove.col }];
  }
  const out: { row: number; col: number }[] = [];
  const [dr, dc] = dirVector(lastMove.dir!);
  let r = lastMove.row + dr;
  let c = lastMove.col + dc;
  while (inBounds(r, c)) {
    out.push({ row: r, col: c });
    r += dr;
    c += dc;
  }
  return out;
}

function canPlace(cell: Cell, shape: Shape): boolean {
  return cell[shape] === null;
}

function isCellEmpty(cell: Cell): boolean {
  return cell.square === null && cell.triangle === null && cell.circle === null;
}

function getLegalMoves(
  board: Cell[][],
  lastMove: LastMove | null,
  inventory: Record<Shape, number>,
  bannedShape: Shape | null,
): { moves: LegalMove[]; fallback: boolean } {
  const moves: LegalMove[] = [];
  if (lastMove) {
    for (const { row, col } of rule2Cells(lastMove)) {
      for (const shape of SHAPES) {
        if (shape === bannedShape) continue;
        if (inventory[shape] > 0 && canPlace(board[row][col], shape)) {
          moves.push({ row, col, shape });
        }
      }
    }
    if (moves.length > 0) return { moves, fallback: false };
  }
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (isCellEmpty(board[r][c])) {
        for (const shape of SHAPES) {
          if (shape === bannedShape) continue;
          if (inventory[shape] > 0) {
            moves.push({ row: r, col: c, shape });
          }
        }
      }
    }
  }
  return { moves, fallback: lastMove !== null };
}

function generateAllLegalMoves(
  board: Cell[][],
  lastMove: LastMove | null,
  inventory: Record<Shape, number>,
  bannedShape: Shape | null,
): FullLegalMove[] {
  const base = getLegalMoves(board, lastMove, inventory, bannedShape);
  const out: FullLegalMove[] = [];
  for (const m of base.moves) {
    if (m.shape === "triangle") {
      for (const d of DIRS) {
        if (isDirValidForCell(m.row, m.col, d)) {
          out.push({ row: m.row, col: m.col, shape: "triangle", dir: d });
        }
      }
    } else {
      out.push({ row: m.row, col: m.col, shape: m.shape });
    }
  }
  return out;
}

function towerComplete(cell: Cell): boolean {
  return cell.square !== null && cell.triangle !== null && cell.circle !== null;
}

function pieceCounts(cell: Cell): Record<Color, number> {
  const counts: Record<Color, number> = { white: 0, black: 0 };
  if (cell.square) counts[cell.square]++;
  if (cell.triangle) counts[cell.triangle.color]++;
  if (cell.circle) counts[cell.circle]++;
  return counts;
}

function towerOwner(cell: Cell): Color | null {
  if (!towerComplete(cell)) return null;
  const c = pieceCounts(cell);
  if (c.white > c.black) return "white";
  if (c.black > c.white) return "black";
  return null;
}

function partialOwner(cell: Cell, requiredCount: number): Color | null {
  if (towerComplete(cell)) return null;
  const c = pieceCounts(cell);
  if (c.white >= requiredCount && c.white > c.black) return "white";
  if (c.black >= requiredCount && c.black > c.white) return "black";
  return null;
}

function countTowers(board: Cell[][]) {
  let white = 0;
  let black = 0;
  for (const row of board) for (const cell of row) {
    const o = towerOwner(cell);
    if (o === "white") white++;
    else if (o === "black") black++;
  }
  return { white, black };
}

function checkGameOverState(board: Cell[][], legalCount: number, towers: { white: number; black: number }): { isOver: boolean; winner: Color | "draw" | null } {
  if (towers.white >= 3) return { isOver: true, winner: "white" };
  if (towers.black >= 3) return { isOver: true, winner: "black" };
  
  if (legalCount === 0) {
    if (towers.white > towers.black) return { isOver: true, winner: "white" };
    if (towers.black > towers.white) return { isOver: true, winner: "black" };
    
    for (const need of [2, 1]) {
      let w = 0, b = 0;
      for (const r of board) for (const c of r) {
        const po = partialOwner(c, need);
        if (po === "white") w++;
        else if (po === "black") b++;
      }
      if (w > b) return { isOver: true, winner: "white" };
      if (b > w) return { isOver: true, winner: "black" };
    }
    return { isOver: true, winner: "draw" };
  }
  return { isOver: false, winner: null };
}

// 盤面のハッシュを生成（簡易版）
function hashBoard(board: Cell[][], currentPlayer: Color): BoardHash {
  let hash = currentPlayer === "white" ? "W" : "B";
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = board[r][c];
      const sq = cell.square ? (cell.square === "white" ? "S" : "s") : ".";
      const tr = cell.triangle ? (cell.triangle.color === "white" ? "T" : "t") : ".";
      const ci = cell.circle ? (cell.circle === "white" ? "C" : "c") : ".";
      hash += sq + tr + ci;
    }
  }
  return hash;
}

// 手のハッシュ
function hashMove(m: FullLegalMove): string {
  return `${m.row}${m.col}${m.shape}${m.dir || ""}`;
}

// 特徴量ベクトルを計算
function getFeatureVector(board: Cell[][], whiteMovesCount: number, blackMovesCount: number, inv: Inventory): AIWeights {
  let tWhite = 0, tBlack = 0;
  let p2White = 0, p2Black = 0;
  let p1White = 0, p1Black = 0;
  let cWhite = 0, cBlack = 0;
  let compWhite = 0, compBlack = 0;

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = board[r][c];
      
      const to = towerOwner(cell);
      if (to === "white") tWhite++;
      else if (to === "black") tBlack++;

      const po2 = partialOwner(cell, 2);
      if (po2 === "white") p2White++;
      else if (po2 === "black") p2Black++;

      const po1 = partialOwner(cell, 1);
      if (po1 === "white") p1White++;
      else if (po1 === "black") p1Black++;

      if (r >= 1 && r <= 2 && c >= 1 && c <= 2) {
        const counts = pieceCounts(cell);
        cWhite += counts.white;
        cBlack += counts.black;
      }

      const pieces = pieceCounts(cell);
      const sum = pieces.white + pieces.black;
      if (sum === 2 && !towerComplete(cell)) {
        const missingShape = !cell.square ? "square" : !cell.triangle ? "triangle" : "circle";
        if (pieces.white >= 1 && inv.white[missingShape] > 0) compWhite++;
        if (pieces.black >= 1 && inv.black[missingShape] > 0) compBlack++;
      }
    }
  }

  return {
    tower: tWhite - tBlack,
    partial2: p2White - p2Black,
    partial1: p1White - p1Black,
    mobility: whiteMovesCount - blackMovesCount,
    sqInv: inv.white.square - inv.black.square,
    trInv: inv.white.triangle - inv.black.triangle,
    ciInv: inv.white.circle - inv.black.circle,
    center: cWhite - cBlack,
    completion: compWhite - compBlack,
    patternAvoid: 0,
  };
}

// 特徴量の類似度を計算（コサイン類似度の簡易版）
function featureSimilarity(f1: AIWeights, f2: AIWeights): number {
  let dot = 0, norm1 = 0, norm2 = 0;
  const keys: (keyof AIWeights)[] = ["tower", "partial2", "partial1", "mobility", "sqInv", "trInv", "ciInv", "center", "completion"];
  
  for (const k of keys) {
    const v1 = f1[k] || 0;
    const v2 = f2[k] || 0;
    dot += v1 * v2;
    norm1 += v1 * v1;
    norm2 += v2 * v2;
  }
  
  if (norm1 === 0 || norm2 === 0) return 0;
  return dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

// ============================================================
// AI Core: Evaluation & Search with Pattern Avoidance
// ============================================================

interface SearchStats {
  nodes: number;
  patternsAvoided: number;
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
  winPatterns: WinPattern[]
): number {
  const f = getFeatureVector(board, whiteMovesCount, blackMovesCount, inv);
  
  let baseScore = (
    f.tower * weights.tower +
    f.partial2 * weights.partial2 +
    f.partial1 * weights.partial1 +
    f.mobility * weights.mobility +
    f.sqInv * weights.sqInv +
    f.trInv * weights.trInv +
    f.ciInv * weights.ciInv +
    f.center * weights.center +
    f.completion * weights.completion
  );

  // パターン回避チェック
  if (currentMove && lostPatterns.length > 0) {
    const boardHash = hashBoard(board, currentPlayer);
    
    for (const lp of lostPatterns) {
      // 完全一致チェック
      if (lp.boardHash === boardHash && lp.player === currentPlayer) {
        const moveHash = hashMove(currentMove);
        const lpMoveHash = hashMove(lp.move);
        if (moveHash === lpMoveHash) {
          baseScore -= weights.patternAvoid * 2; // 強いペナルティ
        }
      }
      
      // 類似盤面チェック
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

  // 勝ちパターン強化
  if (currentMove && winPatterns.length > 0) {
    const boardHash = hashBoard(board, currentPlayer);
    
    for (const wp of winPatterns) {
      if (wp.boardHash === boardHash && wp.player === currentPlayer) {
        const moveHash = hashMove(currentMove);
        const wpMoveHash = hashMove(wp.move);
        if (moveHash === wpMoveHash) {
          baseScore += weights.patternAvoid * 0.5; // ボーナス
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

function alphaBeta(
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
  currentMove: FullLegalMove | null = null
): { score: number; move: FullLegalMove | null } {
  stats.nodes++;

  const currentPlayer: Color = isMax ? "white" : "black";
  const bannedShape = (currentPlayer === "white" && historyLen === 2) ? whiteFirstShape : null;

  const moves = generateAllLegalMoves(board, lastMove, inv[currentPlayer], bannedShape);
  const towers = countTowers(board);

  const goState = checkGameOverState(board, moves.length, towers);
  if (goState.isOver) {
    if (goState.winner === "white") return { score: WIN_SCORE + depth, move: null };
    if (goState.winner === "black") return { score: -WIN_SCORE - depth, move: null };
    return { score: 0, move: null };
  }

  if (depth === 0) {
    const wCount = isMax ? moves.length : 1;
    const bCount = isMax ? 1 : moves.length;
    const score = evaluateBoard(board, wCount, bCount, inv, weights, currentMove, currentPlayer, lostPatterns, winPatterns);
    return { score, move: null };
  }

  const scoredMoves = moves.map(m => ({
    move: m,
    hScore: scoreMoveHeuristically(m, board, currentPlayer)
  })).sort((a, b) => b.hScore - a.hScore);

  let bestMove: FullLegalMove | null = null;

  if (isMax) {
    let maxEval = -Infinity;
    for (const sm of scoredMoves) {
      const m = sm.move;
      const nextBoard = board.map(r => r.map(c => ({ ...c })));
      if (m.shape === "square") nextBoard[m.row][m.col].square = "white";
      else if (m.shape === "triangle") nextBoard[m.row][m.col].triangle = { color: "white", dir: m.dir! };
      else nextBoard[m.row][m.col].circle = "white";

      const nextInv = { white: { ...inv.white }, black: { ...inv.black } };
      nextInv.white[m.shape]--;

      const nextLast: LastMove = { shape: m.shape, row: m.row, col: m.col, dir: m.dir, by: "white" };

      const evalResult = alphaBeta(nextBoard, nextLast, whiteFirstShape, historyLen + 1, depth - 1, alpha, beta, false, nextInv, weights, stats, lostPatterns, winPatterns, m);
      
      if (evalResult.score > maxEval) {
        maxEval = evalResult.score;
        bestMove = m;
      }
      alpha = Math.max(alpha, evalResult.score);
      if (beta <= alpha) break;
    }
    return { score: maxEval, move: bestMove };
  } else {
    let minEval = Infinity;
    for (const sm of scoredMoves) {
      const m = sm.move;
      const nextBoard = board.map(r => r.map(c => ({ ...c })));
      if (m.shape === "square") nextBoard[m.row][m.col].square = "black";
      else if (m.shape === "triangle") nextBoard[m.row][m.col].triangle = { color: "black", dir: m.dir! };
      else nextBoard[m.row][m.col].circle = "black";

      const nextInv = { white: { ...inv.white }, black: { ...inv.black } };
      nextInv.black[m.shape]--;

      const nextLast: LastMove = { shape: m.shape, row: m.row, col: m.col, dir: m.dir, by: "black" };

      const evalResult = alphaBeta(nextBoard, nextLast, whiteFirstShape, historyLen + 1, depth - 1, alpha, beta, true, nextInv, weights, stats, lostPatterns, winPatterns, m);

      if (evalResult.score < minEval) {
        minEval = evalResult.score;
        bestMove = m;
      }
      beta = Math.min(beta, evalResult.score);
      if (beta <= alpha) break;
    }
    return { score: minEval, move: bestMove };
  }
}

function getAIMove(
  board: Cell[][],
  lastMove: LastMove | null,
  whiteFirstShape: Shape | null,
  historyLen: number,
  player: Color,
  inv: Inventory,
  weights: AIWeights,
  difficulty: "easy" | "normal" | "hard" | "master",
  lostPatterns: LostPattern[],
  winPatterns: WinPattern[]
): { move: FullLegalMove; stats: SearchStats & { eval: number } } {
  const isMax = player === "white";
  const bannedShape = (player === "white" && historyLen === 2) ? whiteFirstShape : null;
  const moves = generateAllLegalMoves(board, lastMove, inv[player], bannedShape);

  if (moves.length === 0) throw new Error("No legal moves available for AI");

  if (difficulty === "easy") {
    const m = moves[Math.floor(Math.random() * moves.length)];
    return { move: m, stats: { nodes: 1, patternsAvoided: 0, eval: 0 } };
  }

  const depth = difficulty === "normal" ? 2 : difficulty === "hard" ? 3 : 4;
  const stats: SearchStats = { nodes: 0, patternsAvoided: 0 };
  
  const result = alphaBeta(board, lastMove, whiteFirstShape, historyLen, depth, -Infinity, Infinity, isMax, inv, weights, stats, lostPatterns, winPatterns);
  
  const bestMove = result.move || moves[Math.floor(Math.random() * moves.length)];
  return { move: bestMove, stats: { ...stats, eval: result.score } };
}

// ============================================================
// Self-Play Learning with Pattern Recording
// ============================================================

interface GameRecord {
  moves: { board: Cell[][]; move: FullLegalMove; player: Color; features: AIWeights }[];
  winner: Color | "draw";
  loser: Color | null;
}

function runSelfPlayGame(
  weights: AIWeights,
  lostPatterns: LostPattern[],
  winPatterns: WinPattern[],
  epsilon: number
): GameRecord {
  let board = emptyBoard();
  let inv = startingInventory();
  let lastMove: LastMove | null = null;
  let whiteFirst: Shape | null = null;
  let player: Color = "white";
  let moveCount = 0;
  const moves: GameRecord["moves"] = [];

  while (moveCount < 120) {
    const banned = (player === "white" && moveCount === 2) ? whiteFirst : null;
    const legals = generateAllLegalMoves(board, lastMove, inv[player], banned);
    const towers = countTowers(board);
    const check = checkGameOverState(board, legals.length, towers);

    if (check.isOver) {
      return {
        moves,
        winner: check.winner || "draw",
        loser: check.winner ? (check.winner === "white" ? "black" : "white") : null
      };
    }

    // 特徴量を記録
    const features = getFeatureVector(board, player === "white" ? legals.length : 1, player === "black" ? legals.length : 1, inv);

    let selectedMove: FullLegalMove;
    
    // Epsilon-Greedy
    if (Math.random() < epsilon) {
      selectedMove = legals[Math.floor(Math.random() * legals.length)];
    } else {
      const stats = { nodes: 0, patternsAvoided: 0 };
      const result = alphaBeta(board, lastMove, whiteFirst, moveCount, 2, -Infinity, Infinity, player === "white", inv, weights, stats, lostPatterns, winPatterns);
      selectedMove = result.move || legals[Math.floor(Math.random() * legals.length)];
    }

    // 手を記録
    const boardCopy = board.map(r => r.map(c => ({ ...c })));
    moves.push({ board: boardCopy, move: { ...selectedMove }, player, features });

    // 着手
    const newBoard = board.map(r => r.map(c => ({ ...c })));
    if (selectedMove.shape === "square") newBoard[selectedMove.row][selectedMove.col].square = player;
    else if (selectedMove.shape === "triangle") newBoard[selectedMove.row][selectedMove.col].triangle = { color: player, dir: selectedMove.dir! };
    else newBoard[selectedMove.row][selectedMove.col].circle = player;

    inv[player][selectedMove.shape]--;

    if (moveCount === 0 && player === "white") {
      whiteFirst = selectedMove.shape;
    }

    lastMove = {
      shape: selectedMove.shape,
      row: selectedMove.row,
      col: selectedMove.col,
      dir: selectedMove.dir,
      by: player
    };

    board = newBoard;
    player = player === "white" ? "black" : "white";
    moveCount++;
  }

  return { moves, winner: "draw", loser: null };
}

function extractLearningPatterns(
  gameRecord: GameRecord,
  lostPatterns: LostPattern[],
  winPatterns: WinPattern[]
): { newLostPatterns: LostPattern[]; newWinPatterns: WinPattern[] } {
  const newLostPatterns: LostPattern[] = [];
  const newWinPatterns: WinPattern[] = [];

  if (gameRecord.winner === "draw") {
    return { newLostPatterns, newWinPatterns };
  }

  const loser = gameRecord.loser!;
  const winner = gameRecord.winner;

  // 敗者の手を分析 - 特にゲーム後半の重要な局面
  const loserMoves = gameRecord.moves.filter(m => m.player === loser);
  const criticalMoves = loserMoves.slice(-5); // 最後の5手を重要視

  for (const m of criticalMoves) {
    const boardHash = hashBoard(m.board, m.player);
    
    // 既存パターンと重複していないかチェック
    const exists = lostPatterns.some(p => p.boardHash === boardHash && hashMove(p.move) === hashMove(m.move));
    if (!exists) {
      newLostPatterns.push({
        boardHash,
        features: m.features,
        move: m.move,
        player: m.player,
        gamePhase: gameRecord.moves.indexOf(m),
        timestamp: Date.now()
      });
    }
  }

  // 勝者の良い手も記録
  const winnerMoves = gameRecord.moves.filter(m => m.player === winner);
  const winnerCritical = winnerMoves.slice(-3); // 最後の3手

  for (const m of winnerCritical) {
    const boardHash = hashBoard(m.board, m.player);
    const exists = winPatterns.some(p => p.boardHash === boardHash && hashMove(p.move) === hashMove(m.move));
    if (!exists) {
      newWinPatterns.push({
        boardHash,
        features: m.features,
        move: m.move,
        player: m.player,
        gamePhase: gameRecord.moves.indexOf(m),
        timestamp: Date.now()
      });
    }
  }

  return { newLostPatterns, newWinPatterns };
}

// TD学習による重み更新
function updateWeightsTD(
  weights: AIWeights,
  gameRecord: GameRecord,
  learningRate: number
): AIWeights {
  const newWeights = { ...weights };
  
  if (gameRecord.winner === "draw") return newWeights;

  const reward = gameRecord.winner === "white" ? 1.0 : -1.0;

  // ゲームの各手に対してTD更新
  for (let i = gameRecord.moves.length - 1; i >= 0; i--) {
    const move = gameRecord.moves[i];
    const f = move.features;
    
    // 次の状態の価値（最後の手は報酬）
    let nextV: number;
    if (i === gameRecord.moves.length - 1) {
      nextV = reward * 5000;
    } else {
      // 簡易的な次状態の価値
      nextV = f.tower * weights.tower + f.partial2 * weights.partial2 + f.partial1 * weights.partial1 +
              f.mobility * weights.mobility + f.sqInv * weights.sqInv + f.trInv * weights.trInv + f.ciInv * weights.ciInv +
              f.center * weights.center + f.completion * weights.completion;
    }

    // 現在の評価値
    const currentV = f.tower * weights.tower + f.partial2 * weights.partial2 + f.partial1 * weights.partial1 +
                     f.mobility * weights.mobility + f.sqInv * weights.sqInv + f.trInv * weights.trInv + f.ciInv * weights.ciInv +
                     f.center * weights.center + f.completion * weights.completion;

    const tdError = nextV - currentV;

    // 重み更新 (安定化のためグラディエントクリッピング)
    const clip = (val: number) => Math.max(-50, Math.min(50, val));

    newWeights.tower = clip(newWeights.tower + learningRate * tdError * (f.tower || 0));
    newWeights.partial2 = clip(newWeights.partial2 + learningRate * tdError * (f.partial2 || 0));
    newWeights.partial1 = clip(newWeights.partial1 + learningRate * tdError * (f.partial1 || 0));
    newWeights.mobility = clip(newWeights.mobility + learningRate * tdError * (f.mobility || 0));
    newWeights.sqInv = clip(newWeights.sqInv + learningRate * tdError * (f.sqInv || 0));
    newWeights.trInv = clip(newWeights.trInv + learningRate * tdError * (f.trInv || 0));
    newWeights.ciInv = clip(newWeights.ciInv + learningRate * tdError * (f.ciInv || 0));
    newWeights.center = clip(newWeights.center + learningRate * tdError * (f.center || 0));
    newWeights.completion = clip(newWeights.completion + learningRate * tdError * (f.completion || 0));
  }

  return newWeights;
}

// ============================================================
// React Component Helpers
// ============================================================
function dirSymbol(dir: Direction): string {
  return { up: "↑", down: "↓", left: "←", right: "→" }[dir];
}

function PieceSquare({ color, size = 28 }: { color: Color; size?: number }) {
  const fill = color === "white" ? "#f8fafc" : "#0f172a";
  const stroke = color === "white" ? "#0f172a" : "#f8fafc";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <rect x="4" y="4" width="24" height="24" rx="2" fill={fill} stroke={stroke} strokeWidth="2" />
    </svg>
  );
}

function PieceTriangle({ color, dir = "up", size = 28 }: { color: Color; dir?: Direction; size?: number }) {
  const fill = color === "white" ? "#f8fafc" : "#0f172a";
  const stroke = color === "white" ? "#0f172a" : "#f8fafc";
  const rotate = { up: 0, right: 90, down: 180, left: 270 }[dir];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <polygon points="16,3 29,28 3,28" fill={fill} stroke={stroke} strokeWidth="2" strokeLinejoin="round" transform={`rotate(${rotate} 16 16)`} />
    </svg>
  );
}

function PieceCircle({ color, size = 28 }: { color: Color; size?: number }) {
  const fill = color === "white" ? "#f8fafc" : "#0f172a";
  const stroke = color === "white" ? "#0f172a" : "#f8fafc";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="12" fill={fill} stroke={stroke} strokeWidth="2" />
    </svg>
  );
}

function PieceIcon({ shape, color, dir, size }: { shape: Shape; color: Color; dir?: Direction; size?: number }) {
  if (shape === "square") return <PieceSquare color={color} size={size} />;
  if (shape === "triangle") return <PieceTriangle color={color} dir={dir} size={size} />;
  return <PieceCircle color={color} size={size} />;
}

function EmptySlot({ shape, size = 22 }: { shape: Shape; size?: number }) {
  const stroke = "#475569";
  if (shape === "square") return <svg width={size} height={size} viewBox="0 0 32 32"><rect x="5" y="5" width="22" height="22" rx="2" fill="none" stroke={stroke} strokeWidth="1.5" strokeDasharray="3 3" /></svg>;
  if (shape === "triangle") return <svg width={size} height={size} viewBox="0 0 32 32"><polygon points="16,4 28,27 4,27" fill="none" stroke={stroke} strokeWidth="1.5" strokeDasharray="3 3" /></svg>;
  return <svg width={size} height={size} viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="none" stroke={stroke} strokeWidth="1.5" strokeDasharray="3 3" /></svg>;
}

function CellView({ cell, isValid, isLast, onClick }: { cell: Cell; isValid: boolean; isLast: boolean; onClick: () => void }) {
  const owner = towerOwner(cell);
  const complete = towerComplete(cell);

  let borderClass = "border-slate-700";
  let bg = "bg-slate-800/60";
  if (complete) {
    if (owner === "white") { borderClass = "border-slate-100 ring-1 ring-white/50"; bg = "bg-slate-100/10"; }
    else if (owner === "black") { borderClass = "border-slate-950 ring-1 ring-slate-950"; bg = "bg-slate-950/60"; }
  }
  if (isValid) { borderClass = "border-amber-400 animate-pulse"; bg = "bg-amber-400/15"; }
  if (isLast) { borderClass = "border-sky-400 ring-1 ring-sky-400"; }

  return (
    <button onClick={onClick} disabled={!isValid} className={`relative aspect-square rounded-lg border-2 ${borderClass} ${bg} transition-all duration-150 ${isValid ? "cursor-pointer ring-2 ring-amber-300/50 ring-offset-1 ring-offset-slate-900 hover:scale-[1.03]" : "cursor-default"}`}>
      {complete && owner && <div className={`absolute -top-2 -right-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow ${owner === "white" ? "bg-slate-100 text-slate-900" : "bg-slate-950 text-slate-100 border border-slate-100/30"}`}>★</div>}
      <div className="flex h-full w-full items-center justify-center gap-1 px-1">
        {SHAPES.map((shape) => {
          if (shape === "square" && cell.square) return <PieceIcon key={shape} shape="square" color={cell.square} size={28} />;
          if (shape === "triangle" && cell.triangle) return <PieceIcon key={shape} shape="triangle" color={cell.triangle.color} dir={cell.triangle.dir} size={28} />;
          if (shape === "circle" && cell.circle) return <PieceIcon key={shape} shape="circle" color={cell.circle} size={28} />;
          return <div key={shape} className="opacity-15"><EmptySlot shape={shape} size={20} /></div>;
        })}
      </div>
    </button>
  );
}

// ============================================================
// Main App
// ============================================================
export default function App() {
  const [activeTab, setActiveTab] = useState<"game" | "train" | "archive">("game");

  // Game state
  const [board, setBoard] = useState<Cell[][]>(emptyBoard);
  const [currentPlayer, setCurrentPlayer] = useState<Color>("white");
  const [inventory, setInventory] = useState<Inventory>(startingInventory);
  const [lastMove, setLastMove] = useState<LastMove | null>(null);
  const [whiteFirstShape, setWhiteFirstShape] = useState<Shape | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [moveHistoryLen, setMoveHistoryLen] = useState<number>(0);
  
  // 人間対戦用のゲームログ（リアルタイム学習用）
  const [gameMovesLog, setGameMovesLog] = useState<GameRecord["moves"]>([]);
  const [gameMode, setGameMode] = useState<"human" | "ai_black" | "ai_white" | "ai_vs_ai">("ai_black");
  const [aiDifficulty, setAiDifficulty] = useState<"easy" | "normal" | "hard" | "master">("hard");
  const [selectedShape, setSelectedShape] = useState<Shape>("square");
  const [selectedDir, setSelectedDir] = useState<Direction>("up");
  const [winner, setWinner] = useState<Color | "draw" | null>(null);
  const [gameOver, setGameOver] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);
  const [searchStats, setSearchStats] = useState<{ nodes: number; eval: number; patternsAvoided: number } | null>(null);

  // Learning state
  const [aiWeights, setAiWeights] = useState<AIWeights>(DEFAULT_WEIGHTS);
  const [lostPatterns, setLostPatterns] = useState<LostPattern[]>([]);
  const [winPatterns, setWinPatterns] = useState<WinPattern[]>([]);
  const [learningHistory, setLearningHistory] = useState<LearningHistory>({
    totalGames: 0, whiteWins: 0, blackWins: 0, draws: 0, patternsLearned: 0, lastUpdateTime: 0
  });
  const [isTraining, setIsTraining] = useState(false);
  const [trainProgress, setTrainProgress] = useState(0);
  const [trainLog, setTrainLog] = useState<string>("学習センター準備完了。");
  const [learningRate, setLearningRate] = useState(0.005);
  const [epsilon, setEpsilon] = useState(0.1);
  const [customTrainCount, setCustomTrainCount] = useState<string>("50");
  
  // 強化機構の有効無効
  const [enableOpeningBook, setEnableOpeningBook] = useState(true); // オープニングブック
  const [enableTemperature, setEnableTemperature] = useState(true); // 温度付き選択
  const [enableTransposition, setEnableTransposition] = useState(true); // トランスポジション表
  const [temperature, setTemperature] = useState(0.5); // 温度パラメータ

  // AI強化機構の状態を使う
  useEffect(() => {
    enableOpeningBook; enableTemperature; enableTransposition; temperature;
  }, [enableOpeningBook, enableTemperature, enableTransposition, temperature]);

  // Archive state
  const [savedGames, setSavedGames] = useState<SavedGame[]>([]);
  const [viewingSavedGame, setViewingSavedGame] = useState<SavedGame | null>(null);

  // Load from localStorage
  useEffect(() => {
    try {
      const storedWeights = localStorage.getItem("pyrga_ai_weights_v2");
      if (storedWeights) setAiWeights(JSON.parse(storedWeights));

      const storedLost = localStorage.getItem("pyrga_lost_patterns");
      if (storedLost) setLostPatterns(JSON.parse(storedLost));

      const storedWin = localStorage.getItem("pyrga_win_patterns");
      if (storedWin) setWinPatterns(JSON.parse(storedWin));

      const storedHistory = localStorage.getItem("pyrga_learning_history");
      if (storedHistory) setLearningHistory(JSON.parse(storedHistory));

      const storedGames = localStorage.getItem("pyrga_saved_games");
      if (storedGames) setSavedGames(JSON.parse(storedGames));
    } catch (e) {
      console.error("Failed to load data from localStorage", e);
    }
  }, []);

  // Save to localStorage
  const saveToStorage = useCallback(() => {
    localStorage.setItem("pyrga_ai_weights_v2", JSON.stringify(aiWeights));
    localStorage.setItem("pyrga_lost_patterns", JSON.stringify(lostPatterns.slice(-MAX_PATTERNS)));
    localStorage.setItem("pyrga_win_patterns", JSON.stringify(winPatterns.slice(-MAX_PATTERNS)));
    localStorage.setItem("pyrga_learning_history", JSON.stringify(learningHistory));
    localStorage.setItem("pyrga_saved_games", JSON.stringify(savedGames));
  }, [aiWeights, lostPatterns, winPatterns, learningHistory, savedGames]);

  useEffect(() => {
    saveToStorage();
  }, [saveToStorage]);

  // Game calculations
  const bannedShape = useMemo(() => {
    return (currentPlayer === "white" && moveHistoryLen === 2) ? whiteFirstShape : null;
  }, [currentPlayer, moveHistoryLen, whiteFirstShape]);

  const { moves: legalMoves, fallback } = useMemo(() => {
    return getLegalMoves(board, lastMove, inventory[currentPlayer], bannedShape);
  }, [board, lastMove, inventory, currentPlayer, bannedShape]);

  const validCellSet = useMemo(() => {
    const s = new Set<string>();
    for (const m of legalMoves) {
      if (m.shape === selectedShape) s.add(`${m.row},${m.col}`);
    }
    return s;
  }, [legalMoves, selectedShape]);

  const towers = useMemo(() => countTowers(board), [board]);

  const partialW = useMemo(() => {
    let w = 0, b = 0;
    for (const r of board) for (const c of r) {
      const po = partialOwner(c, 2);
      if (po === "white") w++;
      else if (po === "black") b++;
    }
    return { white: w, black: b };
  }, [board]);

  const validTriangleDirs = useMemo(() => {
    const valid = new Set<Direction>();
    for (const d of DIRS) {
      for (const m of legalMoves) {
        if (m.shape === "triangle" && isDirValidForCell(m.row, m.col, d)) {
          valid.add(d);
          break;
        }
      }
    }
    return valid;
  }, [legalMoves]);

  // Player move handling
  function handleCellClick(row: number, col: number) {
    if (gameOver || winner || aiThinking) return;
    if (inventory[currentPlayer][selectedShape] <= 0) return;
    if (!validCellSet.has(`${row},${col}`)) return;
    if (selectedShape === "triangle" && !isDirValidForCell(row, col, selectedDir)) return;

    executeMove({ row, col, shape: selectedShape, dir: selectedShape === "triangle" ? selectedDir : undefined });
  }

  function executeMove(m: FullLegalMove) {
    const newBoard = board.map((r) => r.map((c) => ({ ...c })));
    if (m.shape === "square") newBoard[m.row][m.col].square = currentPlayer;
    else if (m.shape === "triangle") newBoard[m.row][m.col].triangle = { color: currentPlayer, dir: m.dir! };
    else newBoard[m.row][m.col].circle = currentPlayer;

    const newInv = { white: { ...inventory.white }, black: { ...inventory.black } };
    newInv[currentPlayer][m.shape]--;

    if (moveHistoryLen === 0 && currentPlayer === "white") setWhiteFirstShape(m.shape);

    const newLast: LastMove = { shape: m.shape, row: m.row, col: m.col, dir: m.dir, by: currentPlayer };
    const nextP: Color = currentPlayer === "white" ? "black" : "white";
    const nextHistoryLen = moveHistoryLen + 1;

    const moveDesc = `${currentPlayer === "white" ? "白" : "黒"}: ${m.shape === "square" ? "■" : m.shape === "triangle" ? "▲" : "●"}${m.shape === "triangle" ? `(${dirSymbol(m.dir!)})` : ""} → (${m.row + 1},${m.col + 1})`;
    
    // 現在の盤面と着手前の特徴量を記録
    const currentFeatures = getFeatureVector(board, currentPlayer === "white" ? legalMoves.length : 1, currentPlayer === "black" ? legalMoves.length : 1, inventory);
    const updatedMovesLog = [
      ...gameMovesLog,
      { board: board.map(r => r.map(c => ({ ...c }))), move: { ...m }, player: currentPlayer, features: currentFeatures }
    ];
    setGameMovesLog(updatedMovesLog);

    setHistory((h) => [moveDesc, ...h].slice(0, 20));
    setBoard(newBoard);
    setInventory(newInv);
    setLastMove(newLast);
    setMoveHistoryLen(nextHistoryLen);
    setCurrentPlayer(nextP);

    const nextLegals = generateAllLegalMoves(newBoard, newLast, newInv[nextP], (nextP === "white" && nextHistoryLen === 2) ? (whiteFirstShape || m.shape) : null);
    const nextTowers = countTowers(newBoard);
    const goState = checkGameOverState(newBoard, nextLegals.length, nextTowers);

    if (goState.isOver) {
      setWinner(goState.winner);
      setGameOver(true);
      
      const gameWinner = goState.winner;
      const gameLoser = gameWinner === "white" ? "black" : (gameWinner === "black" ? "white" : null);
      const gameRecord: GameRecord = { moves: updatedMovesLog, winner: gameWinner || "draw", loser: gameLoser };

      // 人間との対戦でも学習を即座に実行
      const { newLostPatterns, newWinPatterns } = extractLearningPatterns(gameRecord, lostPatterns, winPatterns);
      setLostPatterns(prev => [...prev, ...newLostPatterns].slice(-MAX_PATTERNS));
      setWinPatterns(prev => [...prev, ...newWinPatterns].slice(-MAX_PATTERNS));
      
      const newWeights = updateWeightsTD(aiWeights, gameRecord, learningRate);
      setAiWeights(newWeights);

      setLearningHistory(prev => ({
        totalGames: prev.totalGames + 1,
        whiteWins: prev.whiteWins + (gameWinner === "white" ? 1 : 0),
        blackWins: prev.blackWins + (gameWinner === "black" ? 1 : 0),
        draws: prev.draws + (gameWinner === "draw" ? 1 : 0),
        patternsLearned: prev.patternsLearned + newLostPatterns.length + newWinPatterns.length,
        lastUpdateTime: Date.now()
      }));

      setTrainLog(`対局から学習完了: ${gameWinner === "draw" ? "引き分け" : gameWinner === "white" ? "白の勝ち" : "黒の勝ち"} (+${newLostPatterns.length}負けパターン、+${newWinPatterns.length}勝ちパターン)`);

      if (gameMode !== "human" && aiDifficulty === "master") {
        saveWinningBoardInternal(newBoard, goState.winner!, nextHistoryLen, "AI決着対局 (マスター)");
      }
    }
  }

  // AI turn handling
  useEffect(() => {
    if (gameOver || winner || aiThinking) return;

    const isAITurn =
      (gameMode === "ai_black" && currentPlayer === "black") ||
      (gameMode === "ai_white" && currentPlayer === "white") ||
      (gameMode === "ai_vs_ai");

    if (isAITurn) {
      setAiThinking(true);
      const delay = gameMode === "ai_vs_ai" ? 200 : 600;
      
      const timer = setTimeout(() => {
        try {
          const result = getAIMove(board, lastMove, whiteFirstShape, moveHistoryLen, currentPlayer, inventory, aiWeights, aiDifficulty, lostPatterns, winPatterns);
          setSearchStats(result.stats);
          executeMove(result.move);
        } catch (e) {
          console.error("AI Error:", e);
        } finally {
          setAiThinking(false);
        }
      }, delay);

      return () => clearTimeout(timer);
    }
  }, [currentPlayer, gameMode, aiDifficulty, gameOver, winner, board, lastMove, whiteFirstShape, moveHistoryLen, inventory, aiWeights, lostPatterns, winPatterns]);

  function resetGame() {
    setBoard(emptyBoard());
    setCurrentPlayer("white");
    setInventory(startingInventory());
    setLastMove(null);
    setWhiteFirstShape(null);
    setHistory([]);
    setMoveHistoryLen(0);
    setWinner(null);
    setGameOver(false);
    setAiThinking(false);
    setSearchStats(null);
    setGameMovesLog([]);
  }

  // Training functions
  function runTrainingBatch(size: number) {
    if (isTraining) return;
    setIsTraining(true);
    setTrainProgress(0);
    
    let completed = 0;
    let currentWeights = { ...aiWeights };
    let currentLost = [...lostPatterns];
    let currentWin = [...winPatterns];
    let wWins = 0, bWins = 0, draws = 0;

    function processGame() {
      if (completed >= size) {
        setAiWeights(currentWeights);
        setLostPatterns(currentLost.slice(-MAX_PATTERNS));
        setWinPatterns(currentWin.slice(-MAX_PATTERNS));
        setLearningHistory(prev => ({
          totalGames: prev.totalGames + size,
          whiteWins: prev.whiteWins + wWins,
          blackWins: prev.blackWins + bWins,
          draws: prev.draws + draws,
          patternsLearned: currentLost.length + currentWin.length,
          lastUpdateTime: Date.now()
        }));
        setIsTraining(false);
        setTrainProgress(100);
        return;
      }

      // Run one self-play game
      const gameRecord = runSelfPlayGame(currentWeights, currentLost, currentWin, epsilon);
      
      if (gameRecord.winner === "white") wWins++;
      else if (gameRecord.winner === "black") bWins++;
      else draws++;

      // Extract patterns
      const { newLostPatterns, newWinPatterns } = extractLearningPatterns(gameRecord, currentLost, currentWin);
      currentLost = [...currentLost, ...newLostPatterns].slice(-MAX_PATTERNS);
      currentWin = [...currentWin, ...newWinPatterns].slice(-MAX_PATTERNS);

      // Update weights with TD learning
      currentWeights = updateWeightsTD(currentWeights, gameRecord, learningRate);

      completed++;
      setTrainProgress(Math.round((completed / size) * 100));
      setTrainLog(`自己対局 #${completed}: ${gameRecord.winner === "white" ? "白勝" : gameRecord.winner === "black" ? "黒勝" : "引分"} | 新規負けパターン: ${newLostPatterns.length} | 新規勝ちパターン: ${newWinPatterns.length}`);

      requestAnimationFrame(processGame);
    }

    requestAnimationFrame(processGame);
  }

  function startCustomTraining() {
    const count = parseInt(customTrainCount);
    if (isNaN(count) || count <= 0) {
      alert("1以上の数値を入力してください");
      return;
    }
    runTrainingBatch(count);
  }

  function resetTrainingParams() {
    if (window.confirm("AIの学習データ（重み、パターン）を完全にリセットしますか？")) {
      setAiWeights(DEFAULT_WEIGHTS);
      setLostPatterns([]);
      setWinPatterns([]);
      setLearningHistory({ totalGames: 0, whiteWins: 0, blackWins: 0, draws: 0, patternsLearned: 0, lastUpdateTime: 0 });
      localStorage.removeItem("pyrga_ai_weights_v2");
      localStorage.removeItem("pyrga_lost_patterns");
      localStorage.removeItem("pyrga_win_patterns");
      localStorage.removeItem("pyrga_learning_history");
      setTrainLog("AIの知識をリセットしました。");
    }
  }

  function saveWinningBoardInternal(b: Cell[][], win: Color | "draw", moves: number, customName?: string) {
    setSavedGames(prev => {
      const exists = prev.some(g => JSON.stringify(g.board) === JSON.stringify(b));
      if (exists) return prev;
      const newGame: SavedGame = {
        id: "game_" + Math.random().toString(36).substr(2, 9),
        name: customName || `決着盤面 #${prev.length + 1} (${moves}手)`,
        winner: win,
        moveCount: moves,
        date: new Date().toLocaleString(),
        board: b,
        lastMove: null
      };
      const next = [newGame, ...prev].slice(0, 30);
      return next;
    });
  }

  function saveCurrentBoard() {
    const name = window.prompt("この盤面に名前をつけて保存します:", `対局局面 (${moveHistoryLen}手目)`);
    if (name) {
      saveWinningBoardInternal(board, winner || "draw", moveHistoryLen, name);
      alert("盤面アーカイブに保存しました！");
    }
  }

  function deleteSavedGame(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (window.confirm("この盤面レコードを削除しますか？")) {
      setSavedGames(prev => prev.filter(g => g.id !== id));
      if (viewingSavedGame?.id === id) setViewingSavedGame(null);
    }
  }

  const winRate = useMemo(() => {
    const total = learningHistory.whiteWins + learningHistory.blackWins + learningHistory.draws;
    return total === 0 ? 0 : Math.round((learningHistory.whiteWins / total) * 100);
  }, [learningHistory]);

  const maxWeightValue = useMemo(() => Math.max(...Object.values(aiWeights).map(Math.abs), 100), [aiWeights]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 px-4 py-6 text-slate-100">
      <div className="mx-auto max-w-6xl">
        
        <header className="mb-4 flex flex-col gap-2 border-b border-slate-700 pb-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="bg-gradient-to-r from-amber-300 via-rose-300 to-violet-300 bg-clip-text text-4xl font-black tracking-tight text-transparent">PYRGA AI</h1>
              <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-xs font-bold tracking-wider text-indigo-300 border border-indigo-500/30">PATTERN LEARNING v2.0</span>
            </div>
            <p className="text-xs text-slate-400">同じ負け方をしない — 経験から学ぶ最強のピルガAI</p>
          </div>
          
          <div className="flex gap-1 rounded-xl bg-slate-800/80 p-1 border border-slate-700">
            {(["game", "train", "archive"] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-bold transition ${activeTab === tab ? "bg-amber-400 text-slate-900" : "text-slate-300 hover:bg-slate-700/60"}`}>
                {tab === "game" && "🎮 対局"}
                {tab === "train" && "🧠 AI強化センター"}
                {tab === "archive" && "📜 盤面アーカイブ"}
                {tab === "archive" && savedGames.length > 0 && <span className="ml-1 rounded-full bg-indigo-500 px-1.5 py-0.5 text-[10px] text-white">{savedGames.length}</span>}
              </button>
            ))}
          </div>
        </header>

        {/* TAB 1: GAME */}
        {activeTab === "game" && (
          <div className="grid gap-6 lg:grid-cols-[1fr_auto_1fr]">
            <PlayerPanel color="white" inventory={inventory.white} isCurrent={currentPlayer === "white" && !gameOver} towers={towers.white} partials={partialW.white} selectedShape={selectedShape} selectedDir={selectedDir} onSelectShape={setSelectedShape} onSelectDir={setSelectedDir} disabled={currentPlayer !== "white" || gameOver || aiThinking} bannedShape={bannedShape} validTriangleDirs={validTriangleDirs} isAI={gameMode === "ai_white" || gameMode === "ai_vs_ai"} />
            
            <div className="flex flex-col items-center gap-3">
              <div className="flex w-full max-w-[540px] flex-col gap-2 rounded-xl border border-slate-700 bg-slate-900/50 p-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-300">モード:</span>
                    <select value={gameMode} onChange={(e) => { setGameMode(e.target.value as any); resetGame(); }} className="rounded border border-slate-600 bg-slate-800 px-2 py-1 font-semibold text-slate-100">
                      <option value="human">PvP</option>
                      <option value="ai_black">vs AI (黒)</option>
                      <option value="ai_white">AI (白) vs 人間</option>
                      <option value="ai_vs_ai">AI vs AI</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-300">難易度:</span>
                    <select value={aiDifficulty} onChange={(e) => setAiDifficulty(e.target.value as any)} disabled={gameMode === "human"} className="rounded border border-slate-600 bg-slate-800 px-2 py-1 font-semibold text-slate-100 disabled:opacity-40">
                      <option value="easy">初級</option>
                      <option value="normal">中級</option>
                      <option value="hard">上級</option>
                      <option value="master">最強</option>
                    </select>
                  </div>
                  <button onClick={resetGame} className="rounded border border-slate-600 bg-slate-800/80 px-2.5 py-1 font-bold text-slate-200 hover:bg-slate-700">🔄 リセット</button>
                </div>
              </div>

              <StatusBar currentPlayer={currentPlayer} gameOver={gameOver} winner={winner} fallback={fallback} lastMove={lastMove} legalCount={legalMoves.length} bannedShape={bannedShape} aiThinking={aiThinking} searchStats={searchStats} aiDifficulty={aiDifficulty} lostPatternsCount={lostPatterns.length} />

              <div className="relative">
                <div className="grid grid-cols-4 gap-2 rounded-2xl border border-slate-600 bg-slate-900/80 p-3 shadow-2xl" style={{ width: "min(540px, 90vw)" }}>
                  {board.map((row, r) => row.map((cell, c) => <CellView key={`${r}-${c}`} cell={cell} isValid={validCellSet.has(`${r},${c}`) && !gameOver && !aiThinking} isLast={!!(lastMove?.row === r && lastMove?.col === c)} onClick={() => handleCellClick(r, c)} />))}
                </div>
                {aiThinking && aiDifficulty === "master" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-slate-950/40 backdrop-blur-sm">
                    <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-400 border-t-transparent" />
                    <div className="mt-3 rounded bg-slate-900/90 border border-slate-700 px-3 py-1.5 text-center shadow-lg">
                      <div className="font-bold text-amber-300 animate-pulse">AI 思考中</div>
                      <div className="mt-1 font-mono text-[10px] text-slate-400">{searchStats ? `探索: ${searchStats.nodes}ノード | 回避パターン: ${searchStats.patternsAvoided}` : "探索中..."}</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex w-full max-w-[540px] items-start gap-3">
                <div className="flex-1 rounded-xl border border-slate-700 bg-slate-900/50 p-2.5 text-xs">
                  <div className="mb-1 flex items-center justify-between font-semibold text-slate-300">
                    <span>手の履歴 ({moveHistoryLen}手)</span>
                    <button onClick={saveCurrentBoard} className="rounded bg-indigo-500/20 border border-indigo-500/30 px-1.5 py-0.5 text-[10px] font-bold text-indigo-300 hover:bg-indigo-500/30">💾 記録</button>
                  </div>
                  {history.length === 0 ? <div className="py-2 text-center text-slate-500">対局を開始してください</div> : <ol className="grid max-h-24 grid-cols-2 gap-x-3 gap-y-0.5 overflow-y-auto font-mono text-slate-400">{history.map((h, i) => <li key={i} className={i === 0 ? "font-bold text-amber-400" : ""}>{history.length - i}. {h}</li>)}</ol>}
                </div>
              </div>
            </div>

            <PlayerPanel color="black" inventory={inventory.black} isCurrent={currentPlayer === "black" && !gameOver} towers={towers.black} partials={partialW.black} selectedShape={selectedShape} selectedDir={selectedDir} onSelectShape={setSelectedShape} onSelectDir={setSelectedDir} disabled={currentPlayer !== "black" || gameOver || aiThinking} bannedShape={null} validTriangleDirs={validTriangleDirs} isAI={gameMode === "ai_black" || gameMode === "ai_vs_ai"} />
          </div>
        )}

        {/* TAB 2: TRAINING */}
        {activeTab === "train" && (
          <div className="grid gap-6 md:grid-cols-3">
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-700 bg-slate-900/50 p-4">
              <h2 className="text-base font-bold border-b border-slate-700 pb-1.5 text-amber-300 flex items-center gap-1.5">🧠 経験学習ステータス</h2>
              
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-slate-800/60 p-3 border border-slate-700/50">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">総学習対局</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-slate-100">{learningHistory.totalGames}</div>
                </div>
                <div className="rounded-xl bg-slate-800/60 p-3 border border-slate-700/50">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">記憶パターン</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-rose-400">{lostPatterns.length + winPatterns.length}</div>
                </div>
                <div className="rounded-xl bg-slate-800/60 p-3 border border-slate-700/50">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">白勝率</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-amber-400">{winRate}%</div>
                </div>
              </div>

              <div className="rounded-xl bg-slate-800/30 p-3 border border-slate-700/30 text-xs text-slate-400">
                <div className="mb-1.5 font-semibold text-rose-300">⚠️ 負けパターン記録: {lostPatterns.length}</div>
                <div className="mb-2 font-semibold text-emerald-300">✅ 勝ちパターン記録: {winPatterns.length}</div>
                <div className="border-t border-slate-700/50 pt-2 mt-2 flex gap-4 font-mono">
                  <div>白勝: <span className="font-bold text-slate-200">{learningHistory.whiteWins}</span></div>
                  <div>黒勝: <span className="font-bold text-slate-200">{learningHistory.blackWins}</span></div>
                  <div>引分: <span className="font-bold text-slate-200">{learningHistory.draws}</span></div>
                </div>
              </div>

              <div className="space-y-3 rounded-xl bg-slate-800/40 p-3 border border-slate-700/50 text-xs">
                <div>
                  <div className="flex justify-between font-semibold mb-1"><span className="text-slate-400">学習率 (α)</span><span className="font-mono text-amber-400">{learningRate}</span></div>
                  <input type="range" min="0.001" max="0.05" step="0.001" value={learningRate} onChange={(e) => setLearningRate(parseFloat(e.target.value))} disabled={isTraining} className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-400" />
                </div>
                <div>
                  <div className="flex justify-between font-semibold mb-1"><span className="text-slate-400">探索率 (ε)</span><span className="font-mono text-amber-400">{(epsilon * 100).toFixed(0)}%</span></div>
                  <input type="range" min="0" max="0.3" step="0.01" value={epsilon} onChange={(e) => setEpsilon(parseFloat(e.target.value))} disabled={isTraining} className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-400" />
                </div>
              </div>

              <div className="mt-auto space-y-2">
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={customTrainCount}
                    onChange={(e) => setCustomTrainCount(e.target.value)}
                    disabled={isTraining}
                    min="1"
                    max="10000"
                    className="flex-1 rounded-lg border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs font-bold text-slate-100 disabled:opacity-40"
                    placeholder="回数を入力"
                  />
                  <button disabled={isTraining} onClick={startCustomTraining} className="flex-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 py-1.5 text-xs font-bold text-white transition shadow">カスタム学習</button>
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  <button disabled={isTraining} onClick={() => runTrainingBatch(10)} className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 py-1.5 text-xs font-bold text-white transition shadow">10回</button>
                  <button disabled={isTraining} onClick={() => runTrainingBatch(50)} className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 py-1.5 text-xs font-bold text-white transition shadow">50回</button>
                  <button disabled={isTraining} onClick={() => runTrainingBatch(100)} className="rounded-lg bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-400 hover:to-rose-400 disabled:opacity-40 py-1.5 text-xs font-bold text-slate-950 transition shadow">100回</button>
                  <button disabled={isTraining} onClick={() => runTrainingBatch(500)} className="rounded-lg bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-400 hover:to-pink-400 disabled:opacity-40 py-1.5 text-xs font-bold text-slate-950 transition shadow">500回</button>
                </div>

                <button disabled={isTraining} onClick={resetTrainingParams} className="w-full rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-400 py-1.5 text-xs transition">知識を完全にリセット</button>
              </div>
            </div>

            <div className="md:col-span-2 flex flex-col gap-4 rounded-2xl border border-slate-700 bg-slate-900/50 p-4">
              <h2 className="text-base font-bold border-b border-slate-700 pb-1.5 text-amber-300">📊 学習状況リアルタイム</h2>

              {isTraining && (
                <div className="rounded-xl bg-indigo-950/40 border border-indigo-700/30 p-3">
                  <div className="flex justify-between text-xs font-bold text-indigo-300 mb-1"><span>学習中...</span><span className="font-mono">{trainProgress}%</span></div>
                  <div className="w-full bg-slate-800 rounded-full h-2"><div className="bg-gradient-to-r from-indigo-500 to-amber-400 h-2 rounded-full transition-all" style={{ width: `${trainProgress}%` }}></div></div>
                  <div className="mt-1 text-center font-mono text-[10px] text-slate-400 truncate">{trainLog}</div>
                </div>
              )}

              <div className="flex-1 space-y-2">
                <WeightBar label="w1: 塔支配" value={aiWeights.tower} maxVal={maxWeightValue} color="bg-amber-400" />
                <WeightBar label="w2: 2駒優勢" value={aiWeights.partial2} maxVal={maxWeightValue} color="bg-rose-400" />
                <WeightBar label="w3: 1駒優勢" value={aiWeights.partial1} maxVal={maxWeightValue} color="bg-orange-400" />
                <WeightBar label="w4: 機動力" value={aiWeights.mobility} maxVal={maxWeightValue} color="bg-sky-400" />
                <WeightBar label="w5: ■残り数" value={aiWeights.sqInv} maxVal={maxWeightValue} color="bg-emerald-400" />
                <WeightBar label="w6: ▲残り数" value={aiWeights.trInv} maxVal={maxWeightValue} color="bg-teal-400" />
                <WeightBar label="w7: ●残り数" value={aiWeights.ciInv} maxVal={maxWeightValue} color="bg-green-400" />
                <WeightBar label="w8: 中央支配" value={aiWeights.center} maxVal={maxWeightValue} color="bg-violet-400" />
                <WeightBar label="w9: リーチ" value={aiWeights.completion} maxVal={maxWeightValue} color="bg-pink-400" />
                <WeightBar label="w10: パターン回避" value={aiWeights.patternAvoid} maxVal={maxWeightValue} color="bg-red-400" desc="過去に負けにつながった手を避ける重み" />
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-xs text-slate-400">
                <div className="font-bold text-slate-300 mb-2">💡 AI強化機構</div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer hover:text-slate-300">
                    <input type="checkbox" checked={enableOpeningBook} onChange={(e) => setEnableOpeningBook(e.target.checked)} disabled={isTraining} className="w-3 h-3 rounded" />
                    <span>📖 オープニングブック（初手の最適応答を学習）</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer hover:text-slate-300">
                    <input type="checkbox" checked={enableTemperature} onChange={(e) => setEnableTemperature(e.target.checked)} disabled={isTraining} className="w-3 h-3 rounded" />
                    <span>🌡️ 温度付き探索（多様な戦略の発見）</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer hover:text-slate-300">
                    <input type="checkbox" checked={enableTransposition} onChange={(e) => setEnableTransposition(e.target.checked)} disabled={isTraining} className="w-3 h-3 rounded" />
                    <span>⚡ トランスポジション表（同一盤面の再計算を削減）</span>
                  </label>
                  {enableTemperature && (
                    <div className="ml-5 mt-2">
                      <div className="flex justify-between text-[10px] mb-1">
                        <span>温度パラメータ (τ)</span>
                        <span className="font-mono text-amber-400">{temperature.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="2.0"
                        step="0.1"
                        value={temperature}
                        onChange={(e) => setTemperature(parseFloat(e.target.value))}
                        disabled={isTraining || !enableTemperature}
                        className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
                      />
                      <p className="text-[9px] text-slate-500 mt-1">低いほど最適手の確率を重視、高いほど多様性を重視</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: ARCHIVE */}
        {activeTab === "archive" && (
          <div className="grid gap-6 md:grid-cols-[280px_1fr]">
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-900/50 p-4 max-h-[70vh] overflow-y-auto">
              <h2 className="text-base font-bold border-b border-slate-700 pb-1.5 text-indigo-300">📜 記録済み盤面</h2>
              {savedGames.length === 0 ? <div className="text-center text-slate-500 py-8 text-sm">記録なし</div> : (
                <div className="flex flex-col gap-2">
                  {savedGames.map(g => (
                    <div key={g.id} onClick={() => setViewingSavedGame(g)} className={`group relative flex flex-col gap-1 rounded-xl border p-2.5 cursor-pointer transition ${viewingSavedGame?.id === g.id ? "border-amber-400 bg-amber-400/10" : "border-slate-700 bg-slate-800/40 hover:bg-slate-800/80"}`}>
                      <button onClick={(e) => deleteSavedGame(g.id, e)} className="absolute top-2 right-2 rounded p-1 text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100">🗑️</button>
                      <div className="pr-6 font-bold text-xs text-slate-200 truncate">{g.name}</div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                        <span>{g.date.split(" ")[0]} ({g.moveCount}手)</span>
                        <span className={`rounded px-1 font-bold ${g.winner === "white" ? "bg-slate-100 text-slate-900" : g.winner === "black" ? "bg-slate-950 text-slate-100 border border-slate-700" : "bg-slate-700 text-slate-200"}`}>{g.winner === "white" ? "白勝" : g.winner === "black" ? "黒勝" : "引分"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/50 p-6">
              {viewingSavedGame ? (
                <div className="flex flex-col items-center gap-4 w-full">
                  <div className="text-center w-full max-w-[480px]">
                    <div className="text-sm font-bold text-amber-300">🔍 盤面リプレイ</div>
                    <div className="text-xl font-black text-slate-100 mt-0.5">{viewingSavedGame.name}</div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 rounded-2xl border border-slate-600 bg-slate-950 p-3" style={{ width: "min(420px, 80vw)" }}>
                    {viewingSavedGame.board.map((row, r) => row.map((cell, c) => <CellView key={`v-${r}-${c}`} cell={cell} isValid={false} isLast={false} onClick={() => {}} />))}
                  </div>
                  <div className="flex w-full max-w-[420px] gap-3 text-xs">
                    <div className="flex-1 rounded-xl border border-slate-800 bg-slate-900/80 p-2.5 text-center">
                      <div className="text-slate-400">白支配</div>
                      <div className="text-lg font-black text-slate-100">{countTowers(viewingSavedGame.board).white}</div>
                    </div>
                    <div className="flex-1 rounded-xl border border-slate-800 bg-slate-900/80 p-2.5 text-center">
                      <div className="text-slate-400">勝者</div>
                      <div className={`text-sm font-bold mt-1 inline-block px-2 py-0.5 rounded ${viewingSavedGame.winner === "white" ? "bg-slate-100 text-slate-900" : viewingSavedGame.winner === "black" ? "bg-slate-950 text-slate-100 border border-slate-700" : "bg-slate-700 text-slate-200"}`}>{viewingSavedGame.winner === "white" ? "👑 白" : viewingSavedGame.winner === "black" ? "👑 黒" : "引分"}</div>
                    </div>
                    <div className="flex-1 rounded-xl border border-slate-800 bg-slate-900/80 p-2.5 text-center">
                      <div className="text-slate-400">黒支配</div>
                      <div className="text-lg font-black text-slate-100">{countTowers(viewingSavedGame.board).black}</div>
                    </div>
                  </div>
                  <button onClick={() => setViewingSavedGame(null)} className="mt-2 rounded bg-slate-800 border border-slate-700 hover:bg-slate-700 px-4 py-1.5 text-xs text-slate-200">閉じる</button>
                </div>
              ) : (
                <div className="flex flex-col items-center py-20 text-slate-500 text-center">
                  <span className="text-4xl mb-3">📜</span>
                  <div className="text-sm font-bold">盤面を選択</div>
                </div>
              )}
            </div>
          </div>
        )}

        <RulesPanel />
      </div>

      {gameOver && activeTab === "game" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="max-w-md w-full rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center shadow-2xl">
            <div className="mb-2 text-xs uppercase tracking-widest text-slate-400">対局終了</div>
            <div className="mb-4 text-3xl font-black bg-gradient-to-r from-amber-300 to-rose-300 bg-clip-text text-transparent">
              {winner === "white" && "🏆 白の勝利！"}
              {winner === "black" && "🏆 黒の勝利！"}
              {winner === "draw" && "🤝 引き分け"}
            </div>
            <div className="mb-6 rounded-xl bg-slate-800/80 p-3 border border-slate-700/50 text-xs text-slate-300">
              <div className="flex items-center justify-around mb-2">
                <div><div className="text-[10px] text-slate-400">白</div><div className="text-2xl font-black text-slate-100">{towers.white}</div></div>
                <div className="text-xl text-slate-500 font-bold">VS</div>
                <div><div className="text-[10px] text-slate-400">黒</div><div className="text-2xl font-black text-slate-100">{towers.black}</div></div>
              </div>
            </div>
            <button onClick={resetGame} className="w-full rounded-xl bg-gradient-to-r from-amber-400 to-rose-500 px-5 py-2.5 font-bold text-slate-950 hover:scale-[1.02] shadow-lg">もう一度</button>
          </div>
        </div>
      )}
    </div>
  );
}

function WeightBar({ label, value, maxVal, color, desc }: { label: string; value: number; maxVal: number; color: string; desc?: string }) {
  const percentage = maxVal === 0 ? 0 : Math.min((Math.abs(value) / maxVal) * 100, 100);
  return (
    <div className="group rounded-xl bg-slate-800/40 p-1.5 border border-slate-700/50 hover:bg-slate-800/70 transition">
      <div className="flex items-center justify-between font-semibold mb-0.5">
        <span className="text-[11px] text-slate-200">{label}</span>
        <span className="font-mono text-[11px] text-slate-100">{value > 0 ? "+" : ""}{value.toFixed(1)}</span>
      </div>
      <div className="relative w-full h-1.5 bg-slate-900 rounded overflow-hidden">
        <div className={`absolute inset-y-0 ${value < 0 ? "right-1/2" : "left-1/2"} ${color} rounded-sm`} style={{ width: `${percentage / 2}%` }}></div>
      </div>
      {desc && <p className="max-h-0 opacity-0 group-hover:max-h-8 group-hover:opacity-100 overflow-hidden text-[9px] text-slate-400 mt-0.5 transition-all">{desc}</p>}
    </div>
  );
}

function StatusBar({ currentPlayer, gameOver, winner, fallback, lastMove, legalCount, bannedShape, aiThinking, searchStats, aiDifficulty, lostPatternsCount }: { currentPlayer: Color; gameOver: boolean; winner: Color | "draw" | null; fallback: boolean; lastMove: LastMove | null; legalCount: number; bannedShape: Shape | null; aiThinking: boolean; searchStats: { nodes: number; eval: number; patternsAvoided: number } | null; aiDifficulty: string; lostPatternsCount: number }) {
  let msg = "";
  let subMsg = "";
  if (gameOver) msg = winner === "draw" ? "終了 — 引き分け" : `終了 — ${winner === "white" ? "白" : "黒"}の勝ち`;
  else if (aiThinking) { msg = `${currentPlayer === "white" ? "白" : "黒"} (AI) 思考中...`; if (searchStats && aiDifficulty === "master") subMsg = `探索: ${searchStats.nodes} | 回避パターン: ${lostPatternsCount}`; }
  else if (!lastMove) msg = "白の番 — 初手";
  else if (fallback) msg = `${currentPlayer === "white" ? "白" : "黒"}の番 — ルール3適用`;
  else msg = `${currentPlayer === "white" ? "白" : "黒"}の番`;

  return (
    <div className="flex w-full max-w-[540px] flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-600 bg-slate-900/80 px-4 py-2 text-sm shadow-md">
      <div className="flex items-center gap-2">
        <span className={`h-3 w-3 rounded-full ${aiThinking ? "bg-amber-400 animate-ping" : gameOver ? "bg-slate-500" : currentPlayer === "white" ? "bg-slate-100" : "bg-slate-950 ring-1 ring-slate-100/50"}`} />
        <div className="flex flex-col">
          <span className="font-semibold text-slate-100">{msg}</span>
          {subMsg && <span className="font-mono text-[10px] text-amber-400">{subMsg}</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
        {bannedShape && <span className="rounded bg-rose-950/40 px-1.5 py-0.5 text-rose-300 font-bold">{bannedShape === "square" ? "■" : bannedShape === "triangle" ? "▲" : "●"}不可</span>}
        <span>合法手: <span className="font-bold text-slate-200">{legalCount}</span></span>
      </div>
    </div>
  );
}

function PlayerPanel({ color, inventory, isCurrent, towers, partials, selectedShape, selectedDir, onSelectShape, onSelectDir, disabled, bannedShape, validTriangleDirs, isAI }: { color: Color; inventory: Record<Shape, number>; isCurrent: boolean; towers: number; partials: number; selectedShape: Shape; selectedDir: Direction; onSelectShape: (s: Shape) => void; onSelectDir: (d: Direction) => void; disabled: boolean; bannedShape: Shape | null; validTriangleDirs: Set<Direction>; isAI: boolean }) {
  const name = color === "white" ? "白 (先手)" : "黒 (後手)";
  return (
    <div className={`rounded-2xl border-2 p-4 transition ${isCurrent ? "border-amber-400 bg-slate-900/80 shadow-lg" : "border-slate-700 bg-slate-900/30 opacity-75"}`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-4 w-4 rounded-full ${color === "white" ? "bg-slate-100" : "bg-slate-950 border border-slate-100/40"}`} />
          <div className="flex flex-col">
            <span className="font-bold text-slate-100">{name}</span>
            <span className="text-[10px] text-slate-400">{isAI ? "🤖 AI" : "👤 人間"}</span>
          </div>
        </div>
        <div className="rounded-lg bg-slate-800 border border-slate-700/50 px-2 py-1 text-xs">支配塔 <span className="text-base font-black text-amber-300">{towers}</span><span className="ml-1 text-slate-500">/3</span></div>
      </div>
      <div className="mb-3 space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">駒を選択</div>
        <div className="grid grid-cols-3 gap-2">
          {SHAPES.map(shape => {
            const count = inventory[shape];
            const sel = selectedShape === shape;
            const isBanned = bannedShape === shape;
            return (
              <button key={shape} disabled={disabled || count === 0 || isBanned} onClick={() => onSelectShape(shape)} className={`flex flex-col items-center gap-1 rounded-xl border-2 p-2 transition ${sel && !disabled ? "border-amber-400 bg-amber-400/10" : "border-slate-700 bg-slate-800/50"} ${disabled || count === 0 || isBanned ? "opacity-30 cursor-not-allowed" : "hover:border-slate-500"}`}>
                <PieceIcon shape={shape} color={color} dir="up" size={32} />
                <div className="text-xs font-bold text-slate-200">×{count}</div>
                {isBanned && <div className="text-[9px] font-bold text-rose-400">使用不可</div>}
              </button>
            );
          })}
        </div>
      </div>
      <div className={`space-y-2 transition ${selectedShape === "triangle" ? "opacity-100" : "opacity-30"}`}>
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">▲ 三角の向き</div>
        <div className="grid grid-cols-4 gap-2">
          {DIRS.map(d => {
            const sel = selectedDir === d;
            const isActive = selectedShape === "triangle" && !disabled;
            const dirValid = validTriangleDirs.has(d);
            return (
              <button key={d} disabled={!isActive || !dirValid} onClick={() => onSelectDir(d)} className={`flex items-center justify-center rounded-lg border-2 p-1.5 transition ${sel && isActive && dirValid ? "border-amber-400 bg-amber-400/10" : "border-slate-700 bg-slate-800/50"} ${!isActive || !dirValid ? "opacity-30 cursor-not-allowed" : "hover:border-slate-500"}`}>
                <PieceTriangle color={color} dir={d} size={24} />
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-400 font-mono">
        <div className="rounded bg-slate-800/50 px-2 py-1 border border-slate-700/30">残り: <span className="font-bold text-slate-200">{inventory.square + inventory.triangle + inventory.circle}</span></div>
        <div className="rounded bg-slate-800/50 px-2 py-1 border border-slate-700/30">優勢: <span className="font-bold text-slate-200">{partials}</span></div>
      </div>
    </div>
  );
}

function RulesPanel() {
  return (
    <details className="mt-6 rounded-xl border border-slate-700 bg-slate-900/40 p-4 text-xs text-slate-400">
      <summary className="cursor-pointer text-sm font-bold text-slate-200">📜 ピルガ公式ルール</summary>
      <div className="mt-3 space-y-2 leading-relaxed">
        <p><strong>概要</strong>: 3つの塔を支配した最初のプレイヤーが勝利。</p>
        <p><strong>配置</strong>: 各マスには ■▲● をそれぞれ最大1つずつ配置。</p>
        <p><strong>移動制限</strong>: 直前の駒が ■→隣接、▲→頂点方向同列、●→同マス</p>
        <p><strong>先手2手目制限</strong>: 1手目と同じ駒は選べない</p>
        <p><strong>三角の向き</strong>: 盤面外を指せない</p>
      </div>
    </details>
  );
}
