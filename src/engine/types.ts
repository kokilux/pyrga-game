export type Color = "white" | "black";
export type Shape = "square" | "triangle" | "circle";
export type Direction = "up" | "down" | "left" | "right";

export interface Cell {
  square: Color | null;
  triangle: { color: Color; dir: Direction } | null;
  circle: Color | null;
}

export interface LastMove {
  shape: Shape;
  row: number;
  col: number;
  dir?: Direction;
  by: Color;
}

export interface LegalMove {
  row: number;
  col: number;
  shape: Shape;
}

export interface FullLegalMove {
  row: number;
  col: number;
  shape: Shape;
  dir?: Direction;
}

export type Inventory = Record<Color, Record<Shape, number>>;

export interface AIWeights {
  tower: number;
  partial2: number;
  partial1: number;
  mobility: number;
  sqInv: number;
  trInv: number;
  ciInv: number;
  center: number;
  completion: number;
  patternAvoid: number;
  // Extended tactical/positional features
  threat: number;
  oppThreat: number;
  doubleThreat: number;
  lineControl: number;
  cornerControl: number;
  shapeDiversity: number;
}

export type BoardHash = string;

export interface LostPattern {
  boardHash: BoardHash;
  features: AIWeights;
  move: FullLegalMove;
  player: Color;
  gamePhase: number;
  timestamp: number;
}

export interface WinPattern {
  boardHash: BoardHash;
  features: AIWeights;
  move: FullLegalMove;
  player: Color;
  gamePhase: number;
  timestamp: number;
}

export interface SavedGame {
  id: string;
  name: string;
  winner: Color | "draw";
  moveCount: number;
  date: string;
  board: Cell[][];
  lastMove: LastMove | null;
}

export interface LearningHistory {
  totalGames: number;
  whiteWins: number;
  blackWins: number;
  draws: number;
  patternsLearned: number;
  lastUpdateTime: number;
}

export interface SearchStats {
  nodes: number;
  patternsAvoided: number;
  provenLossMoves?: FullLegalMove[];
}

export interface GameRecord {
  moves: { board: Cell[][]; move: FullLegalMove; player: Color; features: AIWeights }[];
  winner: Color | "draw";
  loser: Color | null;
}
