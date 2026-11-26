import { SIZE } from "./constants";
import { hashBoard } from "./rules";
import type { BoardHash, Cell, Color, Direction, FullLegalMove } from "./types";

type Coord = { r: number; c: number };

function rot90(p: Coord): Coord { return { r: p.c, c: SIZE - 1 - p.r }; }
function rot180(p: Coord): Coord { return { r: SIZE - 1 - p.r, c: SIZE - 1 - p.c }; }
function rot270(p: Coord): Coord { return { r: SIZE - 1 - p.c, c: p.r }; }
function mirrorH(p: Coord): Coord { return { r: p.r, c: SIZE - 1 - p.c }; } // horizontal mirror

function rotDir90(d: Direction): Direction { return ({ up: "right", right: "down", down: "left", left: "up" } as const)[d]; }
function rotDir180(d: Direction): Direction { return ({ up: "down", right: "left", down: "up", left: "right" } as const)[d]; }
function rotDir270(d: Direction): Direction { return ({ up: "left", right: "up", down: "right", left: "down" } as const)[d]; }
function mirrorDirH(d: Direction): Direction { return ({ up: "up", down: "down", left: "right", right: "left" } as const)[d]; }

type Transform = {
  coord: (p: Coord) => Coord;
  dir: (d: Direction) => Direction;
};

const TRANSFORMS: Transform[] = [
  { coord: (p) => p, dir: (d) => d },
  { coord: rot90, dir: rotDir90 },
  { coord: rot180, dir: rotDir180 },
  { coord: rot270, dir: rotDir270 },
  { coord: mirrorH, dir: mirrorDirH },
  { coord: (p) => rot90(mirrorH(p)), dir: (d) => rotDir90(mirrorDirH(d)) },
  { coord: (p) => rot180(mirrorH(p)), dir: (d) => rotDir180(mirrorDirH(d)) },
  { coord: (p) => rot270(mirrorH(p)), dir: (d) => rotDir270(mirrorDirH(d)) },
];

export function transformBoard(board: Cell[][], t: Transform): Cell[][] {
  const out: Cell[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => ({ square: null, triangle: null, circle: null })));
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = t.coord({ r, c });
      const cell = board[r][c];
      out[p.r][p.c] = {
        square: cell.square,
        triangle: cell.triangle ? { color: cell.triangle.color, dir: t.dir(cell.triangle.dir) } : null,
        circle: cell.circle,
      };
    }
  }
  return out;
}

export function transformMove(m: FullLegalMove, t: Transform): FullLegalMove {
  const p = t.coord({ r: m.row, c: m.col });
  return { row: p.r, col: p.c, shape: m.shape, dir: m.dir ? t.dir(m.dir) : undefined };
}

export function canonicalBoardHash(board: Cell[][], currentPlayer: Color): BoardHash {
  let best: string | null = null;
  for (const t of TRANSFORMS) {
    const h = hashBoard(transformBoard(board, t), currentPlayer);
    if (best === null || h < best) best = h;
  }
  return best!;
}

export function canonicalizePattern(board: Cell[][], currentPlayer: Color, move: FullLegalMove): { hash: BoardHash; move: FullLegalMove } {
  let bestHash: string | null = null;
  let bestMove: FullLegalMove = move;
  for (const t of TRANSFORMS) {
    const h = hashBoard(transformBoard(board, t), currentPlayer);
    if (bestHash === null || h < bestHash) {
      bestHash = h;
      bestMove = transformMove(move, t);
    }
  }
  return { hash: bestHash!, move: bestMove };
}
