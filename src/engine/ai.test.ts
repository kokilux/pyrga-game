import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS } from "./constants";
import { getAIMove } from "./ai";
import { emptyBoard, generateAllLegalMoves, startingInventory } from "./rules";
import type { FullLegalMove, LastMove } from "./types";

function isLegal(move: FullLegalMove, legals: FullLegalMove[]): boolean {
  return legals.some(
    (m) => m.row === move.row && m.col === move.col && m.shape === move.shape && m.dir === move.dir,
  );
}

describe("AI", () => {
  it("returns a legal move for each difficulty", () => {
    const board = emptyBoard();
    const inv = startingInventory();
    const last: LastMove | null = null;
    for (const difficulty of ["easy", "normal", "hard"] as const) {
      const legals = generateAllLegalMoves(board, last, inv.white, null);
      const result = getAIMove(board, last, null, 0, "white", inv, DEFAULT_WEIGHTS, difficulty, [], []);
      expect(isLegal(result.move, legals)).toBe(true);
    }
  });

  it("supports temperature and transposition options without crashing", () => {
    const board = emptyBoard();
    const inv = startingInventory();
    const legals = generateAllLegalMoves(board, null, inv.white, null);
    const result = getAIMove(board, null, null, 0, "white", inv, DEFAULT_WEIGHTS, "hard", [], [], {
      enableTemperature: true,
      temperature: 0.8,
      enableTransposition: true,
      enableOpeningBook: true,
    });
    expect(isLegal(result.move, legals)).toBe(true);
    expect(Number.isFinite(result.stats.eval)).toBe(true);
  });

  it("uses opening book when a matching win pattern exists", () => {
    const board = emptyBoard();
    const inv = startingInventory();
    const legals = generateAllLegalMoves(board, null, inv.white, null);
    const bookMove = legals[0];
    const winPatterns = [
      {
        boardHash: "W" + ".".repeat(48),
        features: { ...DEFAULT_WEIGHTS, patternAvoid: 0 },
        move: bookMove,
        player: "white" as const,
        gamePhase: 0,
        timestamp: Date.now(),
      },
    ];
    const result = getAIMove(board, null, null, 0, "white", inv, DEFAULT_WEIGHTS, "hard", [], winPatterns, {
      enableOpeningBook: true,
    });
    expect(result.move).toEqual(bookMove);
  });
});
