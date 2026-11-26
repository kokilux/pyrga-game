import { WIN_SCORE } from "./constants";
import {
  cloneBoard,
  cloneInventory,
  countTowers,
  checkGameOverState,
  generateAllLegalMoves,
  getBannedShape,
  featureSimilarity,
  getFeatureVector,
  hashBoard,
  hashMove,
  pieceCounts,
  dirVector,
} from "./rules";
import { zobristKey } from "./zobrist";
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
    f.threat * weights.threat -
    f.oppThreat * weights.oppThreat +
    f.doubleThreat * weights.doubleThreat +
    f.lineControl * weights.lineControl +
    f.cornerControl * weights.cornerControl +
    f.shapeDiversity * weights.shapeDiversity -
    f.giveawayRisk * weights.giveawayRisk +
    f.linePressure * weights.linePressure +
    f.circleTempo * weights.circleTempo -
    f.endgameRisk * weights.endgameRisk;

  // Nonlinear interaction terms (small but helpful)
  baseScore += f.doubleThreat * 80; // extra bonus beyond linear weight
  if (f.threat > 0 && f.mobility < 0) baseScore -= 60; // threats but no mobility = dangerous
  if (f.tower >= 2) baseScore += f.threat * 40; // threats near win are critical

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

function scoreMoveHeuristically(m: FullLegalMove, board: Cell[][], player: Color, inv: Inventory): number {
  let score = 0;
  const cell = board[m.row][m.col];
  const pieces = pieceCounts(cell);
  const opponent: Color = player === "white" ? "black" : "white";
  const sum = pieces.white + pieces.black;

  if (sum === 2) {
    if (pieces[player] >= 1) score += 3000; // immediate tower completion
    else score -= 300;
  }

  // Dangerous move: creates a 2-piece cell that opponent can complete immediately
  const newSum = sum + 1;
  if (newSum === 2) {
    const hasSquare = !!cell.square || m.shape === "square";
    const hasTriangle = !!cell.triangle || m.shape === "triangle";
    const missing = !hasSquare ? "square" : !hasTriangle ? "triangle" : "circle";
    const oppCanComplete = inv[opponent][missing] > 0;
    const oppWouldOwn = (pieces[opponent] + 1) > pieces[player];
    const iWouldOwn = (pieces[player] + 1) > pieces[opponent];
    if (oppCanComplete && oppWouldOwn && !iWouldOwn) score -= 2500;
  }

  // Rule2/3 tempo: triangle pointing at many targets is good
  if (m.shape === "triangle") {
    const dir = m.dir!;
    const [dr, dc] = dirVector(dir);
    let rr = m.row + dr, cc = m.col + dc, line = 0;
    while (rr >= 0 && rr < 4 && cc >= 0 && cc < 4) { line++; rr += dr; cc += dc; }
    score += line * 4;
  }

  if (m.row >= 1 && m.row <= 2 && m.col >= 1 && m.col <= 2) score += 30;
  if (m.shape === "circle") score += 6;
  if (m.shape === "triangle") score += 3;
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
  killers?: FullLegalMove[][];
  historyTable?: Record<string, number>;
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
    ? `${zobristKey(board, currentPlayer)}|${historyLen}`
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

  if (depth <= 0) {
    const opp: Color = isMax ? "black" : "white";
    const oppBanned = getBannedShape(opp, historyLen, whiteFirstShape);
    const oppMovesCount = generateAllLegalMoves(board, lastMove, inv[opp], oppBanned).length;
    const whiteMovesCount = isMax ? moves.length : oppMovesCount;
    const blackMovesCount = isMax ? oppMovesCount : moves.length;
    const standPat = evaluateBoard(board, whiteMovesCount, blackMovesCount, inv, weights, currentMove, currentPlayer, lostPatterns, winPatterns);

    // Quiescence: only explore tactical tower-completion moves at leaf.
    const tactical = moves.filter((m) => {
      const cell = board[m.row][m.col];
      const pieces = pieceCounts(cell);
      if (pieces.white + pieces.black !== 2) return false;
      const missing = !cell.square ? "square" : !cell.triangle ? "triangle" : "circle";
      if (m.shape !== missing) return false;
      const own = pieces[currentPlayer] + 1;
      const oppC = pieces[currentPlayer === "white" ? "black" : "white"];
      return own > oppC;
    });

    if (tactical.length === 0 || depth <= -2) {
      return { score: standPat, move: null };
    }

    if (isMax) {
      let best = standPat;
      if (best >= beta) return { score: best, move: null };
      if (best > alpha) alpha = best;
      for (const m of tactical) {
        const { board: nb, inv: ni } = applyMove(board, inv, m, "white");
        const nl: LastMove = { shape: m.shape, row: m.row, col: m.col, dir: m.dir, by: "white" };
        const r = alphaBeta(nb, nl, whiteFirstShape, historyLen + 1, depth - 1, alpha, beta, false, ni, weights, stats, lostPatterns, winPatterns, m, options);
        if (r.score > best) best = r.score;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return { score: best, move: null };
    } else {
      let best = standPat;
      if (best <= alpha) return { score: best, move: null };
      if (best < beta) beta = best;
      for (const m of tactical) {
        const { board: nb, inv: ni } = applyMove(board, inv, m, "black");
        const nl: LastMove = { shape: m.shape, row: m.row, col: m.col, dir: m.dir, by: "black" };
        const r = alphaBeta(nb, nl, whiteFirstShape, historyLen + 1, depth - 1, alpha, beta, true, ni, weights, stats, lostPatterns, winPatterns, m, options);
        if (r.score < best) best = r.score;
        if (best < beta) beta = best;
        if (alpha >= beta) break;
      }
      return { score: best, move: null };
    }
  }

  // Move ordering: TT move + heuristic + killers + history
  const ttMove = ttKey && options.transpositionTable ? options.transpositionTable.get(ttKey)?.move : null;
  const killers = options.killers?.[depth] ?? [];
  const scoredMoves = moves
    .map((m) => {
      let hScore = scoreMoveHeuristically(m, board, currentPlayer, inv);
      if (ttMove && m.row === ttMove.row && m.col === ttMove.col && m.shape === ttMove.shape && m.dir === ttMove.dir) hScore += 100000;
      if (killers.some((k) => k.row===m.row && k.col===m.col && k.shape===m.shape && k.dir===m.dir)) hScore += 5000;
      hScore += (options.historyTable?.[`${currentPlayer}:${hashMove(m)}`] ?? 0);
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
    if (beta <= alpha) {
      if (options.killers) {
        const dArr = options.killers[depth] ?? (options.killers[depth] = []);
        if (!dArr.some((k) => k.row===m.row && k.col===m.col && k.shape===m.shape && k.dir===m.dir)) { dArr.unshift(m); if (dArr.length > 2) dArr.pop(); }
      }
      if (options.historyTable) { const hk = `${currentPlayer}:${hashMove(m)}`; options.historyTable[hk] = (options.historyTable[hk] ?? 0) + depth * depth; }
      break;
    }
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

  let maxDepth = difficulty === "normal" ? 3 : difficulty === "hard" ? 4 : 5;
  const totalInv = inv.white.square+inv.white.triangle+inv.white.circle+inv.black.square+inv.black.triangle+inv.black.circle;
  const endgame = totalInv <= 10; // few pieces left -> search deeper
  if (endgame) maxDepth += 2;
  const stats: SearchStats = { nodes: 0, patternsAvoided: 0 };
  const tt = options.enableTransposition ? new Map<string, { depth: number; score: number; flag: "exact" | "lower" | "upper"; move: FullLegalMove | null }>() : undefined;
  const killers: FullLegalMove[][] = Array.from({ length: maxDepth + 2 }, () => []);
  const historyTable: Record<string, number> = {};
  const complexity = Math.min(1.8, Math.max(0.5, moves.length / 18));
  const baseMs = options.timeLimitMs ?? (difficulty === "master" ? (endgame ? 6000 : 4000) : difficulty === "hard" ? (endgame ? 2500 : 1800) : (endgame ? 1400 : 900));
  const nodeLimit = options.nodeLimit ?? Math.floor((difficulty === "master" ? (endgame ? 180000 : 90000) : difficulty === "hard" ? (endgame ? 80000 : 40000) : (endgame ? 35000 : 20000)) * complexity);
  const deadlineMs = Date.now() + Math.floor(baseMs * complexity);

  if (options.enableTemperature) {
    const temp = Math.max(0.1, options.temperature ?? 0.5);
    const scored = moves.map((m) => {
      const { board: nextBoard, inv: nextInv } = applyMove(board, inv, m, player);
      const nextLast: LastMove = { shape: m.shape, row: m.row, col: m.col, dir: m.dir, by: player };
      const res = alphaBeta(nextBoard, nextLast, whiteFirstShape, historyLen + 1, Math.max(1, maxDepth - 1), -Infinity, Infinity, !isMax, nextInv, weights, stats, lostPatterns, winPatterns, m, { useTranspositionTable: !!options.enableTransposition, transpositionTable: tt, nodeLimit, deadlineMs, killers, historyTable });
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

  // Iterative deepening with aspiration windows and root scoring for proven-loss detection.
  let bestMove: FullLegalMove | null = null;
  let bestScore = isMax ? -Infinity : Infinity;
  let rootScores: { move: FullLegalMove; score: number }[] = [];
  let prevScore = 0;

  for (let d = 1; d <= maxDepth; d++) {
    const ttMove = tt?.get(`${zobristKey(board, player)}|${historyLen}`)?.move;
    const ordered = moves
      .map((m) => ({ move: m, h: scoreMoveHeuristically(m, board, player, inv) + (ttMove && m.row===ttMove.row && m.col===ttMove.col && m.shape===ttMove.shape && m.dir===ttMove.dir ? 100000 : 0) + (historyTable[`${player}:${hashMove(m)}`] ?? 0) }))
      .sort((a,b)=>b.h-a.h)
      .map((x)=>x.move);

    let window = 120;
    let alphaW = d > 1 ? prevScore - window : -Infinity;
    let betaW = d > 1 ? prevScore + window : Infinity;
    let completed = false;

    while (!completed) {
      let localBest: FullLegalMove | null = null;
      let localBestScore = isMax ? -Infinity : Infinity;
      let alpha = alphaW, beta = betaW;
      const scores: { move: FullLegalMove; score: number }[] = [];

      for (const m of ordered) {
        const { board: nextBoard, inv: nextInv } = applyMove(board, inv, m, player);
        const nextLast: LastMove = { shape: m.shape, row: m.row, col: m.col, dir: m.dir, by: player };
        const res = alphaBeta(nextBoard, nextLast, whiteFirstShape, historyLen + 1, d - 1, alpha, beta, !isMax, nextInv, weights, stats, lostPatterns, winPatterns, m, { useTranspositionTable: !!options.enableTransposition, transpositionTable: tt, nodeLimit, deadlineMs, killers, historyTable });
        scores.push({ move: m, score: res.score });
        if (isMax) {
          if (res.score > localBestScore) { localBestScore = res.score; localBest = m; }
          alpha = Math.max(alpha, res.score);
        } else {
          if (res.score < localBestScore) { localBestScore = res.score; localBest = m; }
          beta = Math.min(beta, res.score);
        }
        if ((options.nodeLimit && stats.nodes > options.nodeLimit) || Date.now() > deadlineMs) break;
      }

      const failedLow = localBestScore <= alphaW;
      const failedHigh = localBestScore >= betaW;
      if ((failedLow || failedHigh) && alphaW !== -Infinity && betaW !== Infinity && window < 2000) {
        if (failedLow) alphaW = -Infinity;
        if (failedHigh) betaW = Infinity;
        window *= 2;
        continue;
      }

      if (localBest) { bestMove = localBest; bestScore = localBestScore; rootScores = scores; prevScore = localBestScore; }
      completed = true;
      if (Math.abs(localBestScore) >= WIN_SCORE) { d = maxDepth; } // break outer
    }

    if ((options.nodeLimit && stats.nodes > options.nodeLimit) || Date.now() > deadlineMs) break;
    if (Math.abs(bestScore) >= WIN_SCORE) break;
  }

  // Proven-loss moves: clearly losing within searched horizon.
  const lossThreshold = isMax ? -WIN_SCORE / 2 : WIN_SCORE / 2;
  const provenLossMoves = rootScores.filter((rs) => isMax ? rs.score <= lossThreshold : rs.score >= lossThreshold).map((rs) => rs.move);

  return { move: bestMove || moves[Math.floor(Math.random() * moves.length)], stats: { ...stats, eval: bestScore, provenLossMoves } };
}
