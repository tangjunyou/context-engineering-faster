import { describe, expect, it } from "vitest";
import { useStore } from "@/lib/store";

describe("context templates", () => {
  it("applies the minimal runnable template to an empty project", async () => {
    const { getContextTemplateById } = await import("@/lib/templates");

    useStore.setState({
      projectId: "p1",
      projectName: "Test Project",
      nodes: [],
      edges: [],
      variables: [],
      selectedNodeId: null,
    });

    const tpl = getContextTemplateById("minimal_runnable");
    expect(tpl).toBeDefined();

    useStore.getState().applyContextTemplate(tpl.id);

    const state = useStore.getState();
    expect(state.nodes.length).toBeGreaterThan(0);
    expect(state.nodes.some(n => n.data.type === "system_prompt")).toBe(true);
    expect(state.variables.some(v => v.name === "name")).toBe(true);
  });
});
