import type { AIWeights, Direction, Shape } from "./types";

export const SIZE = 4;
export const SHAPES: Shape[] = ["square", "triangle", "circle"];
export const DIRS: Direction[] = ["up", "right", "down", "left"];

export const DEFAULT_WEIGHTS: AIWeights = {
  tower: 1400.0,
  partial2: 220.0,
  partial1: 45.0,
  mobility: 30.0,
  sqInv: 12.0,
  trInv: 18.0,
  ciInv: 14.0,
  center: 12.0,
  completion: 420.0,
  patternAvoid: 260.0,
  threat: 320.0,
  oppThreat: 360.0,
  doubleThreat: 260.0,
  lineControl: 35.0,
  cornerControl: 18.0,
  shapeDiversity: 20.0,
};

export const WIN_SCORE = 1000000;
export const MAX_PATTERNS = 500;
