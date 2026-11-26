import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS } from "./constants";
import { evaluateAgainstBaseline, sanitizeWeights, updateWeightsTD } from "./learning";
import type { GameRecord } from "./types";

describe("learning stabilization", () => {
  it("sanitizeWeights clamps invalid/NaN values and enforces key ranges", () => {
    const dirty = {
      ...DEFAULT_WEIGHTS,
      tower: Number.NaN,
      partial2: 99999,
      completion: -100,
      patternAvoid: -50,
      mobility: Number.POSITIVE_INFINITY,
    } as any;
    const s = sanitizeWeights(dirty, DEFAULT_WEIGHTS);
    for (const v of Object.values(s)) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(s.tower).toBeGreaterThanOrEqual(100);
    expect(s.completion).toBeGreaterThanOrEqual(0);
    expect(s.patternAvoid).toBeGreaterThanOrEqual(0);
    expect(s.partial2).toBeLessThanOrEqual(5000);
  });

  it("updateWeightsTD returns finite weights within bounds", () => {
    const record: GameRecord = {
      winner: "white",
      loser: "black",
      moves: [
        {
          board: [],
          player: "white",
          move: { row: 0, col: 0, shape: "square" },
          features: { ...DEFAULT_WEIGHTS, tower: 1, partial2: 1, partial1: 1, mobility: 2, sqInv: 1, trInv: 0, ciInv: 0, center: 1, completion: 1, patternAvoid: 0 },
        },
        {
          board: [],
          player: "black",
          move: { row: 0, col: 1, shape: "square" },
          features: { ...DEFAULT_WEIGHTS, tower: 0, partial2: 0, partial1: 0, mobility: -1, sqInv: 0, trInv: 0, ciInv: 0, center: 0, completion: 0, patternAvoid: 0 },
        },
      ],
    };
    const next = updateWeightsTD(DEFAULT_WEIGHTS, record, 0.01);
    for (const [k, v] of Object.entries(next)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-2000);
      expect(v).toBeLessThanOrEqual(5000);
      void k;
    }
  });

  it("evaluateAgainstBaseline returns valid counts", () => {
    const res = evaluateAgainstBaseline(DEFAULT_WEIGHTS, DEFAULT_WEIGHTS, 4);
    expect(res.wins + res.losses + res.draws).toBe(4);
    expect(res.wins).toBeGreaterThanOrEqual(0);
    expect(res.losses).toBeGreaterThanOrEqual(0);
    expect(res.draws).toBeGreaterThanOrEqual(0);
  });
});
