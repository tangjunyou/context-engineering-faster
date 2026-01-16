import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { BrainCircuit, Database, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import VariableLibraryPanel from "@/components/VariableLibraryPanel";
import VariableBuilderPanel from "@/components/VariableBuilderPanel";
import { ProjectManagerDialog } from "@/components/ProjectManagerDialog";
import { useStore } from "@/lib/store";
import type { Variable } from "@/lib/types";

export default function VariablesWorkbench() {
  const [activePanel, setActivePanel] = useState<"library" | "builder">(
    "library"
  );
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const { projectId, projectName, addVariable, updateVariable, variables } =
    useStore(s => ({
      projectId: s.projectId,
      projectName: s.projectName,
      addVariable: s.addVariable,
      updateVariable: s.updateVariable,
      variables: s.variables,
    }));

  const initialSelectedId = useMemo(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get("varId");
  }, []);
  const initialFilter = useMemo(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get("varName");
  }, []);

  const headerTitle = useMemo(() => {
    if (activePanel === "builder") return "变量工作台 · 抽取器";
    return "变量工作台 · 变量库";
  }, [activePanel]);

  return (
    <div className="h-screen w-screen bg-background text-foreground overflow-hidden flex flex-col">
      <header className="h-14 border-b border-border bg-card flex items-center px-4 justify-between z-10">
        <div className="flex items-center gap-2">
          <div className="bg-primary/20 p-1.5 rounded text-primary">
            <BrainCircuit size={20} />
          </div>
          <h1 className="font-bold text-lg tracking-tight">{headerTitle}</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-3 text-xs text-muted-foreground mr-2">
            <span>
              项目：{projectName}
              {projectId ? ` (${projectId})` : "（未保存）"}
            </span>
          </div>
          <Button
            variant="outline"
            className="h-8 px-3 text-sm"
            onClick={() => setProjectDialogOpen(true)}
          >
            工程
          </Button>
          <Button
            variant={activePanel === "library" ? "default" : "outline"}
            className="h-8 px-3 text-sm"
            onClick={() => setActivePanel("library")}
          >
            变量库
          </Button>
          <Button
            variant={activePanel === "builder" ? "default" : "outline"}
            className="h-8 px-3 text-sm"
            onClick={() => setActivePanel("builder")}
          >
            <Settings className="mr-2 h-4 w-4" />
            抽取器
          </Button>
          <Button asChild variant="outline" className="h-8 px-3 text-sm">
            <Link to="/workbench/data">数据工作台</Link>
          </Button>
          <Button asChild variant="outline" className="h-8 px-3 text-sm">
            <Link to="/workbench/context">
              <Database className="mr-2 h-4 w-4" />
              上下文装配
            </Link>
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <ProjectManagerDialog
          open={projectDialogOpen}
          onOpenChange={setProjectDialogOpen}
        />
        {activePanel === "library" ? (
          <div className="h-full p-4">
            <VariableLibraryPanel
              initialSelectedId={initialSelectedId}
              initialFilter={initialFilter}
              onImportToProjectVariables={item => {
                const current =
                  item.versions.find(
                    v => v.versionId === item.currentVersionId
                  ) ?? item.versions[item.versions.length - 1];
                if (!current) return;
                const v: Variable = {
                  id: item.id,
                  name: current.data.name,
                  type:
                    current.data.type === "static" ||
                    current.data.type === "dynamic"
                      ? current.data.type
                      : "dynamic",
                  value: current.data.value,
                  description: current.data.description,
                  source: current.data.source ?? "variable_library",
                  resolver: current.data.resolver,
                };
                if (variables.some(x => x.id === v.id)) {
                  updateVariable(v);
                } else {
                  addVariable(v);
                }
                setActivePanel("builder");
              }}
            />
          </div>
        ) : (
          <div className="h-full p-4">
            <VariableBuilderPanel />
          </div>
        )}
      </main>
    </div>
  );
}
