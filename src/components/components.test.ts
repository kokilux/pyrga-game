import { describe, expect, it } from "vitest";
import { CellView } from "./CellView";
import { PlayerPanel } from "./PlayerPanel";
import { RulesPanel } from "./RulesPanel";
import { StatusBar } from "./StatusBar";
import { WeightBar } from "./WeightBar";

describe("component smoke exports", () => {
  it("exports render functions", () => {
    expect(typeof CellView).toBe("function");
    expect(typeof PlayerPanel).toBe("function");
    expect(typeof RulesPanel).toBe("function");
    expect(typeof StatusBar).toBe("function");
    expect(typeof WeightBar).toBe("function");
  });
});
