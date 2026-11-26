/// <reference lib="webworker" />
import { getAIMove } from "../engine/ai";
import { DEFAULT_WEIGHTS, MAX_PATTERNS } from "../engine/constants";
import { appendBoundedPatterns, evaluateAgainstBaseline, extractLearningPatterns, runSelfPlayGame, sanitizeWeights, updateWeightsTD } from "../engine/learning";
import type { AIWeights, Cell, Color, Inventory, LastMove, LostPattern, WinPattern } from "../engine/types";

type AiMoveRequest = {
  type: "ai-move";
  id: string;
  payload: {
    board: Cell[][];
    lastMove: LastMove | null;
    whiteFirstShape: import("../engine/types").Shape | null;
    historyLen: number;
    player: Color;
    inv: Inventory;
    weights: AIWeights;
    difficulty: "easy" | "normal" | "hard" | "master";
    lostPatterns: LostPattern[];
    winPatterns: WinPattern[];
    options?: {
      enableOpeningBook?: boolean;
      enableTemperature?: boolean;
      enableTransposition?: boolean;
      temperature?: number;
    };
  };
};

type TrainBatchRequest = {
  type: "train-batch";
  id: string;
  payload: {
    weights: AIWeights;
    lostPatterns: LostPattern[];
    winPatterns: WinPattern[];
    epsilon: number;
    learningRate: number;
    count: number;
  };
};

type EvaluateRequest = {
  type: "evaluate-baseline";
  id: string;
  payload: { weights: AIWeights; baseline: AIWeights; games: number };
};

type WorkerRequest = AiMoveRequest | TrainBatchRequest | EvaluateRequest;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === "ai-move") {
      const r = msg.payload;
      const result = getAIMove(
        r.board,
        r.lastMove,
        r.whiteFirstShape,
        r.historyLen,
        r.player,
        r.inv,
        r.weights,
        r.difficulty,
        r.lostPatterns,
        r.winPatterns,
        r.options,
      );
      self.postMessage({ type: "ai-move-result", id: msg.id, ok: true, result });
      return;
    }

    if (msg.type === "evaluate-baseline") {
      const r = msg.payload;
      const result = evaluateAgainstBaseline(sanitizeWeights(r.weights, DEFAULT_WEIGHTS), sanitizeWeights(r.baseline, DEFAULT_WEIGHTS), r.games ?? 20);
      self.postMessage({ type: "evaluate-baseline-result", id: msg.id, ok: true, result });
      return;
    }

    if (msg.type === "train-batch") {
      const p = msg.payload;
      let currentWeights = sanitizeWeights(p.weights, DEFAULT_WEIGHTS);
      let currentLost = [...p.lostPatterns];
      let currentWin = [...p.winPatterns];
      let wWins = 0;
      let bWins = 0;
      let draws = 0;

      for (let i = 0; i < p.count; i++) {
        const gameRecord = runSelfPlayGame(currentWeights, currentLost, currentWin, p.epsilon);
        if (gameRecord.winner === "white") wWins++;
        else if (gameRecord.winner === "black") bWins++;
        else draws++;

        const { newLostPatterns, newWinPatterns } = extractLearningPatterns(gameRecord, currentLost, currentWin);
        currentLost = appendBoundedPatterns(currentLost, newLostPatterns, MAX_PATTERNS);
        currentWin = appendBoundedPatterns(currentWin, newWinPatterns, MAX_PATTERNS);
        currentWeights = sanitizeWeights(updateWeightsTD(currentWeights, gameRecord, p.learningRate), DEFAULT_WEIGHTS);

        const completed = i + 1;
        if (completed === p.count || completed % 5 === 0 || p.count <= 20) {
          self.postMessage({
            type: "train-progress",
            id: msg.id,
            ok: true,
            progress: Math.round((completed / p.count) * 100),
            completed,
            count: p.count,
            winner: gameRecord.winner,
            newLost: newLostPatterns.length,
            newWin: newWinPatterns.length,
          });
        }
      }

      // Promotion check: if new weights are much worse than original, blend back.
      const evalRes = evaluateAgainstBaseline(currentWeights, sanitizeWeights(p.weights, DEFAULT_WEIGHTS), 12);
      if (evalRes.wins + evalRes.losses > 0 && evalRes.wins / Math.max(1, evalRes.wins + evalRes.losses) < 0.35) {
        // Revert partially toward original
        const orig = sanitizeWeights(p.weights, DEFAULT_WEIGHTS);
        for (const k of Object.keys(currentWeights) as (keyof AIWeights)[]) {
          (currentWeights as any)[k] = ((currentWeights as any)[k] * 0.3 + (orig as any)[k] * 0.7);
        }
        currentWeights = sanitizeWeights(currentWeights, DEFAULT_WEIGHTS);
      }

      self.postMessage({
        type: "train-done",
        id: msg.id,
        ok: true,
        result: {
          weights: currentWeights,
          lostPatterns: currentLost,
          winPatterns: currentWin,
          whiteWins: wWins,
          blackWins: bWins,
          draws,
          totalGames: p.count,
          promotionEval: evalRes,
        },
      });
      return;
    }
  } catch (err) {
    self.postMessage({ type: "error", id: (msg as any).id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
