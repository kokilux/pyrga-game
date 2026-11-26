import { describe, expect, it } from "vitest";
import {
  checkGameOverState,
  countTowers,
  emptyBoard,
  generateAllLegalMoves,
  getBannedShape,
  getLegalMoves,
  isDirValidForCell,
  partialOwner,
  rule2Cells,
  startingInventory,
  towerOwner,
} from "./rules";
import type { Cell, LastMove } from "./types";

function makeCell(overrides: Partial<Cell> = {}): Cell {
  return { square: null, triangle: null, circle: null, ...overrides };
}

describe("rules", () => {
  it("computes Rule 2 targets for square, triangle, and circle", () => {
    const sq: LastMove = { shape: "square", row: 1, col: 1, by: "white" };
    expect(rule2Cells(sq).sort((a, b) => a.row - b.row || a.col - b.col)).toEqual([
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 2 },
      { row: 2, col: 1 },
    ]);

    const tr: LastMove = { shape: "triangle", row: 2, col: 1, dir: "up", by: "black" };
    expect(rule2Cells(tr)).toEqual([
      { row: 1, col: 1 },
      { row: 0, col: 1 },
    ]);

    const ci: LastMove = { shape: "circle", row: 3, col: 3, by: "white" };
    expect(rule2Cells(ci)).toEqual([{ row: 3, col: 3 }]);
  });

  it("rejects triangle directions that point outside the board", () => {
    expect(isDirValidForCell(0, 0, "up")).toBe(false);
    expect(isDirValidForCell(0, 0, "left")).toBe(false);
    expect(isDirValidForCell(0, 0, "right")).toBe(true);
    expect(isDirValidForCell(3, 3, "down")).toBe(false);
  });

  it("applies Rule 3 fallback to any empty cell when Rule 2 has no legal moves", () => {
    const board = emptyBoard();
    // Fill adjacent cells around (1,1) so a square at (1,1) leaves no Rule 2 moves.
    for (const [r, c] of [
      [0, 1],
      [2, 1],
      [1, 0],
      [1, 2],
    ] as const) {
      board[r][c] = makeCell({ square: "white", triangle: { color: "white", dir: "up" }, circle: "white" });
    }
    const last: LastMove = { shape: "square", row: 1, col: 1, by: "white" };
    const inv = { square: 1, triangle: 1, circle: 1 };
    const { moves, fallback } = getLegalMoves(board, last, inv, null);
    expect(fallback).toBe(true);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => {
      const cell = board[m.row][m.col];
      return cell.square === null && cell.triangle === null && cell.circle === null;
    })).toBe(true);
  });

  it("enforces white's 2nd-move shape ban (historyLen==2)", () => {
    expect(getBannedShape("white", 2, "square")).toBe("square");
    expect(getBannedShape("white", 1, "square")).toBeNull();
    expect(getBannedShape("black", 2, "square")).toBeNull();
  });

  it("expands triangle moves only into valid directions", () => {
    const board = emptyBoard();
    const last: LastMove = { shape: "circle", row: 0, col: 0, by: "black" };
    const inv = { square: 0, triangle: 1, circle: 0 };
    const moves = generateAllLegalMoves(board, last, inv, null);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.shape === "triangle")).toBe(true);
    expect(moves.every((m) => isDirValidForCell(m.row, m.col, m.dir!))).toBe(true);
    const dirs = moves.map((m) => m.dir).sort();
    expect(dirs).toEqual(["down", "right"]);
  });

  it("determines tower ownership and game over / tie-breaks", () => {
    const board = emptyBoard();
    board[0][0] = makeCell({ square: "white", triangle: { color: "white", dir: "up" }, circle: "black" });
    board[0][1] = makeCell({ square: "white", triangle: { color: "white", dir: "up" }, circle: "black" });
    board[0][2] = makeCell({ square: "white", triangle: { color: "white", dir: "up" }, circle: "black" });
    expect(towerOwner(board[0][0])).toBe("white");
    expect(countTowers(board)).toEqual({ white: 3, black: 0 });
    expect(checkGameOverState(board, 5, { white: 3, black: 0 })).toEqual({ isOver: true, winner: "white" });

    // Tie-break on no legal moves: partial 2-piece advantage.
    const b2 = emptyBoard();
    b2[0][0] = makeCell({ square: "white", triangle: { color: "white", dir: "up" } });
    b2[1][1] = makeCell({ square: "black" });
    expect(partialOwner(b2[0][0], 2)).toBe("white");
    expect(checkGameOverState(b2, 0, { white: 0, black: 0 })).toEqual({ isOver: true, winner: "white" });
  });

  it("starting inventory has 5 of each shape per player", () => {
    const inv = startingInventory();
    for (const color of ["white", "black"] as const) {
      for (const shape of ["square", "triangle", "circle"] as const) {
        expect(inv[color][shape]).toBe(5);
      }
    }
  });

  it("does not allow moves on occupied shape slots", () => {
    const board = emptyBoard();
    board[1][1] = makeCell({ square: "white" });
    const last: LastMove = { shape: "circle", row: 1, col: 1, by: "black" };
    const moves = generateAllLegalMoves(board, last, { square: 1, triangle: 1, circle: 1 }, null);
    expect(moves.some((m) => m.row === 1 && m.col === 1 && m.shape === "square")).toBe(false);
    expect(moves.some((m) => m.row === 1 && m.col === 1 && m.shape === "triangle")).toBe(true);
  });
});
