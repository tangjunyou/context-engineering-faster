import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { shallow } from "zustand/shallow";
import { useStore } from "@/lib/store";
import {
  createProject,
  getProject,
  listProjects,
  upsertProject,
  type ProjectSummary,
} from "@/lib/api/projects";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

export function ProjectManagerDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { open, onOpenChange } = props;
  const {
    projectId,
    projectName,
    nodes,
    edges,
    variables,
    setProjectMeta,
    loadProjectState,
  } = useStore(
    s => ({
      projectId: s.projectId,
      projectName: s.projectName,
      nodes: s.nodes,
      edges: s.edges,
      variables: s.variables,
      setProjectMeta: s.setProjectMeta,
      loadProjectState: s.loadProjectState,
    }),
    shallow
  );

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [nameDraft, setNameDraft] = useState(projectName);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  useEffect(() => {
    if (!open) return;
    setNameDraft(projectName);
    setIsLoading(true);
    listProjects()
      .then(setProjects)
      .catch(() => toast.error(t("projects.loadFailed")))
      .finally(() => setIsLoading(false));
  }, [open, projectName, t]);

  const currentState = useMemo(
    () => ({ nodes, edges, variables }),
    [nodes, edges, variables]
  );

  const handleNew = () => {
    setProjectMeta({
      projectId: null,
      projectName: nameDraft.trim() || t("projects.untitled"),
    });
    toast.success(t("projects.newCreated"));
  };

  const handleSave = async () => {
    const name = nameDraft.trim() || t("projects.untitled");
    setIsSaving(true);
    try {
      const saved = projectId
        ? await upsertProject(projectId, { name, state: currentState })
        : await createProject({ name, state: currentState });
      setProjectMeta({ projectId: saved.id, projectName: saved.name });
      toast.success(t("projects.saved"));
      const list = await listProjects();
      setProjects(list);
    } catch {
      toast.error(t("projects.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoad = async (id: string) => {
    setIsLoading(true);
    try {
      const p = await getProject(id);
      loadProjectState({
        projectId: p.id,
        projectName: p.name,
        nodes: p.state.nodes,
        edges: p.state.edges,
        variables: p.state.variables,
      });
      toast.success(t("projects.loaded"));
      onOpenChange(false);
    } catch {
      toast.error(t("projects.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("projects.title")}</DialogTitle>
          <DialogDescription>
            在这里创建、保存与加载工程（图、变量等状态会随工程一起保存）。
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                {t("projects.current")}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  className="h-9"
                  name="projectName"
                  autoComplete="off"
                />
                <Button
                  variant="outline"
                  onClick={handleNew}
                  disabled={isSaving}
                >
                  {t("projects.new")}
                </Button>
                <Button onClick={() => void handleSave()} disabled={isSaving}>
                  {isSaving ? t("projects.saving") : t("projects.save")}
                </Button>
              </div>
              <div className="text-[11px] text-muted-foreground font-mono">
                {t("projects.currentId")}: {projectId ?? t("projects.notSaved")}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {t("projects.list")}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setIsLoading(true);
                  listProjects()
                    .then(setProjects)
                    .catch(() => toast.error(t("projects.loadFailed")))
                    .finally(() => setIsLoading(false));
                }}
                disabled={isLoading}
              >
                {t("projects.refresh")}
              </Button>
            </div>
            <ScrollArea className="h-[320px] rounded-md border border-border">
              <div className="p-2 space-y-2">
                {projects.length === 0 ? (
                  <div className="text-xs text-muted-foreground p-2">
                    {isLoading ? t("projects.loading") : t("projects.empty")}
                  </div>
                ) : (
                  projects
                    .slice()
                    .sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))
                    .map(p => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/50 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            {p.name}
                          </div>
                          <div className="text-[11px] text-muted-foreground font-mono truncate">
                            {p.id}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleLoad(p.id)}
                          disabled={isLoading}
                        >
                          {t("projects.load")}
                        </Button>
                      </div>
                    ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
