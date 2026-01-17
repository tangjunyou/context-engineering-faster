import { useMemo, useState } from "react";
import { Settings } from "lucide-react";

import WorkbenchLayout from "@/components/WorkbenchLayout";
import { Button } from "@/components/ui/button";
import VariableLibraryPanel from "@/components/VariableLibraryPanel";
import VariableBuilderPanel from "@/components/VariableBuilderPanel";
import { useStore } from "@/lib/store";
import type { Variable } from "@/lib/types";

export default function VariablesWorkbench() {
  const [activePanel, setActivePanel] = useState<"library" | "builder">(
    "library"
  );
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
    <WorkbenchLayout
      title={headerTitle}
      headerActions={
        <>
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
        </>
      }
    >
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
    </WorkbenchLayout>
  );
}
