import { useStore } from "@/lib/store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Play, RefreshCw, Copy, AlertTriangle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { encode } from "gpt-tokenizer";
import { toast } from "sonner";
import dagre from "dagre";
import init, { ContextEngine } from "@/lib/wasm/context_engine";
import { useTranslation } from "react-i18next";
import type { ContextFlowNode, NodeType } from "@/lib/types";
import { shallow } from "zustand/shallow";
import { executePreviewTrace } from "@/lib/api/context-engine";
import type { TraceRun } from "@shared/trace";

export default function PreviewPanel() {
  const { t } = useTranslation();
  const [wasmReady, setWasmReady] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [cycleDetected, setCycleDetected] = useState(false);
  const wasmInitPromiseRef = useRef<Promise<unknown> | null>(null);
  const engineRef = useRef<ContextEngine | null>(null);
  const previewDebounceIdRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (previewDebounceIdRef.current) {
        window.clearTimeout(previewDebounceIdRef.current);
        previewDebounceIdRef.current = null;
      }
      if (engineRef.current) {
        engineRef.current.free();
        engineRef.current = null;
      }
    };
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
  const [trace, setTrace] = useState<TraceRun | null>(null);
  const [traceView, setTraceView] = useState<TraceRun | null>(null);
  const [traceHistory, setTraceHistory] = useState<TraceRun[]>([]);

  const { sortedNodes, hasCycle } = useMemo(() => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({});
    g.setDefaultEdgeLabel(() => ({}));

    nodes.forEach(node => g.setNode(node.id, { label: node.data.label }));
    edges.forEach(edge => g.setEdge(edge.source, edge.target));

    try {
      const sortedIds = dagre.graphlib.alg.topsort(g) as string[];
      const sortedNodes = sortedIds
        .map((id: string) => nodes.find((n: ContextFlowNode) => n.id === id))
        .filter((n): n is ContextFlowNode => Boolean(n));
      return { sortedNodes, hasCycle: false };
    } catch (e) {
      return { sortedNodes: nodes, hasCycle: true };
    }
  }, [nodes, edges]);

  useEffect(() => {
    setCycleDetected(hasCycle);
    if (hasCycle) toast.error(t("preview.cycleDetected"));
  }, [hasCycle, t]);

  const ensureWasmReady = async () => {
    if (wasmReady) return true;
    try {
      if (!wasmInitPromiseRef.current) {
        wasmInitPromiseRef.current = init();
      }
      await wasmInitPromiseRef.current;
      setWasmReady(true);
      return true;
    } catch (e) {
      wasmInitPromiseRef.current = null;
      toast.error(t("preview.wasmInitFailed"));
      return false;
    }
  };

  const getEngine = () => {
    if (!engineRef.current) {
      engineRef.current = new ContextEngine();
    }
    return engineRef.current;
  };

  const nodeTypeToKind = (type: NodeType): string => {
    switch (type) {
      case "system_prompt":
        return "system";
      case "user_input":
        return "user";
      case "messages":
        return "assistant";
      case "tools":
        return "tool";
      case "memory":
        return "memory";
      case "retrieval":
        return "retrieval";
      case "metadata":
        return "text";
      default:
        return "text";
    }
  };

  const generatePreviewViaApi = async (): Promise<TraceRun> => {
    const rustVars = variables.map(v => ({
      id: v.id,
      name: v.name,
      type: v.type,
      value: v.value || `[${v.name}]`,
      resolver: typeof v.resolver === "string" ? v.resolver : undefined,
    }));

    const rustNodes = sortedNodes.map(node => ({
      id: node.id,
      label: node.data.label,
      kind: nodeTypeToKind(node.data.type),
      content: node.data.content || "",
    }));

    return executePreviewTrace({
      nodes: rustNodes,
      variables: rustVars,
      outputStyle: "labeled",
    });
  };

  const generatePreview = async () => {
    try {
      const trace = await generatePreviewViaApi();
      setTrace(trace);
      setTraceView(trace);
      setTraceHistory(prev => [trace, ...prev].slice(0, 10));
      setPreviewText(trace.text);

      const tokens = encode(trace.text);
      setTokenCount(tokens.length);
      setCost((tokens.length / 1000000) * 5.0);
      return;
    } catch (e) {
      setTrace(null);
      setTraceView(null);
    }

    try {
      const ok = await ensureWasmReady();
      if (!ok) return;
      const engine = getEngine();

      const rustVars = variables.map(v => ({
        id: v.id,
        name: v.name,
        value: v.value || `[${v.name}]`,
      }));
      engine.set_variables(rustVars);

      const rustNodes = sortedNodes.map(node => ({
        id: node.id,
        label: node.data.label,
        content: node.data.content || "",
      }));

      const fullText = engine.process_context(rustNodes);
      setPreviewText(fullText);
      setTrace(null);

      const tokens = encode(fullText);
      setTokenCount(tokens.length);

      setCost((tokens.length / 1000000) * 5.0);
    } catch (e) {
      console.error("WASM Error:", e);
      toast.error(t("preview.wasmFailed"));
    }
  };

  useEffect(() => {
    if (previewDebounceIdRef.current) {
      window.clearTimeout(previewDebounceIdRef.current);
    }
    previewDebounceIdRef.current = window.setTimeout(() => {
      void generatePreview();
    }, 250);

    return () => {
      if (previewDebounceIdRef.current) {
        window.clearTimeout(previewDebounceIdRef.current);
        previewDebounceIdRef.current = null;
      }
    };
  }, [sortedNodes, variables]);

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
          <Button
            size="sm"
            variant="outline"
            onClick={() => void generatePreview()}
          >
            <RefreshCw className="w-3 h-3 mr-1" /> {t("preview.refresh")}
          </Button>
          <Button
            size="sm"
            onClick={async () => {
              if (isRunning) return;
              setIsRunning(true);
              toast.info(t("preview.running"));
              try {
                await generatePreview();
                toast.success(t("preview.completed"));
              } finally {
                setIsRunning(false);
              }
            }}
          >
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
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="preview">
              {t("preview.contextPreview")}
            </TabsTrigger>
            <TabsTrigger value="trace">{t("preview.trace")}</TabsTrigger>
            <TabsTrigger value="json">{t("preview.jsonStructure")}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="preview"
          className="flex-1 p-0 m-0 relative overflow-hidden"
        >
          <ScrollArea className="h-full p-4">
            {cycleDetected && (
              <Alert variant="destructive" className="mb-4">
                <AlertTriangle />
                <AlertTitle>{t("preview.cycleTitle")}</AlertTitle>
                <AlertDescription>
                  {t("preview.cycleDetected")}
                </AlertDescription>
              </Alert>
            )}
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

        <TabsContent value="trace" className="flex-1 p-0 m-0 overflow-hidden">
          <ScrollArea className="h-full p-4">
            {!(traceView ?? trace) ? (
              <div className="text-xs text-muted-foreground">
                {t("preview.traceEmpty")}
              </div>
            ) : (
              <div className="space-y-3">
                {traceHistory.length > 0 && (
                  <div className="rounded-md border border-border bg-background/50 p-3">
                    <div className="font-mono text-xs font-bold text-primary">
                      {t("preview.runHistory")}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {traceHistory.map((run, idx) => (
                        <Button
                          key={`${run.runId}-${idx}`}
                          size="sm"
                          variant={
                            (traceView ?? trace)?.runId === run.runId
                              ? "secondary"
                              : "outline"
                          }
                          onClick={() => setTraceView(run)}
                        >
                          {new Date(Number(run.createdAt) || Date.now()).toLocaleString()}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {(traceView ?? trace)!.messages.length > 0 && (
                  <div className="rounded-md border border-border bg-background/50 p-3">
                    <div className="font-mono text-xs font-bold text-primary">
                      {t("preview.traceMessages")}
                    </div>
                    <div className="mt-2 space-y-1">
                      {(traceView ?? trace)!.messages.map((m, idx) => (
                        <div
                          key={`${m.code}-${idx}`}
                          className="text-[10px] text-muted-foreground"
                        >
                          [{m.severity}] {m.code}: {m.message}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(traceView ?? trace)!.segments.map(seg => (
                  <div
                    key={seg.nodeId}
                    className="rounded-md border border-border bg-background/50 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-mono text-xs font-bold text-primary">
                        {seg.label}
                      </div>
                      {seg.missingVariables.length > 0 && (
                        <div className="text-[10px] text-destructive">
                          {t("preview.missingVariables", {
                            names: seg.missingVariables.join(", "),
                          })}
                        </div>
                      )}
                    </div>
                    <pre className="mt-2 font-mono text-[10px] whitespace-pre-wrap text-foreground/80 leading-relaxed">
                      {seg.rendered}
                    </pre>
                    {seg.messages.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {seg.messages.map((m, idx) => (
                          <div
                            key={`${seg.nodeId}-${m.code}-${idx}`}
                            className="text-[10px] text-muted-foreground"
                          >
                            [{m.severity}] {m.code}: {m.message}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="json" className="flex-1 p-0 m-0 overflow-hidden">
          <ScrollArea className="h-full p-4">
            <pre className="font-mono text-[10px] text-muted-foreground">
              {JSON.stringify({ nodes, edges, variables, trace }, null, 2)}
            </pre>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
