import { DIRS, SHAPES, SIZE } from "./constants";
import type {
  AIWeights,
  BoardHash,
  Cell,
  Color,
  Direction,
  FullLegalMove,
  Inventory,
  LastMove,
  LegalMove,
  Shape,
} from "./types";

export function emptyBoard(): Cell[][] {
  return Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () => ({
      square: null,
      triangle: null,
      circle: null,
    })),
  );
}

export function startingInventory(): Inventory {
  return {
    white: { square: 5, triangle: 5, circle: 5 },
    black: { square: 5, triangle: 5, circle: 5 },
  };
}

export function cloneBoard(board: Cell[][]): Cell[][] {
  return board.map((row) =>
    row.map((cell) => ({
      square: cell.square,
      triangle: cell.triangle ? { ...cell.triangle } : null,
      circle: cell.circle,
    })),
  );
}

export function cloneInventory(inv: Inventory): Inventory {
  return {
    white: { ...inv.white },
    black: { ...inv.black },
  };
}

export function dirVector(dir: Direction): [number, number] {
  switch (dir) {
    case "up":
      return [-1, 0];
    case "down":
      return [1, 0];
    case "left":
      return [0, -1];
    case "right":
      return [0, 1];
  }
}

export function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

export function isDirValidForCell(row: number, col: number, dir: Direction): boolean {
  const [dr, dc] = dirVector(dir);
  return inBounds(row + dr, col + dc);
}

export function rule2Cells(lastMove: LastMove | null): { row: number; col: number }[] {
  if (!lastMove) return [];
  if (lastMove.shape === "square") {
    return [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
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

export function canPlace(cell: Cell, shape: Shape): boolean {
  return cell[shape] === null;
}

export function isCellEmpty(cell: Cell): boolean {
  return cell.square === null && cell.triangle === null && cell.circle === null;
}

export function getLegalMoves(
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

export function generateAllLegalMoves(
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

export function towerComplete(cell: Cell): boolean {
  return cell.square !== null && cell.triangle !== null && cell.circle !== null;
}

export function pieceCounts(cell: Cell): Record<Color, number> {
  const counts: Record<Color, number> = { white: 0, black: 0 };
  if (cell.square) counts[cell.square]++;
  if (cell.triangle) counts[cell.triangle.color]++;
  if (cell.circle) counts[cell.circle]++;
  return counts;
}

export function towerOwner(cell: Cell): Color | null {
  if (!towerComplete(cell)) return null;
  const c = pieceCounts(cell);
  if (c.white > c.black) return "white";
  if (c.black > c.white) return "black";
  return null;
}

export function partialOwner(cell: Cell, requiredCount: number): Color | null {
  if (towerComplete(cell)) return null;
  const c = pieceCounts(cell);
  if (c.white >= requiredCount && c.white > c.black) return "white";
  if (c.black >= requiredCount && c.black > c.white) return "black";
  return null;
}

export function countTowers(board: Cell[][]): { white: number; black: number } {
  let white = 0;
  let black = 0;
  for (const row of board) {
    for (const cell of row) {
      const o = towerOwner(cell);
      if (o === "white") white++;
      else if (o === "black") black++;
    }
  }
  return { white, black };
}

export function checkGameOverState(
  board: Cell[][],
  legalCount: number,
  towers: { white: number; black: number },
): { isOver: boolean; winner: Color | "draw" | null } {
  if (towers.white >= 3) return { isOver: true, winner: "white" };
  if (towers.black >= 3) return { isOver: true, winner: "black" };

  if (legalCount === 0) {
    if (towers.white > towers.black) return { isOver: true, winner: "white" };
    if (towers.black > towers.white) return { isOver: true, winner: "black" };

    for (const need of [2, 1]) {
      let w = 0;
      let b = 0;
      for (const r of board) {
        for (const c of r) {
          const po = partialOwner(c, need);
          if (po === "white") w++;
          else if (po === "black") b++;
        }
      }
      if (w > b) return { isOver: true, winner: "white" };
      if (b > w) return { isOver: true, winner: "black" };
    }
    return { isOver: true, winner: "draw" };
  }
  return { isOver: false, winner: null };
}

export function hashBoard(board: Cell[][], currentPlayer: Color): BoardHash {
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

export function hashMove(m: FullLegalMove): string {
  return `${m.row}${m.col}${m.shape}${m.dir || ""}`;
}

export function getFeatureVector(
  board: Cell[][],
  whiteMovesCount: number,
  blackMovesCount: number,
  inv: Inventory,
): AIWeights {
  let tWhite = 0;
  let tBlack = 0;
  let p2White = 0;
  let p2Black = 0;
  let p1White = 0;
  let p1Black = 0;
  let cWhite = 0;
  let cBlack = 0;
  let compWhite = 0;
  let compBlack = 0;

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

export function featureSimilarity(f1: AIWeights, f2: AIWeights): number {
  let dot = 0;
  let norm1 = 0;
  let norm2 = 0;
  const keys: (keyof AIWeights)[] = [
    "tower",
    "partial2",
    "partial1",
    "mobility",
    "sqInv",
    "trInv",
    "ciInv",
    "center",
    "completion",
  ];

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

export function getBannedShape(
  player: Color,
  moveHistoryLen: number,
  whiteFirstShape: Shape | null,
): Shape | null {
  return player === "white" && moveHistoryLen === 2 ? whiteFirstShape : null;
}
