import WorkbenchLayout from "@/components/WorkbenchLayout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  createDataSource,
  listDataSources,
  listMilvusCollections,
  type DataSource,
} from "@/lib/api/datasources";
import { ApiError } from "@/lib/api/types";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export default function VectorWorkbench() {
  const { t } = useTranslation();

  const [collections, setCollections] = useState<VectorCollection[]>([]);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState("");

  const refreshCollections = async () => {
    setLoadingCollections(true);
    try {
      const list = await listVectorCollections();
      setCollections(list);
      if (!selectedCollection && list[0]?.name)
        setSelectedCollection(list[0].name);
    } catch {
      toast.error(t("vectorWorkbench.loadCollectionsFailed"));
    } finally {
      setLoadingCollections(false);
    }
  };

  useEffect(() => {
    void refreshCollections();
  }, []);

  const [createName, setCreateName] = useState("");
  const [createDim, setCreateDim] = useState(1536);

  const [upsertJson, setUpsertJson] = useState(
    JSON.stringify(
      [
        {
          id: "p1",
          vector: [0, 0, 0],
          payload: { text: "hello" },
        },
      ],
      null,
      2
    )
  );

  const [searchVectorJson, setSearchVectorJson] = useState("[0,0,0]");
  const [searchTopK, setSearchTopK] = useState(10);
  const [filterKey, setFilterKey] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [searchHits, setSearchHits] = useState<
    { id: string; score: number; payload: unknown }[]
  >([]);

  const filter = useMemo((): VectorFilter | undefined => {
    if (!filterKey.trim()) return undefined;
    return {
      must: [{ key: filterKey.trim(), match: { value: filterValue } }],
    };
  }, [filterKey, filterValue]);

  const [milvusDataSources, setMilvusDataSources] = useState<DataSource[]>([]);
  const [milvusSelectedId, setMilvusSelectedId] = useState("");
  const [milvusCollections, setMilvusCollections] = useState<string[]>([]);
  const [milvusRaw, setMilvusRaw] = useState<unknown>(null);

  const refreshMilvusDataSources = async () => {
    try {
      const all = await listDataSources();
      const list = all.filter(ds => ds.driver === "milvus");
      setMilvusDataSources(list);
      if (!milvusSelectedId && list[0]?.id) setMilvusSelectedId(list[0].id);
    } catch {
      setMilvusDataSources([]);
    }
  };

  useEffect(() => {
    void refreshMilvusDataSources();
  }, []);

  return (
    <WorkbenchLayout title={t("workbench.vector")}>
      <div className="h-full p-4 flex flex-col gap-4 overflow-hidden">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-sm font-semibold">
              {t("vectorWorkbench.localTitle")}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t("vectorWorkbench.localDesc")}
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                variant="outline"
                onClick={() => void refreshCollections()}
              >
                {t("vectorWorkbench.refresh")}
              </Button>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-sm font-semibold">
              {t("vectorWorkbench.milvusTitle")}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t("vectorWorkbench.milvusDesc")}
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                variant="outline"
                onClick={() => void refreshMilvusDataSources()}
              >
                {t("vectorWorkbench.refresh")}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 grid gap-4 lg:grid-cols-2 overflow-hidden">
          <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">
                {t("vectorWorkbench.localPanel")}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void refreshCollections()}
                  disabled={loadingCollections}
                >
                  {t("vectorWorkbench.refresh")}
                </Button>
              </div>
            </div>

            <Tabs defaultValue="collections" className="flex-1 flex flex-col">
              <div className="px-4 pt-2">
                <TabsList className="w-full grid grid-cols-3">
                  <TabsTrigger value="collections">
                    {t("vectorWorkbench.collections")}
                  </TabsTrigger>
                  <TabsTrigger value="upsert">
                    {t("vectorWorkbench.upsert")}
                  </TabsTrigger>
                  <TabsTrigger value="search">
                    {t("vectorWorkbench.search")}
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent
                value="collections"
                className="flex-1 overflow-hidden"
              >
                <ScrollArea className="h-full p-4">
                  <div className="grid gap-3">
                    <div className="grid gap-2">
                      <Label className="text-xs text-muted-foreground">
                        {t("vectorWorkbench.createCollection")}
                      </Label>
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          className="h-9 font-mono text-xs"
                          value={createName}
                          onChange={e => setCreateName(e.target.value)}
                          placeholder={t("vectorWorkbench.collectionName")}
                        />
                        <Input
                          className="h-9 font-mono text-xs"
                          type="number"
                          value={createDim}
                          min={1}
                          max={4096}
                          onChange={e =>
                            setCreateDim(Number(e.target.value || 1536))
                          }
                        />
                      </div>
                      <Button
                        disabled={!createName.trim()}
                        onClick={async () => {
                          try {
                            await createVectorCollection({
                              name: createName.trim(),
                              dimension: Math.max(1, Math.min(4096, createDim)),
                              distance: "cosine",
                            });
                            toast.success(t("vectorWorkbench.created"));
                            setCreateName("");
                            await refreshCollections();
                          } catch {
                            toast.error(t("vectorWorkbench.createFailed"));
                          }
                        }}
                      >
                        {t("vectorWorkbench.create")}
                      </Button>
                    </div>

                    <div className="grid gap-2">
                      <Label className="text-xs text-muted-foreground">
                        {t("vectorWorkbench.selectCollection")}
                      </Label>
                      <Select
                        value={selectedCollection}
                        onValueChange={setSelectedCollection}
                      >
                        <SelectTrigger size="sm" className="w-full font-mono">
                          <SelectValue
                            placeholder={t("vectorWorkbench.noCollection")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {collections.map(c => (
                            <SelectItem key={c.name} value={c.name}>
                              {c.name} · {c.dimension}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <pre className="text-[11px] text-muted-foreground font-mono whitespace-pre-wrap">
                        {selectedCollection
                          ? JSON.stringify(
                              collections.find(
                                c => c.name === selectedCollection
                              ) ?? null,
                              null,
                              2
                            )
                          : ""}
                      </pre>
                    </div>
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="upsert" className="flex-1 overflow-hidden">
                <ScrollArea className="h-full p-4">
                  <div className="grid gap-3">
                    <Label className="text-xs text-muted-foreground">
                      {t("vectorWorkbench.pointsJson")}
                    </Label>
                    <Textarea
                      className="min-h-[180px] font-mono text-xs"
                      value={upsertJson}
                      onChange={e => setUpsertJson(e.target.value)}
                    />
                    <Button
                      disabled={!selectedCollection}
                      onClick={async () => {
                        if (!selectedCollection) return;
                        try {
                          const parsed = JSON.parse(upsertJson) as unknown;
                          if (!Array.isArray(parsed))
                            throw new Error("invalid");
                          const points = parsed as {
                            id: string;
                            vector: number[];
                            payload?: Record<string, unknown>;
                            batchId?: string;
                          }[];
                          const res = await upsertVectorPoints({
                            collection: selectedCollection,
                            points,
                          });
                          toast.success(
                            t("vectorWorkbench.upserted", {
                              n: String(res.upserted),
                            })
                          );
                        } catch {
                          toast.error(t("vectorWorkbench.invalidJson"));
                        }
                      }}
                    >
                      {t("vectorWorkbench.upsert")}
                    </Button>
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="search" className="flex-1 overflow-hidden">
                <ScrollArea className="h-full p-4">
                  <div className="grid gap-3">
                    <div className="grid gap-2">
                      <Label className="text-xs text-muted-foreground">
                        {t("vectorWorkbench.queryVector")}
                      </Label>
                      <Input
                        className="h-9 font-mono text-xs"
                        value={searchVectorJson}
                        onChange={e => setSearchVectorJson(e.target.value)}
                        placeholder="[0.1,0.2,...]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="grid gap-2">
                        <Label className="text-xs text-muted-foreground">
                          {t("vectorWorkbench.topK")}
                        </Label>
                        <Input
                          type="number"
                          className="h-9 font-mono text-xs"
                          value={searchTopK}
                          min={1}
                          max={100}
                          onChange={e =>
                            setSearchTopK(Number(e.target.value || 10))
                          }
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label className="text-xs text-muted-foreground">
                          {t("vectorWorkbench.filter")}
                        </Label>
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            className="h-9 font-mono text-xs"
                            value={filterKey}
                            onChange={e => setFilterKey(e.target.value)}
                            placeholder={t("vectorWorkbench.filterKey")}
                          />
                          <Input
                            className="h-9 font-mono text-xs"
                            value={filterValue}
                            onChange={e => setFilterValue(e.target.value)}
                            placeholder={t("vectorWorkbench.filterValue")}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        disabled={!selectedCollection}
                        onClick={async () => {
                          if (!selectedCollection) return;
                          try {
                            const vector = JSON.parse(
                              searchVectorJson
                            ) as number[];
                            if (!Array.isArray(vector))
                              throw new Error("invalid");
                            const res = await searchVector({
                              collection: selectedCollection,
                              vector: vector.map(Number),
                              topK: Math.max(1, Math.min(100, searchTopK)),
                              filter,
                            });
                            setSearchHits(res.hits);
                            toast.success(t("vectorWorkbench.searchOk"));
                          } catch {
                            setSearchHits([]);
                            toast.error(t("vectorWorkbench.searchFailed"));
                          }
                        }}
                      >
                        {t("vectorWorkbench.search")}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={!selectedCollection}
                        onClick={async () => {
                          if (!selectedCollection) return;
                          try {
                            const res = await deleteVectorPoints({
                              collection: selectedCollection,
                              filter,
                            });
                            toast.success(
                              t("vectorWorkbench.deleted", {
                                n: String(res.deleted),
                              })
                            );
                          } catch {
                            toast.error(t("vectorWorkbench.deleteFailed"));
                          }
                        }}
                      >
                        {t("vectorWorkbench.delete")}
                      </Button>
                    </div>

                    <pre className="rounded-md border border-border bg-background/50 p-3 text-[11px] font-mono overflow-auto">
                      {JSON.stringify(searchHits, null, 2)}
                    </pre>
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>

          <MilvusPanel
            milvusDataSources={milvusDataSources}
            selectedId={milvusSelectedId}
            onSelectedIdChange={setMilvusSelectedId}
            collections={milvusCollections}
            raw={milvusRaw}
            onRefreshDataSources={refreshMilvusDataSources}
            onListCollections={async () => {
              if (!milvusSelectedId) return;
              try {
                const res = await listMilvusCollections({
                  dataSourceId: milvusSelectedId,
                });
                setMilvusCollections(res.collections);
                setMilvusRaw(res.raw);
                toast.success(t("vectorWorkbench.milvusListOk"));
              } catch {
                setMilvusCollections([]);
                setMilvusRaw(null);
                toast.error(t("vectorWorkbench.milvusListFailed"));
              }
            }}
          />
        </div>
      </div>
    </WorkbenchLayout>
  );
}

function getApiErrorMessage(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  const bodyText = e.bodyText ?? "";
  if (!bodyText) return e.message;
  try {
    const parsed = JSON.parse(bodyText) as {
      message?: unknown;
      error?: unknown;
    };
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message;
    }
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error;
    }
  } catch {
    return bodyText;
  }
  return e.message;
}

