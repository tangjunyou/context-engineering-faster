export type DiffLine = {
  left: string;
  right: string;
  kind: "same" | "changed" | "missing-left" | "missing-right";
};

export function diffLines(leftText: string, rightText: string): DiffLine[] {
  const left = leftText.split("\n");
  const right = rightText.split("\n");
  const max = Math.max(left.length, right.length);

  const out: DiffLine[] = [];
  for (let i = 0; i < max; i += 1) {
    const l = left[i];
    const r = right[i];

    if (l === undefined) {
      out.push({ left: "", right: r ?? "", kind: "missing-left" });
      continue;
    }
    if (r === undefined) {
      out.push({ left: l, right: "", kind: "missing-right" });
      continue;
    }
    if (l === r) {
      out.push({ left: l, right: r, kind: "same" });
      continue;
    }
    out.push({ left: l, right: r, kind: "changed" });
  }
  return out;
}
