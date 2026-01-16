import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import DiffViewer from "@/components/DiffViewer";
import TraceViewer from "@/components/TraceViewer";
import {
  getRun,
  listDatasetRunsForRow,
  type RunRecord,
  type RunSummary,
} from "@/lib/api/runs";

export default function RunComparePanel(props: {
  datasetId: string;
  rowCount: number;
  onRequestReplayTab?: () => void;
}) {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [rowIndexText, setRowIndexText] = useState("0");
  const rowIndex = useMemo(() => {
    const n = Number(rowIndexText);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }, [rowIndexText]);

  const [loading, setLoading] = useState(false);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [baselineId, setBaselineId] = useState<string>("");
  const [compareId, setCompareId] = useState<string>("");
  const [baseline, setBaseline] = useState<RunRecord | null>(null);
  const [compare, setCompare] = useState<RunRecord | null>(null);

  useEffect(() => {
    setBaseline(null);
    setCompare(null);
    setRuns([]);
    setBaselineId("");
    setCompareId("");

    if (!props.datasetId) return;
    if (rowIndex >= props.rowCount) return;

    setLoading(true);
    listDatasetRunsForRow(props.datasetId, { rowIndex, limit: 50 })
      .then(list => {
        setRuns(list);
        if (list[0]?.runId) setBaselineId(list[0].runId);
        if (list[1]?.runId) setCompareId(list[1].runId);
      })
      .catch(() => {
        toast.error(tRef.current("datasetCenter.compareLoadRunsFailed"));
      })
      .finally(() => setLoading(false));
  }, [props.datasetId, props.rowCount, rowIndex]);

  useEffect(() => {
    if (!baselineId) {
      setBaseline(null);
      return;
    }
    getRun(baselineId)
      .then(setBaseline)
      .catch(() => {
        setBaseline(null);
        toast.error(tRef.current("datasetCenter.compareLoadRunFailed"));
      });
  }, [baselineId]);

  useEffect(() => {
    if (!compareId) {
      setCompare(null);
      return;
    }
    getRun(compareId)
      .then(setCompare)
      .catch(() => {
        setCompare(null);
        toast.error(tRef.current("datasetCenter.compareLoadRunFailed"));
      });
  }, [compareId]);

  const stable =
    baseline && compare && baseline.outputDigest === compare.outputDigest;

  const clampedRowIndex = Math.min(
    Math.max(0, rowIndex),
    Math.max(0, props.rowCount - 1)
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground">
            {t("datasetCenter.compareRowIndex")}
          </div>
          <Input
            className="h-9 w-24"
            value={rowIndexText}
            onChange={e => setRowIndexText(e.target.value)}
            inputMode="numeric"
          />
          <div className="text-xs text-muted-foreground">
            / {Math.max(0, props.rowCount - 1)}
          </div>
          {rowIndex !== clampedRowIndex ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRowIndexText(String(clampedRowIndex))}
            >
              {t("datasetCenter.compareClamp")}
            </Button>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setRowIndexText(String(rowIndex));
          }}
          disabled={loading}
        >
          {loading ? t("datasetCenter.loading") : t("datasetCenter.refresh")}
        </Button>
      </div>

      {rowIndex >= props.rowCount ? (
        <div className="text-sm text-muted-foreground">
          {t("datasetCenter.compareRowOutOfRange")}
        </div>
      ) : runs.length < 2 ? (
        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            {t("datasetCenter.compareNeedTwoRuns")}
          </div>
          {props.onRequestReplayTab ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={props.onRequestReplayTab}
            >
              {t("datasetCenter.compareGoReplay")}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              {t("datasetCenter.compareBaseline")}
            </div>
            <select
              value={baselineId}
              onChange={e => setBaselineId(e.target.value)}
              className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
            >
              {runs.map(r => (
                <option key={r.runId} value={r.runId}>
                  {r.runId} · {r.createdAt}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              {t("datasetCenter.compareCompare")}
            </div>
            <select
              value={compareId}
              onChange={e => setCompareId(e.target.value)}
              className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
            >
              {runs.map(r => (
                <option key={r.runId} value={r.runId}>
                  {r.runId} · {r.createdAt}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {baseline && compare ? (
        <div className="rounded-md border border-border bg-background/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">
              {stable
                ? t("datasetCenter.compareStable")
                : t("datasetCenter.compareDrift")}
            </div>
            <div className="text-[11px] text-muted-foreground font-mono">
              {baseline.outputDigest.slice(0, 12)} … vs{" "}
              {compare.outputDigest.slice(0, 12)} …
            </div>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {t("datasetCenter.compareMeta", {
              a: baseline.runId,
              b: compare.runId,
            })}
          </div>
        </div>
      ) : null}

      {baseline && compare ? (
        <ScrollArea className="h-[280px] rounded-md border border-border bg-background/50">
          <div className="p-3">
            <DiffViewer left={baseline.trace.text} right={compare.trace.text} />
          </div>
        </ScrollArea>
      ) : null}

      {baseline && compare ? (
        <div className="grid grid-cols-2 gap-4">
          <TraceViewer trace={baseline.trace} />
          <TraceViewer trace={compare.trace} />
        </div>
      ) : null}
    </div>
  );
}
