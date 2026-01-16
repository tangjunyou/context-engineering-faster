import { diffLines } from "@/lib/diff";
import { cn } from "@/lib/utils";

export default function DiffViewer(props: { left: string; right: string }) {
  const lines = diffLines(props.left, props.right);

  const rowClass = (kind: string) =>
    cn(
      "grid grid-cols-2 gap-2 rounded-md border border-border px-2 py-1",
      kind === "same" && "bg-background/60",
      kind === "changed" && "bg-destructive/10 border-destructive/30",
      kind === "missing-left" && "bg-amber-500/10 border-amber-500/30",
      kind === "missing-right" && "bg-amber-500/10 border-amber-500/30"
    );

  return (
    <div className="space-y-2">
      {lines.map((l, idx) => (
        <div key={idx} className={rowClass(l.kind)}>
          <pre className="font-mono text-[11px] leading-5 whitespace-pre-wrap">
            {l.left.length ? l.left : "∅"}
          </pre>
          <pre className="font-mono text-[11px] leading-5 whitespace-pre-wrap">
            {l.right.length ? l.right : "∅"}
          </pre>
        </div>
      ))}
    </div>
  );
}
