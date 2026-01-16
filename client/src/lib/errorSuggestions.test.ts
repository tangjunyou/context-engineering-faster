import { describe, expect, it } from "vitest";

describe("error suggestions", () => {
  it("maps readonly_required to a suggestion", async () => {
    const { getSuggestionForErrorCode } = await import(
      "@/lib/errorSuggestions"
    );
    const t = (k: string) => k;
    expect(getSuggestionForErrorCode("readonly_required", t)).toBe(
      "preview.suggestReadonlyRequired"
    );
  });
});
