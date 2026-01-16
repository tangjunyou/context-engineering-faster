import { Link } from "@tanstack/react-router";
import { BrainCircuit, Database, Layers } from "lucide-react";
import { useState } from "react";

import DataSourceManager from "@/components/DataSourceManager";
import { Button } from "@/components/ui/button";
import { ProjectManagerDialog } from "@/components/ProjectManagerDialog";
import { useStore } from "@/lib/store";

export default function DataWorkbench() {
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const { projectId, projectName } = useStore(s => ({
    projectId: s.projectId,
    projectName: s.projectName,
  }));

  return (
    <div className="h-screen w-screen bg-background text-foreground overflow-hidden flex flex-col">
      <header className="h-14 border-b border-border bg-card flex items-center px-4 justify-between z-10">
        <div className="flex items-center gap-2">
          <div className="bg-primary/20 p-1.5 rounded text-primary">
            <BrainCircuit size={20} />
          </div>
          <h1 className="font-bold text-lg tracking-tight">数据工作台</h1>
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
          <Button asChild variant="outline" className="h-8 px-3 text-sm">
            <Link to="/workbench/context">
              <Database className="mr-2 h-4 w-4" />
              上下文装配
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-8 px-3 text-sm">
            <Link to="/workbench/variables">
              <Layers className="mr-2 h-4 w-4" />
              变量工作台
            </Link>
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <ProjectManagerDialog
          open={projectDialogOpen}
          onOpenChange={setProjectDialogOpen}
        />
        <div className="h-full p-4">
          <DataSourceManager />
        </div>
      </main>
    </div>
  );
}
