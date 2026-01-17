import WorkbenchLayout from "@/components/WorkbenchLayout";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";

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
              <Button variant="outline" asChild>
                <Link to="/workbench/datasources">打开数据源中心</Link>
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
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
        </div>
      </div>
    </WorkbenchLayout>
  );
}
