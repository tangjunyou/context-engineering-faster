import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStore } from "@/lib/store";
import {
  createDataset,
  deleteDataset,
  getDataset,
  listDatasets,
  type DatasetRecord,
  type DatasetSummary,
} from "@/lib/api/datasets";
import { embedToVectorJob } from "@/lib/api/jobs";
import {
  getRun,
  replayDataset,
  type RunRecord,
  type RunSummary,
} from "@/lib/api/runs";
import TraceViewer from "@/components/TraceViewer";
import RunComparePanel from "@/components/RunComparePanel";

export function DatasetCenterDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { open, onOpenChange } = props;
  const projectId = useStore(s => s.projectId);

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<DatasetSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<DatasetRecord | null>(null);
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState("preview");
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayResults, setReplayResults] = useState<RunSummary[]>([]);
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await listDatasets();
      setItems(list);
      if (!selectedId && list[0]) setSelectedId(list[0].id);
    } catch {
      toast.error(t("datasetCenter.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setSelectedRun(null);
    setReplayResults([]);
    setFilter("");
    setTab("preview");
    void refresh();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!selectedId) {
      setSelected(null);
      return;
    }
    setLoading(true);
    getDataset(selectedId)
      .then(setSelected)
      .catch(() => setSelected(null))
      .finally(() => setLoading(false));
  }, [open, selectedId]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return items;
    return items.filter(x => `${x.name} ${x.id}`.toLowerCase().includes(f));
  }, [items, filter]);

  const selectedSummary = useMemo(() => {
    if (!selectedId) return null;
    return items.find(x => x.id === selectedId) ?? null;
  }, [items, selectedId]);

  const handleCreate = async () => {
    const name = window.prompt(t("datasetCenter.createPromptName"), "dataset");
    if (!name) return;
    const text = window.prompt(
      t("datasetCenter.createPromptRows"),
      '[{"id":"1","text":"你好"}]'
    );
    if (!text) return;
    let rows: any[] = [];
    try {
      rows = JSON.parse(text);
    } catch {
      toast.error(t("datasetCenter.invalidJson"));
      return;
    }
    try {
      const ds = await createDataset({ name, rows });
      toast.success(t("datasetCenter.created"));
      setItems(prev => [
        {
          id: ds.id,
          name: ds.name,
          rowCount: ds.rows.length,
          updatedAt: ds.updatedAt,
        },
        ...prev,
      ]);
      setSelectedId(ds.id);
    } catch {
      toast.error(t("datasetCenter.createFailed"));
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    if (!window.confirm(t("datasetCenter.deleteConfirm"))) return;
    try {
      await deleteDataset(selectedId);
      toast.success(t("datasetCenter.deleted"));
      setItems(prev => prev.filter(x => x.id !== selectedId));
      setSelectedId(null);
      setSelected(null);
    } catch {
      toast.error(t("datasetCenter.deleteFailed"));
    }
  };

  const handleEmbedToVector = async () => {
    if (!selectedId) return;
    const providerId = window.prompt(t("datasetCenter.embedPromptProviderId"));
    if (!providerId) return;
    const collection = window.prompt(t("datasetCenter.embedPromptCollection"));
    if (!collection) return;
    const idField = window.prompt(t("datasetCenter.embedPromptIdField"), "id");
    if (!idField) return;
    const textField = window.prompt(
      t("datasetCenter.embedPromptTextField"),
      "text"
    );
    if (!textField) return;
    const payloadFieldsText = window.prompt(
      t("datasetCenter.embedPromptPayloadFields"),
      '["title","tag"]'
    );
    let payloadFields: string[] | undefined;
    if (payloadFieldsText) {
      try {
        payloadFields = JSON.parse(payloadFieldsText);
      } catch {
        toast.error(t("datasetCenter.invalidJson"));
        return;
      }
    }
    try {
      const res = await embedToVectorJob({
        datasetId: selectedId,
        providerId,
        collection,
        idField,
        textField,
        payloadFields,
      });
      toast.success(t("datasetCenter.jobCreated", { id: res.job.id }));
    } catch {
      toast.error(t("datasetCenter.jobFailed"));
    }
  };

  const handleReplay = async () => {
    if (!selectedId) return;
    setTab("replay");
    if (!projectId) {
      toast.error(t("datasetCenter.replayNeedSavedProject"));
      return;
    }
    setReplayLoading(true);
    setSelectedRun(null);
    try {
      const res = await replayDataset({
        datasetId: selectedId,
        projectId,
        limit: 20,
      });
      setReplayResults(res);
      toast.success(t("datasetCenter.replayOk"));
      if (res[0]?.runId) {
        const run = await getRun(res[0].runId);
        setSelectedRun(run);
      }
    } catch {
      toast.error(t("datasetCenter.replayFailed"));
    } finally {
      setReplayLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("datasetCenter.title")}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Input
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder={t("datasetCenter.search")}
                className="h-9"
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleCreate()}
                >
                  {t("datasetCenter.create")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void refresh()}
                  disabled={loading}
                >
                  {t("datasetCenter.refresh")}
                </Button>
              </div>
            </div>

            <ScrollArea className="h-[420px] rounded-md border border-border">
              <div className="p-2 space-y-2">
                {filtered.length === 0 ? (
                  <div className="text-xs text-muted-foreground p-2">
                    {loading
                      ? t("datasetCenter.loading")
                      : t("datasetCenter.empty")}
                  </div>
                ) : (
                  filtered.map(ds => (
                    <button
                      key={ds.id}
                      type="button"
                      onClick={() => setSelectedId(ds.id)}
                      className={`w-full text-left rounded-md border border-border px-3 py-2 transition-colors ${
                        selectedId === ds.id
                          ? "bg-muted"
                          : "bg-background/50 hover:bg-muted/50"
                      }`}
                    >
                      <div className="text-sm font-medium truncate">
                        {ds.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">
                        {ds.id}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {t("datasetCenter.rows", { n: ds.rowCount })}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {t("datasetCenter.detail")}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleReplay()}
                  disabled={!selectedId || replayLoading}
                >
                  {replayLoading
                    ? t("datasetCenter.replaying")
                    : t("datasetCenter.replay")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleEmbedToVector()}
                  disabled={!selectedId}
                >
                  {t("datasetCenter.embedToVector")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleDelete()}
                  disabled={!selectedId}
                >
                  {t("datasetCenter.delete")}
                </Button>
              </div>
            </div>

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="preview">
                  {t("datasetCenter.tabPreview")}
                </TabsTrigger>
                <TabsTrigger value="replay">
                  {t("datasetCenter.tabReplay")}
                </TabsTrigger>
                <TabsTrigger value="compare">
                  {t("datasetCenter.tabCompare")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="preview">
                <div className="rounded-md border border-border bg-background/50 p-3">
                  <pre className="text-[11px] leading-5 overflow-auto max-h-[420px]">
                    {selected
                      ? JSON.stringify(
                          { ...selected, rows: selected.rows.slice(0, 20) },
                          null,
                          2
                        )
                      : t("datasetCenter.noSelection")}
                  </pre>
                </div>
              </TabsContent>

              <TabsContent value="replay">
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground">
                    {t("datasetCenter.replayResults")}
                  </div>

                  {replayResults.length === 0 ? (
                    <div className="text-xs text-muted-foreground">
                      {t("datasetCenter.replayEmpty")}
                    </div>
                  ) : (
                    <div className="rounded-md border border-border bg-background/50">
                      <div className="p-2 space-y-2 max-h-[180px] overflow-auto">
                        {replayResults.map(r => (
                          <button
                            key={r.runId}
                            type="button"
                            onClick={() =>
                              void getRun(r.runId)
                                .then(setSelectedRun)
                                .catch(() => {
                                  toast.error(t("datasetCenter.runLoadFailed"));
                                })
                            }
                            className={`w-full text-left rounded-md border border-border px-3 py-2 transition-colors ${
                              selectedRun?.runId === r.runId
                                ? "bg-muted"
                                : "bg-background/50 hover:bg-muted/50"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-medium truncate">
                                {t("datasetCenter.runRow", { idx: r.rowIndex })}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {r.status}
                              </div>
                            </div>
                            <div className="text-[11px] text-muted-foreground font-mono truncate">
                              {r.runId}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedRun?.trace ? (
                    <TraceViewer trace={selectedRun.trace} />
                  ) : null}
                </div>
              </TabsContent>

              <TabsContent value="compare">
                {selectedId ? (
                  <RunComparePanel
                    datasetId={selectedId}
                    rowCount={selectedSummary?.rowCount ?? 0}
                    onRequestReplayTab={() => setTab("replay")}
                  />
                ) : (
                  <div className="text-xs text-muted-foreground">
                    {t("datasetCenter.noSelection")}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
