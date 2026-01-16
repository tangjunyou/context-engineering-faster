import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty" },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/i18n", () => ({
  default: {
    t: (key: string) => key,
  },
}));

describe("QuickStartOverlay", () => {
  it("calls onSelectTemplate when the user picks the minimal template", async () => {
    const onSelectTemplate = vi.fn();
    const { default: QuickStartOverlay } = await import(
      "@/components/QuickStartOverlay"
    );

    render(
      <QuickStartOverlay
        open
        onOpenChange={() => {}}
        onSelectTemplate={onSelectTemplate}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "quickStart.useMinimalTemplate" })
    );
    expect(onSelectTemplate).toHaveBeenCalledWith("minimal_runnable");
  });
});
