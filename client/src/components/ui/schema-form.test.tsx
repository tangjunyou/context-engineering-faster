import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { SchemaForm } from "./schema-form";
import { RJSFSchema } from "@rjsf/utils";

describe("SchemaForm", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders form fields based on schema", () => {
    const schema: RJSFSchema = {
      type: "object",
      properties: {
        testString: { type: "string", title: "Test String Label" },
      },
    };

    render(<SchemaForm schema={schema} />);

    // This should fail initially as we only have a placeholder
    expect(screen.getByLabelText("Test String Label")).toBeInTheDocument();
  });

  it("calls onSubmit with form data", () => {
    const schema: RJSFSchema = {
      type: "object",
      properties: {
        name: { type: "string", title: "Name" },
      },
    };
    const handleSubmit = vi.fn();

    render(<SchemaForm schema={schema} onSubmit={handleSubmit} />);

    // Mock filling form
    const input = screen.getByLabelText("Name");
    fireEvent.change(input, { target: { value: "Alice" } });

    // Click submit
    const submitBtn = screen.getByRole("button", { name: /submit/i });
    fireEvent.click(submitBtn);

    expect(handleSubmit).toHaveBeenCalled();
    expect(handleSubmit.mock.calls[0][0].formData).toEqual({ name: "Alice" });
  });
});
