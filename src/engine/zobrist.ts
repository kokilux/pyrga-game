import { SIZE } from "./constants";
import type { Cell, Color, Direction } from "./types";

function makeRng(seed: bigint) {
  let x = seed;
  return () => {
    x ^= x >> 12n;
    x ^= x << 25n;
    x ^= x >> 27n;
    return BigInt.asUintN(64, x * 2685821657736338717n);
  };
}

const rng = makeRng(0x9e3779b97f4a7c15n);
const rand = () => rng();
const dirIdx: Record<Direction, number> = { up: 0, right: 1, down: 2, left: 3 };

const SQ_W: bigint[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => rand()));
const SQ_B: bigint[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => rand()));
const TR_W: bigint[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => rand()));
const TR_B: bigint[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => rand()));
const TR_D: bigint[][][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => Array.from({ length: 4 }, () => rand())));
const CI_W: bigint[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => rand()));
const CI_B: bigint[][] = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => rand()));
const SIDE = rand();

export function zobristHash(board: Cell[][], currentPlayer: Color): bigint {
  let h = 0n;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = board[r][c];
      if (cell.square === "white") h ^= SQ_W[r][c];
      else if (cell.square === "black") h ^= SQ_B[r][c];
      if (cell.triangle) {
        h ^= cell.triangle.color === "white" ? TR_W[r][c] : TR_B[r][c];
        h ^= TR_D[r][c][dirIdx[cell.triangle.dir]];
      }
      if (cell.circle === "white") h ^= CI_W[r][c];
      else if (cell.circle === "black") h ^= CI_B[r][c];
    }
  }
  if (currentPlayer === "black") h ^= SIDE;
  return h;
}

export function zobristKey(board: Cell[][], currentPlayer: Color): string {
  return zobristHash(board, currentPlayer).toString(36);
}
