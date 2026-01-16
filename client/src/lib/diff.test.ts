import { describe, expect, it } from "vitest";
import { diffLines } from "@/lib/diff";

describe("diffLines", () => {
  it("marks same lines", () => {
    const out = diffLines("a\nb", "a\nb");
    expect(out).toEqual([
      { left: "a", right: "a", kind: "same" },
      { left: "b", right: "b", kind: "same" },
    ]);
  });

  it("marks changed lines", () => {
    const out = diffLines("a\nb", "a\nc");
    expect(out[1]?.kind).toBe("changed");
  });

  it("marks missing lines", () => {
    const out = diffLines("a", "a\nb");
    expect(out).toEqual([
      { left: "a", right: "a", kind: "same" },
      { left: "", right: "b", kind: "missing-left" },
    ]);
  });
});