function MilvusPanel(props: {
  milvusDataSources: DataSource[];
  selectedId: string;
  onSelectedIdChange: (id: string) => void;
  collections: string[];
  raw: unknown;
  onRefreshDataSources: () => Promise<void>;
  onListCollections: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col">
      <div className="p-4 border-b border-border flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">
          {t("vectorWorkbench.milvusPanel")}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCreateOpen(true)}
          >
            {t("vectorWorkbench.addMilvus")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void props.onRefreshDataSources()}
          >
            {t("vectorWorkbench.refresh")}
          </Button>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("vectorWorkbench.addMilvus")}</DialogTitle>
            <DialogDescription>
              {t("vectorWorkbench.addMilvusHint")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label className="text-xs text-muted-foreground">
                {t("dataSourceManager.name")}
              </Label>
              <Input
                className="h-9 font-mono text-xs"
                value={name}
                onChange={e => setName(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-xs text-muted-foreground">
                {t("vectorWorkbench.baseUrl")}
              </Label>
              <Input
                className="h-9 font-mono text-xs"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                autoComplete="off"
                placeholder="http://localhost:19530"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-xs text-muted-foreground">
                {t("vectorWorkbench.token")}
              </Label>
              <Input
                className="h-9 font-mono text-xs"
                type="password"
                value={token}
                onChange={e => setToken(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={submitting}
              >
                {t("database.cancel")}
              </Button>
              <Button
                disabled={
                  submitting || !name.trim() || !baseUrl.trim() || !token.trim()
                }
                onClick={async () => {
                  setSubmitting(true);
                  try {
                    await createDataSource({
                      name: name.trim(),
                      driver: "milvus",
                      url: baseUrl.trim(),
                      token: token.trim(),
                    });
                    toast.success(t("dataSourceManager.created"));
                    setName("");
                    setBaseUrl("");
                    setToken("");
                    setCreateOpen(false);
                    await props.onRefreshDataSources();
                  } catch (e) {
                    const msg =
                      getApiErrorMessage(e) ??
                      t("dataSourceManager.createFailed");
                    toast.error(msg);
                  } finally {
                    setSubmitting(false);
                  }
                }}
              >
                {t("database.create")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="p-4 border-b border-border">
        <Label className="text-xs text-muted-foreground">
          {t("vectorWorkbench.milvusDataSource")}
        </Label>
        <Select
          value={props.selectedId}
          onValueChange={props.onSelectedIdChange}
        >
          <SelectTrigger size="sm" className="mt-2 w-full font-mono">
            <SelectValue placeholder={t("vectorWorkbench.noMilvus")} />
          </SelectTrigger>
          <SelectContent>
            {props.milvusDataSources.map(ds => (
              <SelectItem key={ds.id} value={ds.id}>
                {ds.name} · {ds.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            disabled={!props.selectedId}
            onClick={() => void props.onListCollections()}
          >
            {t("vectorWorkbench.listCollections")}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="text-xs font-semibold text-muted-foreground">
          {t("vectorWorkbench.collections")}
        </div>
        {props.collections.length === 0 ? (
          <div className="mt-2 text-xs text-muted-foreground">
            {t("vectorWorkbench.noCollections")}
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {props.collections.map(c => (
              <div
                key={c}
                className="rounded border border-border bg-background/50 px-2 py-1 text-[11px] font-mono"
              >
                {c}
              </div>
            ))}
          </div>
        )}
        {props.raw ? (
          <pre className="mt-4 rounded-md border border-border bg-background/50 p-3 text-[11px] font-mono overflow-auto">
            {JSON.stringify(props.raw, null, 2)}
          </pre>
        ) : null}
      </ScrollArea>
    </div>
  );
}
