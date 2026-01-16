import type { TraceRun } from "@shared/trace";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function TraceViewer(props: { trace: TraceRun }) {
  const { t } = useTranslation();
  const trace = props.trace;

  const missing = Array.from(
    new Set(trace.segments.flatMap(s => s.missingVariables))
  ).filter(Boolean);

  return (
    <ScrollArea className="h-[320px] rounded-md border border-border bg-background/50">
      <div className="p-3 space-y-3">
        {missing.length > 0 ? (
          <Alert>
            <AlertTriangle />
            <AlertTitle>{t("traceViewer.missingTitle")}</AlertTitle>
            <AlertDescription>
              {t("traceViewer.missingSummary", { names: missing.join(", ") })}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="rounded-md border border-border bg-background/60 p-3">
          <div className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
            {t("traceViewer.output")}
          </div>
          <pre className="mt-2 font-mono text-[11px] whitespace-pre-wrap leading-5">
            {trace.text}
          </pre>
        </div>

        {trace.messages.length > 0 ? (
          <div className="rounded-md border border-border bg-background/60 p-3">
            <div className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
              {t("traceViewer.messages")}
            </div>
            <div className="mt-2 space-y-1">
              {trace.messages.map((m, idx) => (
                <div key={`${m.code}-${idx}`} className="text-[11px]">
                  [{m.severity}] {m.code}: {m.message}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          {trace.segments.map(seg => (
            <div
              key={seg.nodeId}
              className="rounded-md border border-border bg-background/60 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold truncate">
                  {seg.label}
                </div>
                {seg.missingVariables.length > 0 ? (
                  <div className="text-[11px] text-destructive">
                    {t("traceViewer.missingInline", {
                      names: seg.missingVariables.join(", "),
                    })}
                  </div>
                ) : null}
              </div>
              <pre className="mt-2 font-mono text-[11px] whitespace-pre-wrap leading-5 text-muted-foreground">
                {seg.rendered}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
