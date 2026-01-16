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
    void refresh();
  }, [open]);

  const filtered = collections.filter(c =>
    c.name.toLowerCase().includes(filter.trim().toLowerCase())
  );

  const handleCreate = async () => {
    const name = window.prompt(t("vectorStudio.createPromptName"));
    if (!name) return;
    const dimText = window.prompt(t("vectorStudio.createPromptDim"), "384");
    if (!dimText) return;
    const dimension = Number(dimText);
    if (!Number.isFinite(dimension) || dimension <= 0) {
      toast.error(t("vectorStudio.invalidNumber"));
      return;
    }
    try {
      await createVectorCollection({ name, dimension, distance: "cosine" });
      toast.success(t("vectorStudio.created"));
      await refresh();
      setSelected(name);
    } catch {
      toast.error(t("vectorStudio.createFailed"));
    }
  };

  const handleUpsert = async () => {
    if (!selected) return;
    const text = window.prompt(
      t("vectorStudio.upsertPrompt"),
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
    if (!text) return;
    let points: any[] = [];
    try {
      points = JSON.parse(text);
    } catch {
      toast.error(t("vectorStudio.invalidJson"));
      return;
    }
    try {
      const res = await upsertVectorPoints({ collection: selected, points });
      toast.success(t("vectorStudio.upserted", { n: res.upserted }));
    } catch {
      toast.error(t("vectorStudio.upsertFailed"));
    }
  };

  const handleSearch = async () => {
    if (!selected) return;
    const vecText = window.prompt(
      t("vectorStudio.searchPromptVector"),
      JSON.stringify(Array(4).fill(0.1))
    );
    if (!vecText) return;
    let vector: number[] = [];
    try {
      vector = JSON.parse(vecText);
    } catch {
      toast.error(t("vectorStudio.invalidJson"));
      return;
    }
    const filterText = window.prompt(
      t("vectorStudio.searchPromptFilter"),
      JSON.stringify(
        { must: [{ key: "tag", match: { value: "demo" } }] },
        null,
        2
      )
    );
    let filterObj: VectorFilter | undefined;
    if (filterText) {
      try {
        filterObj = JSON.parse(filterText);
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
    } catch {
      setSearchResult(null);
      toast.error(t("vectorStudio.searchFailed"));
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    const filterText = window.prompt(
      t("vectorStudio.deletePrompt"),
      JSON.stringify(
        { must: [{ key: "tag", match: { value: "demo" } }] },
        null,
        2
      )
    );
    if (!filterText) return;
    let filterObj: VectorFilter;
    try {
      filterObj = JSON.parse(filterText);
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
                onClick={() => void handleCreate()}
              >
                {t("vectorStudio.create")}
              </Button>
            </div>
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
                onClick={() => void handleUpsert()}
                disabled={!selected}
              >
                {t("vectorStudio.upsert")}
              </Button>
              <Button
                variant="outline"
                onClick={() => void handleSearch()}
                disabled={!selected}
              >
                {t("vectorStudio.search")}
              </Button>
              <Button
                variant="outline"
                onClick={() => void handleDelete()}
                disabled={!selected}
              >
                {t("vectorStudio.delete")}
              </Button>
            </div>

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
