import { useStore } from "@/lib/store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Play, RefreshCw, Copy } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { encode } from "gpt-tokenizer";
import { toast } from "sonner";
import dagre from "dagre";
import init, { ContextEngine } from "@/lib/wasm/context_engine";
import { useTranslation } from "react-i18next";
import type { ContextFlowNode } from "@/lib/types";
import { shallow } from "zustand/shallow";

export default function PreviewPanel() {
  const { t } = useTranslation();
  const [wasmReady, setWasmReady] = useState(false);

  useEffect(() => {
    init().then(() => setWasmReady(true));
  }, []);
  const { nodes, edges, variables } = useStore(
    state => ({
      nodes: state.nodes,
      edges: state.edges,
      variables: state.variables,
    }),
    shallow
  );

  const [previewText, setPreviewText] = useState("");
  const [tokenCount, setTokenCount] = useState(0);
  const [cost, setCost] = useState(0);

  // Topological sort to determine the order of context blocks
  const sortedNodes = useMemo(() => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({});
    g.setDefaultEdgeLabel(() => ({}));

    nodes.forEach(node => g.setNode(node.id, { label: node.data.label }));
    edges.forEach(edge => g.setEdge(edge.source, edge.target));

    try {
      const sortedIds = dagre.graphlib.alg.topsort(g) as string[];
      // Filter out nodes that might not be in the graph anymore or are not context nodes
      return sortedIds
        .map((id: string) => nodes.find((n: ContextFlowNode) => n.id === id))
        .filter((n): n is ContextFlowNode => Boolean(n));
    } catch (e) {
      // Fallback if cycle detected or other error
      console.warn("Cycle detected or graph error", e);
      return nodes;
    }
  }, [nodes, edges]);

  useEffect(() => {
    generatePreview();
  }, [sortedNodes, variables, nodes]); // Re-run when structure or data changes

  const generatePreview = () => {
    if (!wasmReady) return;

    try {
      const engine = new ContextEngine();

      // Prepare variables for Rust
      const rustVars = variables.map(v => ({
        id: v.id,
        name: v.name,
        value: v.value || `[${v.name}]`,
      }));
      engine.set_variables(rustVars);

      // Prepare nodes for Rust
      const rustNodes = sortedNodes.map(node => ({
        id: node.id,
        label: node.data.label,
        content: node.data.content || "",
      }));

      const fullText = engine.process_context(rustNodes);
      setPreviewText(fullText);

      // Calculate tokens
      const tokens = encode(fullText);
      setTokenCount(tokens.length);

      // Estimate cost (GPT-4o input pricing: $5.00 / 1M tokens)
      setCost((tokens.length / 1000000) * 5.0);
    } catch (e) {
      console.error("WASM Error:", e);
      toast.error(t("preview.wasmFailed"));
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(previewText);
    toast.success(t("preview.copied"));
  };

  return (
    <div className="h-full flex flex-col bg-card border-l border-border">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="font-mono font-bold text-sm uppercase tracking-wider">
          {t("preview.title")}
        </h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={generatePreview}>
            <RefreshCw className="w-3 h-3 mr-1" /> {t("preview.refresh")}
          </Button>
          <Button size="sm" onClick={() => toast.info(t("preview.running"))}>
            <Play className="w-3 h-3 mr-1" /> {t("preview.run")}
          </Button>
        </div>
      </div>

      <div className="p-4 border-b border-border bg-muted/30">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
              {t("preview.tokens")}
            </div>
            <div className="text-2xl font-mono font-bold text-primary">
              {tokenCount}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
              {t("preview.estCost")}
            </div>
            <div className="text-2xl font-mono font-bold text-green-500">
              ${cost.toFixed(5)}
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="preview" className="flex-1 flex flex-col">
        <div className="px-4 pt-2">
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="preview">
              {t("preview.contextPreview")}
            </TabsTrigger>
            <TabsTrigger value="json">{t("preview.jsonStructure")}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="preview"
          className="flex-1 p-0 m-0 relative overflow-hidden"
        >
          <ScrollArea className="h-full p-4">
            <pre className="font-mono text-xs whitespace-pre-wrap text-foreground/80 leading-relaxed">
              {previewText}
            </pre>
          </ScrollArea>
          <Button
            size="icon"
            variant="secondary"
            className="absolute top-2 right-2 h-8 w-8 opacity-50 hover:opacity-100"
            onClick={handleCopy}
          >
            <Copy className="w-4 h-4" />
          </Button>
        </TabsContent>

        <TabsContent value="json" className="flex-1 p-0 m-0 overflow-hidden">
          <ScrollArea className="h-full p-4">
            <pre className="font-mono text-[10px] text-muted-foreground">
              {JSON.stringify({ nodes, edges, variables }, null, 2)}
            </pre>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
