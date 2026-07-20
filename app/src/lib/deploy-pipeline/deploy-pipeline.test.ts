import { describe, it, expect } from "vitest";
import { parseLabelsYml } from "./labels";
import { diffVars, DEFAULT_VARS } from "./vars";

describe("parseLabelsYml", () => {
  it("parses well-formed labels.yml", () => {
    const text = `
- name: triage
  color: abc123
  description: Module 2 — incoming issue intake
- name: accepted
  color: "#0e8a16"
  description: "Maintainer-accepted"
`;
    const defs = parseLabelsYml(text);
    expect(defs).toHaveLength(2);
    expect(defs[0]).toEqual({
      name: "triage",
      color: "abc123",
      description: "Module 2 — incoming issue intake",
    });
    expect(defs[1].color).toBe("0e8a16");
    expect(defs[1].description).toBe("Maintainer-accepted");
  });

  it("strips leading # from color", () => {
    const defs = parseLabelsYml(`- name: x\n  color: "#FF00ff"`);
    expect(defs[0].color).toBe("FF00ff");
  });

  it("skips entries without color", () => {
    const defs = parseLabelsYml(`- name: noColor\n  description: missing color`);
    expect(defs).toEqual([]);
  });

  it("handles empty input", () => {
    expect(parseLabelsYml("")).toEqual([]);
    expect(parseLabelsYml("# just a comment")).toEqual([]);
  });
});

describe("DEFAULT_VARS", () => {
  it("contains engine core vars", () => {
    expect(DEFAULT_VARS.ANTHROPIC_BASE_URL).toBeTruthy();
    expect(DEFAULT_VARS.TRIAGE_MODEL).toBeTruthy();
    expect(DEFAULT_VARS.DEVELOP_MODEL).toBeTruthy();
  });

  it("contains turn/time budgets as numeric strings", () => {
    expect(DEFAULT_VARS.DEVELOP_MAX_TURNS).toMatch(/^\d+$/);
    expect(DEFAULT_VARS.DEVELOP_TIME_BUDGET_MIN).toMatch(/^\d+$/);
    expect(DEFAULT_VARS.CLARIFY_MAX_ROUNDS).toMatch(/^\d+$/);
  });

  it("exposes context paths as empty by default (user fills per-repo)", () => {
    expect(DEFAULT_VARS.DEVELOP_CONTEXT_PATHS).toBe("");
    expect(DEFAULT_VARS.TEST_CONTEXT_PATHS).toBe("");
  });
});

describe("diffVars", () => {
  it("marks new vars when missing on remote", () => {
    const result = diffVars({ A: "1", B: "2" }, new Map([["A", "1"]]));
    expect(result.find((v) => v.name === "A")?.status).toBe("exists-same");
    expect(result.find((v) => v.name === "B")?.status).toBe("new");
  });

  it("marks exists-different when value diverges", () => {
    const result = diffVars({ A: "1" }, new Map([["A", "9"]]));
    expect(result[0].status).toBe("exists-different");
    expect(result[0].remoteValue).toBe("9");
  });

  it("marks exists-same when value matches", () => {
    const result = diffVars({ A: "1" }, new Map([["A", "1"]]));
    expect(result[0].status).toBe("exists-same");
  });
});
