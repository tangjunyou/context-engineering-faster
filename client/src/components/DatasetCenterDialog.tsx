import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { RJSFSchema } from "@rjsf/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SchemaForm } from "@/components/ui/schema-form";
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

const createDatasetSchema: RJSFSchema = {
  type: "object",
  required: ["name", "items"],
  properties: {
    name: { type: "string", title: "Dataset Name", default: "My Dataset" },
    items: {
      type: "array",
      title: "Data Rows",
      items: {
        type: "object",
        properties: {
          text: { type: "string", title: "Content" },
          id: { type: "string", title: "ID (Optional)" },
        },
        required: ["text"],
      },
    },
  },
};

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
  const [needSavedProjectHint, setNeedSavedProjectHint] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [embedProviderId, setEmbedProviderId] = useState("");
  const [embedCollection, setEmbedCollection] = useState("");
  const [embedIdField, setEmbedIdField] = useState("id");
  const [embedTextField, setEmbedTextField] = useState("text");
  const [embedPayloadFieldsText, setEmbedPayloadFieldsText] =
    useState('["title","tag"]');

  // New State for Creation Flow
  const [isCreating, setIsCreating] = useState(false);

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
    // Reset states on open
    setIsCreating(false);
    setSelected(null);
    setSelectedRun(null);
    setReplayResults([]);
    setFilter("");
    setTab("preview");
    setNeedSavedProjectHint(false);
    setEmbedOpen(false);
    setEmbedProviderId("");
    setEmbedCollection("");
    setEmbedIdField("id");
    setEmbedTextField("text");
    setEmbedPayloadFieldsText('["title","tag"]');
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

  const handleCreateSubmit = async (data: any) => {
    const { formData } = data;
    if (!formData) return;
    try {
      const ds = await createDataset({
        name: formData.name,
        rows: formData.items,
      });
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
      setIsCreating(false);
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
    const providerId = embedProviderId.trim();
    const collection = embedCollection.trim();
    const idField = embedIdField.trim();
    const textField = embedTextField.trim();
    if (!providerId || !collection || !idField || !textField) return;
    let payloadFields: string[] | undefined;
    const payloadFieldsText = embedPayloadFieldsText.trim();
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
      setEmbedOpen(false);
    } catch {
      toast.error(t("datasetCenter.jobFailed"));
    }
  };

  const handleReplay = async () => {
    if (!selectedId) return;
    setTab("replay");
    if (!projectId) {
      toast.error(t("datasetCenter.replayNeedSavedProject"));
      setNeedSavedProjectHint(true);
      setTab("preview");
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
      <DialogContent className="sm:max-w-5xl h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {isCreating
              ? t("datasetCenter.newDataset")
              : t("datasetCenter.title")}
          </DialogTitle>
        </DialogHeader>

        {isCreating ? (
          <div className="flex-1 overflow-auto p-4">
            <Button
              variant="ghost"
              className="mb-4"
              onClick={() => setIsCreating(false)}
            >
              &larr; {t("datasetCenter.back")}
            </Button>
            <SchemaForm
              schema={createDatasetSchema}
              onSubmit={handleCreateSubmit}
              uiSchema={{
                "ui:submitButtonOptions": {
                  submitText: t("datasetCenter.create"),
                },
              }}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-6 flex-1 overflow-hidden min-h-0">
            <div className="space-y-2 flex flex-col h-full">
              <div className="flex items-center justify-between shrink-0">
                <Input
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  placeholder={t("datasetCenter.search")}
                  className="h-9 w-1/2"
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsCreating(true)}
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

              <ScrollArea className="flex-1 rounded-md border border-border">
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

            <div className="space-y-3 flex flex-col h-full overflow-hidden">
              <div className="flex items-center justify-between shrink-0">
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
                    onClick={() => setEmbedOpen(v => !v)}
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

              {needSavedProjectHint && (
                <div className="rounded-md border border-border bg-background/50 p-3 shrink-0">
                  <div className="text-sm font-semibold">
                    {t("datasetCenter.replayNeedSavedProject")}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    请先在右上角点击“工程”，保存/创建一个工程后再重试回放。
                  </div>
                </div>
              )}

              {embedOpen && (
                <div className="rounded-md border border-border bg-background/50 p-3 space-y-3 shrink-0">
                  <div className="text-xs text-muted-foreground">
                    {t("datasetCenter.embedToVector")}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <div className="text-xs">
                        {t("datasetCenter.embedPromptProviderId")}
                      </div>
                      <Input
                        value={embedProviderId}
                        onChange={e => setEmbedProviderId(e.target.value)}
                        className="h-9 font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs">
                        {t("datasetCenter.embedPromptCollection")}
                      </div>
                      <Input
                        value={embedCollection}
                        onChange={e => setEmbedCollection(e.target.value)}
                        className="h-9 font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs">
                        {t("datasetCenter.embedPromptIdField")}
                      </div>
                      <Input
                        value={embedIdField}
                        onChange={e => setEmbedIdField(e.target.value)}
                        className="h-9 font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs">
                        {t("datasetCenter.embedPromptTextField")}
                      </div>
                      <Input
                        value={embedTextField}
                        onChange={e => setEmbedTextField(e.target.value)}
                        className="h-9 font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1 col-span-2">
                      <div className="text-xs">
                        {t("datasetCenter.embedPromptPayloadFields")}
                      </div>
                      <Textarea
                        value={embedPayloadFieldsText}
                        onChange={e =>
                          setEmbedPayloadFieldsText(e.target.value)
                        }
                        className="min-h-20 font-mono text-xs"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEmbedOpen(false)}
                    >
                      {t("imports.cancel")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        !embedProviderId.trim() ||
                        !embedCollection.trim() ||
                        !embedIdField.trim() ||
                        !embedTextField.trim()
                      }
                      onClick={() => void handleEmbedToVector()}
                    >
                      {t("datasetCenter.embedToVector")}
                    </Button>
                  </div>
                </div>
              )}

              <Tabs
                value={tab}
                onValueChange={setTab}
                className="flex-1 flex flex-col min-h-0"
              >
                <TabsList className="shrink-0">
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

                <TabsContent
                  value="preview"
                  className="flex-1 min-h-0 overflow-auto"
                >
                  <div className="rounded-md border border-border bg-background/50 p-3 h-full">
                    <pre className="text-[11px] leading-5 overflow-auto h-full">
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

                <TabsContent
                  value="replay"
                  className="flex-1 min-h-0 overflow-auto"
                >
                  <div className="space-y-3 h-full flex flex-col">
                    <div className="text-xs text-muted-foreground shrink-0">
                      {t("datasetCenter.replayResults")}
                    </div>

                    {replayResults.length === 0 ? (
                      <div className="text-xs text-muted-foreground">
                        {t("datasetCenter.replayEmpty")}
                      </div>
                    ) : (
                      <div className="rounded-md border border-border bg-background/50 shrink-0">
                        <div className="p-2 space-y-2 max-h-[180px] overflow-auto">
                          {replayResults.map(r => (
                            <button
                              key={r.runId}
                              type="button"
                              onClick={() =>
                                void getRun(r.runId)
                                  .then(setSelectedRun)
                                  .catch(() => {
                                    toast.error(
                                      t("datasetCenter.runLoadFailed")
                                    );
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
                                  {t("datasetCenter.runRow", {
                                    idx: r.rowIndex,
                                  })}
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
                      <div className="flex-1 min-h-0 border border-border rounded-md overflow-hidden">
                        <TraceViewer trace={selectedRun.trace} />
                      </div>
                    ) : null}
                  </div>
                </TabsContent>

                <TabsContent
                  value="compare"
                  className="flex-1 min-h-0 overflow-auto"
                >
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
        )}
      </DialogContent>
    </Dialog>
  );
}
