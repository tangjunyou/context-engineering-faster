import { useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  createVectorCollection,
  deleteVectorPoints,
  listVectorCollections,
  searchVector,
  upsertVectorPoints,
  type VectorCollection,
  type VectorFilter,
} from "@/lib/api/vector";

export function VectorStudioDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { open, onOpenChange } = props;

  const [loading, setLoading] = useState(false);
  const [collections, setCollections] = useState<VectorCollection[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [searchResult, setSearchResult] = useState<unknown>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDim, setCreateDim] = useState("384");
  const [upsertOpen, setUpsertOpen] = useState(false);
  const [upsertText, setUpsertText] = useState(
    JSON.stringify(
      [
        {
          id: "p1",
          vector: Array(4).fill(0.1),
          payload: { tag: "demo" },
          batchId: "batch_1",
        },
      ],
      null,
      2
    )
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchVectorText, setSearchVectorText] = useState(
    JSON.stringify(Array(4).fill(0.1))
  );
  const [searchFilterText, setSearchFilterText] = useState(
    JSON.stringify(
      { must: [{ key: "tag", match: { value: "demo" } }] },
      null,
      2
    )
  );
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteFilterText, setDeleteFilterText] = useState(
    JSON.stringify(
      { must: [{ key: "tag", match: { value: "demo" } }] },
      null,
      2
    )
  );

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await listVectorCollections();
      setCollections(list);
      if (!selected && list[0]) setSelected(list[0].name);
    } catch {
      toast.error(t("vectorStudio.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setSearchResult(null);
    setFilter("");
    setCreateOpen(false);
    setCreateName("");
    setCreateDim("384");
    setUpsertOpen(false);
    setSearchOpen(false);
    setDeleteOpen(false);
    void refresh();
  }, [open]);

  const filtered = collections.filter(c =>
    c.name.toLowerCase().includes(filter.trim().toLowerCase())
  );

  const handleCreate = async () => {
    const name = createName.trim();
    if (!name) return;
    const dimension = Number(createDim);
    if (!Number.isFinite(dimension) || dimension <= 0) {
      toast.error(t("vectorStudio.invalidNumber"));
      return;
    }
    try {
      await createVectorCollection({ name, dimension, distance: "cosine" });
      toast.success(t("vectorStudio.created"));
      await refresh();
      setSelected(name);
      setCreateOpen(false);
      setCreateName("");
    } catch {
      toast.error(t("vectorStudio.createFailed"));
    }
  };

  const handleUpsert = async () => {
    if (!selected) return;
    let points: any[] = [];
    try {
      points = JSON.parse(upsertText);
    } catch {
      toast.error(t("vectorStudio.invalidJson"));
      return;
    }
    try {
      const res = await upsertVectorPoints({ collection: selected, points });
      toast.success(t("vectorStudio.upserted", { n: res.upserted }));
      setUpsertOpen(false);
    } catch {
      toast.error(t("vectorStudio.upsertFailed"));
    }
  };

  const handleSearch = async () => {
    if (!selected) return;
    let vector: number[] = [];
    try {
      vector = JSON.parse(searchVectorText);
    } catch {
      toast.error(t("vectorStudio.invalidJson"));
      return;
    }
    let filterObj: VectorFilter | undefined;
    if (searchFilterText.trim()) {
      try {
        filterObj = JSON.parse(searchFilterText);
      } catch {
        toast.error(t("vectorStudio.invalidJson"));
        return;
      }
    }
    try {
      const res = await searchVector({
        collection: selected,
        vector,
        topK: 10,
        filter: filterObj,
      });
      setSearchResult(res);
      toast.success(t("vectorStudio.searchOk"));
      setSearchOpen(false);
    } catch {
      setSearchResult(null);
      toast.error(t("vectorStudio.searchFailed"));
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    let filterObj: VectorFilter;
    try {
      filterObj = JSON.parse(deleteFilterText);
    } catch {
      toast.error(t("vectorStudio.invalidJson"));
      return;
    }
    try {
      const res = await deleteVectorPoints({
        collection: selected,
        filter: filterObj,
      });
      toast.success(t("vectorStudio.deleted", { n: res.deleted }));
      setDeleteOpen(false);
    } catch {
      toast.error(t("vectorStudio.deleteFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("vectorStudio.title")}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-1 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {t("vectorStudio.collections")}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCreateOpen(v => !v)}
              >
                {t("vectorStudio.create")}
              </Button>
            </div>
            {createOpen && (
              <div className="rounded-md border border-border p-3 space-y-2">
                <div className="text-xs text-muted-foreground">
                  {t("vectorStudio.create")}
                </div>
                <Input
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  placeholder={t("vectorStudio.createPromptName")}
                  className="h-9 font-mono text-xs"
                />
                <Input
                  value={createDim}
                  onChange={e => setCreateDim(e.target.value)}
                  placeholder={t("vectorStudio.createPromptDim")}
                  className="h-9 font-mono text-xs"
                  inputMode="numeric"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => void handleCreate()}
                    disabled={!createName.trim()}
                  >
                    {t("vectorStudio.create")}
                  </Button>
                </div>
              </div>
            )}
            <Input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder={t("vectorStudio.searchCollections")}
              className="h-9"
            />
            <ScrollArea className="h-[420px] rounded-md border border-border">
              <div className="p-2 space-y-1">
                {filtered.length === 0 ? (
                  <div className="text-xs text-muted-foreground p-2">
                    {loading
                      ? t("vectorStudio.loading")
                      : t("vectorStudio.empty")}
                  </div>
                ) : (
                  filtered.map(c => (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => setSelected(c.name)}
                      className={`w-full text-left rounded-md border border-border px-3 py-2 transition-colors ${
                        selected === c.name
                          ? "bg-muted"
                          : "bg-background/50 hover:bg-muted/50"
                      }`}
                    >
                      <div className="text-sm font-medium truncate">
                        {c.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">
                        {c.dimension} · {c.distance}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void refresh()}
              disabled={loading}
            >
              {t("vectorStudio.refresh")}
            </Button>
          </div>

          <div className="col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {t("vectorStudio.actions")}
              </div>
              <div className="text-xs text-muted-foreground font-mono">
                {selected ?? "-"}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setUpsertOpen(v => !v)}
                disabled={!selected}
              >
                {t("vectorStudio.upsert")}
              </Button>
              <Button
                variant="outline"
                onClick={() => setSearchOpen(v => !v)}
                disabled={!selected}
              >
                {t("vectorStudio.search")}
              </Button>
              <Button
                variant="outline"
                onClick={() => setDeleteOpen(v => !v)}
                disabled={!selected}
              >
                {t("vectorStudio.delete")}
              </Button>
            </div>
            {upsertOpen && (
              <div className="rounded-md border border-border p-3 space-y-2">
                <div className="text-xs text-muted-foreground">
                  {t("vectorStudio.upsert")}
                </div>
                <Textarea
                  value={upsertText}
                  onChange={e => setUpsertText(e.target.value)}
                  className="min-h-28 font-mono text-xs"
                />
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    onClick={() => void handleUpsert()}
                    disabled={!upsertText.trim() || !selected}
                  >
                    {t("vectorStudio.upsert")}
                  </Button>
                </div>
              </div>
            )}
            {searchOpen && (
              <div className="rounded-md border border-border p-3 space-y-2">
                <div className="text-xs text-muted-foreground">
                  {t("vectorStudio.search")}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">
                      {t("vectorStudio.searchPromptVector")}
                    </div>
                    <Textarea
                      value={searchVectorText}
                      onChange={e => setSearchVectorText(e.target.value)}
                      className="min-h-24 font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">
                      {t("vectorStudio.searchPromptFilter")}
                    </div>
                    <Textarea
                      value={searchFilterText}
                      onChange={e => setSearchFilterText(e.target.value)}
                      className="min-h-24 font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    onClick={() => void handleSearch()}
                    disabled={!selected}
                  >
                    {t("vectorStudio.search")}
                  </Button>
                </div>
              </div>
            )}
            {deleteOpen && (
              <div className="rounded-md border border-border p-3 space-y-2">
                <div className="text-xs text-muted-foreground">
                  {t("vectorStudio.delete")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("vectorStudio.deletePrompt")}
                </div>
                <Textarea
                  value={deleteFilterText}
                  onChange={e => setDeleteFilterText(e.target.value)}
                  className="min-h-24 font-mono text-xs"
                />
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    onClick={() => void handleDelete()}
                    disabled={!deleteFilterText.trim() || !selected}
                  >
                    {t("vectorStudio.delete")}
                  </Button>
                </div>
              </div>
            )}

            <div className="rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground">
                {t("vectorStudio.result")}
              </div>
              <pre className="mt-2 text-[11px] leading-5 overflow-auto max-h-[360px]">
                {searchResult
                  ? JSON.stringify(searchResult, null, 2)
                  : t("vectorStudio.noResult")}
              </pre>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
