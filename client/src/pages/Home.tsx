import { Suspense, lazy, useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useStore } from "@/lib/store";
import type { ContextFlowNode, NodeType } from "@/lib/types";
import ContextNode from "@/components/ContextNode";
const VariableManager = lazy(() => import("@/components/VariableManager"));
const DataSourceManager = lazy(() => import("@/components/DataSourceManager"));
const PropertyInspector = lazy(() => import("@/components/PropertyInspector"));
const PreviewPanel = lazy(() => import("@/components/PreviewPanel"));
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { BrainCircuit, Layers, Box, Database, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { shallow } from "zustand/shallow";
import { ProjectManagerDialog } from "@/components/ProjectManagerDialog";
import { SessionManagerDialog } from "@/components/SessionManagerDialog";
import QuickStartOverlay from "@/components/QuickStartOverlay";
import { OnboardingTour } from "@/components/OnboardingTour";

const nodeTypes = {
  contextNode: ContextNode,
};

export default function Home() {
  const { t, i18n } = useTranslation();
  const {
    projectName,
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    selectNode,
    addNode,
    applyContextTemplate,
  } = useStore(
    state => ({
      projectName: state.projectName,
      nodes: state.nodes,
      edges: state.edges,
      onNodesChange: state.onNodesChange,
      onEdgesChange: state.onEdgesChange,
      onConnect: state.onConnect,
      selectNode: state.selectNode,
      addNode: state.addNode,
      applyContextTemplate: state.applyContextTemplate,
    }),
    shallow
  );

  const [activeLeftPanel, setActiveLeftPanel] = useState<
    "variables" | "components" | "datasources"
  >("variables");
  const [activeRightPanel, setActiveRightPanel] = useState<
    "properties" | "preview"
  >("preview");
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [quickStartOpen, setQuickStartOpen] = useState(false);
  const [didAutoOpenQuickStart, setDidAutoOpenQuickStart] = useState(false);

  useEffect(() => {
    if (!didAutoOpenQuickStart && nodes.length === 0) {
      setDidAutoOpenQuickStart(true);
      setQuickStartOpen(true);
    }
  }, [didAutoOpenQuickStart, nodes.length]);

  const handleNodeClick = (_: React.MouseEvent, node: ContextFlowNode) => {
    selectNode(node.id);
    setActiveRightPanel("properties");
  };

  const handlePaneClick = () => {
    selectNode(null);
  };

  const handleAddNode = (type: NodeType, label: string) => {
    const newNode: ContextFlowNode = {
      id: `node_${Date.now()}`,
      type: "contextNode",
      position: { x: Math.random() * 400, y: Math.random() * 400 },
      data: {
        label,
        type,
        content: "",
        variables: [],
      },
    };
    addNode(newNode);
  };

return (
    <div className="h-screen w-screen bg-background text-foreground overflow-hidden flex flex-col">
      <OnboardingTour />
      {/* Header */}<OnboardingTour />
      {/* Header */}<OnboardingTour />
      {/* Header */}
      <header className="h-14 border-b border-border bg-card flex items-center px-4 justify-between z-10">
        <div className="flex items-center gap-2">
          <div className="bg-primary/20 p-1.5 rounded text-primary">
            <BrainCircuit size={20} />
          </div>
          <h1 className="font-bold text-lg tracking-tight">{t("app.name")}</h1>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{t("app.version")}</span>
          <div className="h-4 w-[1px] bg-border"></div>
          <span>{t("app.projectLabel", { name: projectName })}</span>
          <div className="h-4 w-[1px] bg-border"></div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => setQuickStartOpen(true)}
            >
              {t("quickStart.open")}
            </Button>
            <Button
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => setProjectDialogOpen(true)}
            >
              {t("projects.manage")}
            </Button>
            <Button
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => setSessionDialogOpen(true)}
            >
              {t("sessions.manage")}
            </Button>
          </div>
          <div className="h-4 w-[1px] bg-border"></div>
          <div className="flex items-center gap-2">
            <span>{t("nav.language")}:</span>
            <Button
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => i18n.changeLanguage("en")}
              disabled={i18n.resolvedLanguage === "en"}
            >
              {t("nav.languageEN")}
            </Button>
            <Button
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => i18n.changeLanguage("zh")}
              disabled={i18n.resolvedLanguage === "zh"}
            >
              {t("nav.languageZH")}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 overflow-hidden">
        <ProjectManagerDialog
          open={projectDialogOpen}
          onOpenChange={setProjectDialogOpen}
        />
        <SessionManagerDialog
          open={sessionDialogOpen}
          onOpenChange={setSessionDialogOpen}
        />
        <QuickStartOverlay
          open={quickStartOpen}
          onOpenChange={setQuickStartOpen}
          onSelectTemplate={templateId => {
            applyContextTemplate(templateId);
            setQuickStartOpen(false);
          }}
        />
        <ResizablePanelGroup direction="horizontal">
          {/* Left Sidebar */}
          <ResizablePanel
            id="workbench-left-panel"
            defaultSize={20}
            minSize={15}
            maxSize={30}
            className="bg-card border-r border-border flex flex-col"
          >
            <div className="flex border-b border-border">
              <Button
                variant="ghost"
                className={`flex-1 rounded-none h-10 text-xs uppercase tracking-wider ${activeLeftPanel === "variables" ? "bg-muted text-primary border-b-2 border-primary" : "text-muted-foreground"}`}
                onClick={() => setActiveLeftPanel("variables")}
              >
                <Box className="w-3 h-3 mr-2" /> {t("nav.variables")}
              </Button>
              <Button
                variant="ghost"
                className={`flex-1 rounded-none h-10 text-xs uppercase tracking-wider ${activeLeftPanel === "components" ? "bg-muted text-primary border-b-2 border-primary" : "text-muted-foreground"}`}
                onClick={() => setActiveLeftPanel("components")}
              >
                <Layers className="w-3 h-3 mr-2" /> {t("nav.components")}
              </Button>
              <Button
                variant="ghost"
                className={`flex-1 rounded-none h-10 text-xs uppercase tracking-wider ${activeLeftPanel === "datasources" ? "bg-muted text-primary border-b-2 border-primary" : "text-muted-foreground"}`}
                onClick={() => setActiveLeftPanel("datasources")}
              >
                <Database className="w-3 h-3 mr-2" /> {t("nav.datasources")}
              </Button>
            </div>

            <div className="flex-1 overflow-hidden">
              {activeLeftPanel === "variables" ? (
                <Suspense
                  fallback={
                    <div className="p-4 text-sm text-muted-foreground">
                      Loading…
                    </div>
                  }
                >
                  <VariableManager />
                </Suspense>
              ) : activeLeftPanel === "datasources" ? (
                <Suspense
                  fallback={
                    <div className="p-4 text-sm text-muted-foreground">
                      Loading…
                    </div>
                  }
                >
                  <DataSourceManager />
                </Suspense>
              ) : (
                <div className="p-4 grid gap-2">
                  <div className="text-xs font-bold text-muted-foreground mb-2 uppercase">
                    {t("componentsPanel.hint")}
                  </div>
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() =>
                      handleAddNode(
                        "system_prompt",
                        t("componentsPanel.systemPrompt")
                      )
                    }
                  >
                    <div className="w-2 h-2 rounded-full bg-chart-1 mr-2" />{" "}
                    {t("componentsPanel.systemPrompt")}
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() =>
                      handleAddNode(
                        "tools",
                        t("componentsPanel.toolDefinitions")
                      )
                    }
                  >
                    <div className="w-2 h-2 rounded-full bg-chart-2 mr-2" />{" "}
                    {t("componentsPanel.toolDefinitions")}
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() =>
                      handleAddNode("memory", t("componentsPanel.memoryBlock"))
                    }
                  >
                    <div className="w-2 h-2 rounded-full bg-chart-3 mr-2" />{" "}
                    {t("componentsPanel.memoryBlock")}
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() =>
                      handleAddNode(
                        "retrieval",
                        t("componentsPanel.retrievedContext")
                      )
                    }
                  >
                    <div className="w-2 h-2 rounded-full bg-chart-4 mr-2" />{" "}
                    {t("componentsPanel.retrievedContext")}
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() =>
                      handleAddNode(
                        "messages",
                        t("componentsPanel.messageHistory")
                      )
                    }
                  >
                    <div className="w-2 h-2 rounded-full bg-chart-5 mr-2" />{" "}
                    {t("componentsPanel.messageHistory")}
                  </Button>
                </div>
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle />

          {/* Center Canvas */}
          <ResizablePanel defaultSize={55} id="workbench-canvas">
            <div className="h-full w-full bg-background relative">
              {nodes.length === 0 ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center">
                  <div className="max-w-md w-[92%] bg-card border border-border rounded-lg p-6 shadow-xl">
                    <div className="text-sm font-semibold">
                      {t("canvas.emptyTitle")}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {t("canvas.emptyDescription")}
                    </div>
                    <div className="mt-4 flex gap-2">
                      <Button onClick={() => setQuickStartOpen(true)}>
                        {t("canvas.chooseTemplate")}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() =>
                          handleAddNode(
                            "system_prompt",
                            t("componentsPanel.systemPrompt")
                          )
                        }
                      >
                        {t("canvas.addSystemNode")}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={handleNodeClick}
                onPaneClick={handlePaneClick}
                nodeTypes={nodeTypes}
                fitView
                className="bg-background"
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={20}
                  size={1}
                  color="var(--border)"
                />
                <Controls className="bg-card border border-border text-foreground fill-foreground" />
                <MiniMap
                  className="bg-card border border-border"
                  maskColor="var(--background)"
                  nodeColor={(n: ContextFlowNode) => {
                    if (n.data.type === "system_prompt")
                      return "var(--chart-1)";
                    if (n.data.type === "tools") return "var(--chart-2)";
                    return "var(--muted-foreground)";
                  }}
                />
              </ReactFlow>

              {/* Floating Toolbar (Optional) */}
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-card/80 backdrop-blur border border-border rounded-full px-4 py-2 shadow-xl flex gap-4 text-xs font-mono z-10">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span>{t("toolbar.ready")}</span>
                </div>
                <div className="w-[1px] h-4 bg-border" />
                <div>{t("toolbar.nodes", { count: nodes.length })}</div>
                <div>{t("toolbar.connections", { count: edges.length })}</div>
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle />

          {/* Right Sidebar */}
          <ResizablePanel
            id="workbench-right-panel"
            defaultSize={25}
            minSize={20}
            maxSize={40}
            className="bg-card border-l border-border flex flex-col"
          >
            <div className="flex border-b border-border">
              <Button
                variant="ghost"
                className={`flex-1 rounded-none h-10 text-xs uppercase tracking-wider ${activeRightPanel === "preview" ? "bg-muted text-primary border-b-2 border-primary" : "text-muted-foreground"}`}
                onClick={() => setActiveRightPanel("preview")}
              >
                <BrainCircuit className="w-3 h-3 mr-2" /> {t("nav.simulation")}
              </Button>
              <Button
                variant="ghost"
                className={`flex-1 rounded-none h-10 text-xs uppercase tracking-wider ${activeRightPanel === "properties" ? "bg-muted text-primary border-b-2 border-primary" : "text-muted-foreground"}`}
                onClick={() => setActiveRightPanel("properties")}
              >
                <Settings className="w-3 h-3 mr-2" /> {t("nav.properties")}
              </Button>
            </div>

            <div className="flex-1 overflow-hidden">
              <Suspense
                fallback={
                  <div className="p-4 text-sm text-muted-foreground">
                    Loading…
                  </div>
                }
              >
                {activeRightPanel === "preview" ? (
                  <PreviewPanel />
                ) : (
                  <PropertyInspector />
                )}
              </Suspense>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
