import { ReactNode, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  BrainCircuit,
  Database,
  Layers,
  ListChecks,
  PanelLeft,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { ProjectManagerDialog } from "@/components/ProjectManagerDialog";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { healthz } from "@/lib/api/health";
import { toast } from "sonner";

export default function WorkbenchLayout(props: {
  title: string;
  children: ReactNode;
  headerActions?: ReactNode;
}) {
  const { t } = useTranslation();
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const { projectId, projectName } = useStore(s => ({
    projectId: s.projectId,
    projectName: s.projectName,
  }));

  const projectLabel = useMemo(() => {
    const idText = projectId
      ? ` (${projectId})`
      : ` (${t("projects.notSaved")})`;
    return `${t("app.projectLabel", { name: projectName })}${idText}`;
  }, [projectId, projectName, t]);

  useEffect(() => {
    const key = "data_key_warning_shown";
    if (sessionStorage.getItem(key)) return;
    void (async () => {
      try {
        const res = await healthz();
        if (res.dataKey && !res.dataKey.configured) {
          sessionStorage.setItem(key, "true");
          toast.error(
            t("workbench.missingDataKey", {
              message: res.dataKey.error ?? "missing DATA_KEY",
            })
          );
        }
      } catch {
        return;
      }
    })();
  }, [t]);

  return (
    <SidebarProvider defaultOpen>
      <ProjectManagerDialog
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
      />

      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="bg-primary/20 p-1.5 rounded text-primary">
              <BrainCircuit size={18} />
            </div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <div className="text-sm font-semibold leading-tight">
                {t("app.name")}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {t("app.version")}
              </div>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>{t("workbench.navGroup")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip={t("workbench.recipe")}>
                    <Link to="/workbench/context">
                      <PanelLeft className="h-4 w-4" />
                      <span>{t("workbench.recipe")}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip={t("workbench.variables")}>
                    <Link to="/workbench/variables">
                      <Layers className="h-4 w-4" />
                      <span>{t("workbench.variables")}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    tooltip={t("workbench.datasources")}
                  >
                    <Link to="/workbench/datasources">
                      <Database className="h-4 w-4" />
                      <span>{t("workbench.datasources")}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip={t("workbench.database")}>
                    <Link to="/workbench/database">
                      <Database className="h-4 w-4" />
                      <span>{t("workbench.database")}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip={t("workbench.vector")}>
                    <Link to="/workbench/vector">
                      <Database className="h-4 w-4" />
                      <span>{t("workbench.vector")}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    tooltip={t("workbench.evaluation")}
                  >
                    <Link to="/workbench/evaluation">
                      <ListChecks className="h-4 w-4" />
                      <span>{t("workbench.evaluation")}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="h-14 border-b border-border bg-card flex items-center px-4 justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <SidebarTrigger />
            <div className="font-semibold truncate">{props.title}</div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden md:block text-xs text-muted-foreground max-w-[520px] truncate">
              {projectLabel}
            </div>
            <Button
              variant="outline"
              className="h-8 px-3 text-sm"
              onClick={() => setProjectDialogOpen(true)}
            >
              {t("projects.manage")}
            </Button>
            {props.headerActions}
          </div>
        </header>

        <main className="h-[calc(100svh-3.5rem)] overflow-hidden">
          {props.children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
