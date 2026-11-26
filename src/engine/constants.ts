import type { AIWeights, Direction, Shape } from "./types";

export const SIZE = 4;
export const SHAPES: Shape[] = ["square", "triangle", "circle"];
export const DIRS: Direction[] = ["up", "right", "down", "left"];

export const DEFAULT_WEIGHTS: AIWeights = {
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

export const WIN_SCORE = 1000000;
export const MAX_PATTERNS = 500;
