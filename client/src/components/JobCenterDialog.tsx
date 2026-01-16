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
  getJob,
  listJobs,
  type JobRecord,
  type JobSummary,
} from "@/lib/api/jobs";

export function JobCenterDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { open, onOpenChange } = props;

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<JobSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<JobRecord | null>(null);
  const [filter, setFilter] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await listJobs();
      setItems(list);
      if (!selectedId && list[0]) setSelectedId(list[0].id);
    } catch {
      toast.error(t("jobCenter.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setFilter("");
    void refresh();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!selectedId) {
      setSelected(null);
      return;
    }
    setLoading(true);
    getJob(selectedId)
      .then(setSelected)
      .catch(() => setSelected(null))
      .finally(() => setLoading(false));
  }, [open, selectedId]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return items;
    return items.filter(x =>
      `${x.id} ${x.jobType} ${x.status}`.toLowerCase().includes(f)
    );
  }, [items, filter]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("jobCenter.title")}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Input
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder={t("jobCenter.search")}
                className="h-9"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refresh()}
                disabled={loading}
              >
                {t("jobCenter.refresh")}
              </Button>
            </div>
            <ScrollArea className="h-[420px] rounded-md border border-border">
              <div className="p-2 space-y-2">
                {filtered.length === 0 ? (
                  <div className="text-xs text-muted-foreground p-2">
                    {loading ? t("jobCenter.loading") : t("jobCenter.empty")}
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
                          {job.jobType}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {job.status}
                        </div>
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">
                        {job.id}
                      </div>
                      {job.summary && (
                        <div className="text-[11px] text-muted-foreground truncate">
                          {job.summary}
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              {t("jobCenter.detail")}
            </div>
            <div className="rounded-md border border-border bg-background/50 p-3">
              <pre className="text-[11px] leading-5 overflow-auto max-h-[440px]">
                {selected
                  ? JSON.stringify(selected, null, 2)
                  : t("jobCenter.noSelection")}
              </pre>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
