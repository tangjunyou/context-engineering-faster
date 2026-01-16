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
import {
  getImportJob,
  listImportJobs,
  type ImportJobRecord,
  type ImportJobSummary,
} from "@/lib/api/imports";

export function ImportHistoryDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { open, onOpenChange } = props;

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ImportJobSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ImportJobRecord | null>(null);
  const [filter, setFilter] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await listImportJobs();
      setItems(list);
      if (!selectedId) {
        const first = list[0];
        if (first) setSelectedId(first.id);
      }
    } catch {
      toast.error(t("importHistory.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    void refresh();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!selectedId) {
      setSelected(null);
      return;
    }
    setLoading(true);
    getImportJob(selectedId)
      .then(setSelected)
      .catch(() => toast.error(t("importHistory.loadFailed")))
      .finally(() => setLoading(false));
  }, [open, selectedId, t]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return items;
    return items.filter(x => {
      return (
        x.id.toLowerCase().includes(f) ||
        x.dataSourceId.toLowerCase().includes(f) ||
        x.driver.toLowerCase().includes(f) ||
        x.table.toLowerCase().includes(f) ||
        x.status.toLowerCase().includes(f)
      );
    });
  }, [items, filter]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("importHistory.title")}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Input
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder={t("importHistory.search")}
                className="h-9"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refresh()}
                disabled={loading}
              >
                {t("importHistory.refresh")}
              </Button>
            </div>

            <ScrollArea className="h-[420px] rounded-md border border-border">
              <div className="p-2 space-y-2">
                {filtered.length === 0 ? (
                  <div className="text-xs text-muted-foreground p-2">
                    {loading
                      ? t("importHistory.loading")
                      : t("importHistory.empty")}
                  </div>
                ) : (
                  filtered.map(job => (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => setSelectedId(job.id)}
                      className={`w-full text-left rounded-md border border-border px-3 py-2 transition-colors ${
                        selectedId === job.id
                          ? "bg-muted"
                          : "bg-background/50 hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium truncate">
                          {job.table}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {job.status}
                        </div>
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">
                        {job.id}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {job.driver} · {job.dataSourceId} ·{" "}
                        {job.insertedRows ?? "-"}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              {t("importHistory.detail")}
            </div>
            {selected ? (
              <div className="rounded-md border border-border bg-background/50 p-4 space-y-2">
                <div className="text-sm font-medium">{selected.table}</div>
                <div className="text-[11px] text-muted-foreground font-mono break-all">
                  {selected.id}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("importHistory.meta", {
                    driver: selected.driver,
                    ds: selected.dataSourceId,
                    status: selected.status,
                  })}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("importHistory.rows", { n: selected.insertedRows ?? 0 })}
                </div>
                {selected.status === "error" && selected.error && (
                  <pre className="text-[11px] leading-5 overflow-auto max-h-40 rounded-md border border-border p-2">
                    {selected.error}
                  </pre>
                )}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                {t("importHistory.noSelection")}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
