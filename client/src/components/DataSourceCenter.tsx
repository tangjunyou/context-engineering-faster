import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { shallow } from "zustand/shallow";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CreateDataSourceDialog } from "@/components/CreateDataSourceDialog";
import { ImportCsvDialog } from "@/components/ImportCsvDialog";
import { SqlBrowserDialog } from "@/components/SqlBrowserDialog";
import {
  deleteDataSource,
  listDataSources,
  testDataSource,
  updateDataSource,
  listMilvusCollections,
  listDataSourceTables,
  previewTableRows,
  milvusInsert,
  milvusQuery,
  milvusSearch,
} from "@/lib/api/datasources";
import { sqlQuery, type SqlQueryResponse } from "@/lib/api/sql";
import { useStore } from "@/lib/store";
import type { Variable } from "@/lib/types";

type DataSource = Awaited<ReturnType<typeof listDataSources>>[number];

function isSqlDriver(driver: string) {
  return driver === "sqlite" || driver === "postgres" || driver === "mysql";
}

function getResolver(driver: string, id: string) {
  if (driver === "milvus") return `milvus://${id}`;
  if (driver === "neo4j") return `neo4j://${id}`;
  return `sql://${id}`;
}

export default function DataSourceCenter() {
  const { t } = useTranslation();
  const { addVariable, selectedNodeId, updateNodeData, nodes } = useStore(
    s => ({
      addVariable: s.addVariable,
      selectedNodeId: s.selectedNodeId,
      updateNodeData: s.updateNodeData,
      nodes: s.nodes,
    }),
    shallow
  );
  const [items, setItems] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importForId, setImportForId] = useState<string | null>(null);
  const [browseSqlFor, setBrowseSqlFor] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [milvusCollections, setMilvusCollections] = useState<{
    collections: string[];
    raw: unknown;
  } | null>(null);
  const [milvusLoading, setMilvusLoading] = useState(false);
  const [sqlTables, setSqlTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [previewLimit, setPreviewLimit] = useState("20");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRows, setPreviewRows] = useState<
    Record<string, unknown>[] | null
  >(null);

  const [sqlBuilderQuery, setSqlBuilderQuery] = useState("SELECT 1 AS value");
  const [sqlBuilderVarName, setSqlBuilderVarName] = useState("sql_value");
  const [sqlBuilderAttach, setSqlBuilderAttach] = useState(true);
  const [sqlBuilderRunning, setSqlBuilderRunning] = useState(false);
  const [sqlBuilderResult, setSqlBuilderResult] =
    useState<SqlQueryResponse | null>(null);

  const [milvusOp, setMilvusOp] = useState<"search" | "query" | "insert">(
    "search"
  );
  const [milvusBodyText, setMilvusBodyText] = useState("{}");
  const [milvusRunLoading, setMilvusRunLoading] = useState(false);
  const [milvusRunResult, setMilvusRunResult] = useState<unknown>(null);
  const [milvusVarName, setMilvusVarName] = useState("milvus_result");
  const [milvusAttach, setMilvusAttach] = useState(true);

  const selected = useMemo(
    () => items.find(x => x.id === selectedId) ?? null,
    [items, selectedId]
  );

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await listDataSources();
      setItems(list);
      if (!selectedId && list[0]) setSelectedId(list[0].id);
    } catch {
      toast.error(t("dataSourceManager.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    setMilvusCollections(null);
    setMilvusRunResult(null);
    setSqlTables([]);
    setSelectedTable("");
    setPreviewRows(null);
    setSqlBuilderResult(null);
    if (!selected) return;

    if (isSqlDriver(selected.driver)) {
      void listDataSourceTables({ dataSourceId: selected.id })
        .then(res => {
          setSqlTables(res.tables ?? []);
          if (res.tables?.[0]) setSelectedTable(res.tables[0]);
        })
        .catch(() => setSqlTables([]));

      setSqlBuilderQuery("SELECT 1 AS value");
      setSqlBuilderVarName(`${selected.name.replaceAll(" ", "_")}_value`);
    }

    if (selected.driver === "milvus") {
      setMilvusOp("search");
      setMilvusBodyText(
        JSON.stringify(
          {
            collectionName: "your_collection",
            data: [[0.1, 0.1, 0.1, 0.1]],
            limit: 10,
          },
          null,
          2
        )
      );
      setMilvusVarName(`${selected.name.replaceAll(" ", "_")}_result`);
    }
  }, [selected?.id]);

  const handleTest = async (id: string) => {
    try {
      const res = await testDataSource(id);
      if (res.ok) toast.success(t("dataSourceManager.testOk"));
      else toast.error(t("dataSourceManager.testFailed"));
    } catch {
      toast.error(t("dataSourceManager.testFailed"));
    }
  };

  const handleDelete = async (id: string) => {
    const ok = window.confirm(t("dataSourceManager.deleteConfirm"));
    if (!ok) return;
    try {
      await deleteDataSource(id);
      setItems(prev => prev.filter(v => v.id !== id));
      if (selectedId === id) setSelectedId(null);
      toast.success(t("dataSourceManager.deleted"));
    } catch {
      toast.error(t("dataSourceManager.deleteFailed"));
    }
  };

  const handleToggle = async (
    ds: DataSource,
    input: Partial<{
      allowImport: boolean;
      allowWrite: boolean;
      allowSchema: boolean;
      allowDelete: boolean;
    }>
  ) => {
    try {
      const updated = await updateDataSource(ds.id, input);
      setItems(prev => prev.map(v => (v.id === ds.id ? updated : v)));
      toast.success(t("dataSourceManager.created"));
    } catch {
      toast.error(t("dataSourceManager.updateFailed"));
    }
  };

  const capabilities = useMemo(() => {
    if (!selected) return [];
    const caps: Array<{ key: string; label: string; enabled: boolean }> = [];

    const allowImport = Boolean(selected.allowImport);
    const allowWrite = Boolean(selected.allowWrite);
    const allowSchema = Boolean(selected.allowSchema);
    const allowDelete = Boolean(selected.allowDelete);

    if (isSqlDriver(selected.driver)) {
      caps.push({ key: "schema", label: "结构浏览", enabled: true });
      caps.push({
        key: "preview",
        label: "数据预览",
        enabled: selected.driver === "sqlite" || true,
      });
      caps.push({ key: "query", label: "查询运行", enabled: true });
      caps.push({ key: "import", label: "CSV 导入", enabled: allowImport });
      caps.push({ key: "write", label: "写入", enabled: allowWrite });
      caps.push({
        key: "schemaWrite",
        label: "建表/改表",
        enabled: allowSchema,
      });
      caps.push({ key: "delete", label: "删除", enabled: allowDelete });
    } else if (selected.driver === "milvus") {
      caps.push({ key: "collections", label: "Collections", enabled: true });
      caps.push({ key: "search", label: "向量检索", enabled: true });
    } else if (selected.driver === "neo4j") {
      caps.push({ key: "labels", label: "Labels", enabled: true });
      caps.push({ key: "cypher", label: "Cypher 执行", enabled: true });
    }

    return caps;
  }, [selected]);

  const handleLoadMilvusCollections = async () => {
    if (!selected || selected.driver !== "milvus") return;
    setMilvusLoading(true);
    try {
      const res = await listMilvusCollections({ dataSourceId: selected.id });
      setMilvusCollections(res);
      toast.success("已加载 collections");
    } catch {
      setMilvusCollections(null);
      toast.error("加载 collections 失败");
    } finally {
      setMilvusLoading(false);
    }
  };

  const handlePreviewRows = async () => {
    if (!selected) return;
    if (!isSqlDriver(selected.driver)) return;
    const table = selectedTable.trim();
    if (!table) return;
    const limit = Number(previewLimit);
    if (!Number.isFinite(limit)) return;
    setPreviewLoading(true);
    try {
      const res = await previewTableRows({
        dataSourceId: selected.id,
        table,
        limit,
      });
      setPreviewRows(res.rows);
      toast.success("已加载预览行");
    } catch {
      setPreviewRows(null);
      toast.error("预览失败");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleRunSqlBuilder = async () => {
    if (!selected) return;
    if (!isSqlDriver(selected.driver)) return;
    const query = sqlBuilderQuery.trim();
    if (!query) return;
    setSqlBuilderRunning(true);
    try {
      const res = await sqlQuery({
        dataSourceId: selected.id,
        query,
        rowLimit: 50,
      });
      setSqlBuilderResult(res);
      toast.success("查询成功");
    } catch {
      setSqlBuilderResult(null);
      toast.error("查询失败");
    } finally {
      setSqlBuilderRunning(false);
    }
  };

  const attachVariableToSelectedNode = (v: Variable) => {
    if (!selectedNodeId) return;
    const current = nodes.find(n => n.id === selectedNodeId);
    const currentVars = current?.data?.variables ?? [];
    const nextVars = currentVars.includes(v.id)
      ? currentVars
      : [...currentVars, v.id];
    updateNodeData(selectedNodeId, { variables: nextVars });
  };

  const handleCreateSqlVariable = () => {
    if (!selected) return;
    if (!isSqlDriver(selected.driver)) return;
    const name = sqlBuilderVarName.trim();
    const query = sqlBuilderQuery.trim();
    if (!name || !query) return;
    const v: Variable = {
      id: `var_${Date.now()}`,
      name,
      type: "dynamic",
      value: query,
      resolver: `sql://${selected.id}`,
      source: selected.name,
      description: `SQL: ${selected.driver}`,
    };
    addVariable(v);
    if (sqlBuilderAttach) attachVariableToSelectedNode(v);
    toast.success("已创建变量");
  };

  const handleRunMilvus = async () => {
    if (!selected || selected.driver !== "milvus") return;
    let body: unknown;
    try {
      body = JSON.parse(milvusBodyText);
    } catch {
      toast.error("JSON 解析失败");
      return;
    }
    setMilvusRunLoading(true);
    try {
      const res =
        milvusOp === "insert"
          ? await milvusInsert({ dataSourceId: selected.id, body })
          : milvusOp === "query"
            ? await milvusQuery({ dataSourceId: selected.id, body })
            : await milvusSearch({ dataSourceId: selected.id, body });
      setMilvusRunResult(res);
      toast.success("执行成功");
    } catch {
      setMilvusRunResult(null);
      toast.error("执行失败");
    } finally {
      setMilvusRunLoading(false);
    }
  };

  const handleCreateMilvusVariable = () => {
    if (!selected || selected.driver !== "milvus") return;
    const name = milvusVarName.trim();
    if (!name) return;
    let body: any;
    try {
      body = JSON.parse(milvusBodyText);
    } catch {
      toast.error("JSON 解析失败");
      return;
    }
    if (body == null || typeof body !== "object" || Array.isArray(body)) {
      toast.error("Milvus body 必须是 JSON 对象");
      return;
    }
    const value = JSON.stringify({ op: milvusOp, ...body }, null, 2);
    const v: Variable = {
      id: `var_${Date.now()}`,
      name,
      type: "dynamic",
      value,
      resolver: `milvus://${selected.id}`,
      source: selected.name,
      description: `Milvus: ${milvusOp}`,
    };
    addVariable(v);
    if (milvusAttach) attachVariableToSelectedNode(v);
    toast.success("已创建变量");
  };

  return (
    <div className="h-full grid grid-cols-3 gap-4 p-4">
      <CreateDataSourceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={created => setItems(prev => [created, ...prev])}
      />
      {importForId && (
        <ImportCsvDialog
          open={Boolean(importForId)}
          onOpenChange={open => setImportForId(open ? importForId : null)}
          dataSourceId={importForId}
        />
      )}
      {browseSqlFor && (
        <SqlBrowserDialog
          open={Boolean(browseSqlFor)}
          onOpenChange={open => setBrowseSqlFor(open ? browseSqlFor : null)}
          dataSourceId={browseSqlFor.id}
          dataSourceName={browseSqlFor.name}
        />
      )}

      <div className="col-span-1 rounded-md border border-border bg-card overflow-hidden flex flex-col">
        <div className="p-3 border-b border-border flex items-center justify-between gap-2">
          <div className="text-xs font-mono font-bold text-primary">
            {t("dataSourceManager.title")}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCreateOpen(true)}
            >
              {t("dataSourceManager.new")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void refresh()}>
              {t("dataSourceManager.refresh")}
            </Button>
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            {items.map(ds => (
              <button
                key={ds.id}
                type="button"
                onClick={() => setSelectedId(ds.id)}
                className={`w-full text-left rounded-md border border-border p-3 transition-colors ${
                  selectedId === ds.id
                    ? "bg-muted"
                    : "bg-background/50 hover:bg-muted/50"
                }`}
              >
                <div className="font-mono text-xs font-bold text-primary">
                  {ds.name}
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {ds.driver} · {ds.id}
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground font-mono">
                  {t("dataSourceManager.resolver")}:{" "}
                  {getResolver(ds.driver, ds.id)}
                </div>
              </button>
            ))}
            {!items.length && !loading && (
              <div className="text-xs text-muted-foreground">
                {t("dataSourceManager.empty")}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="col-span-2 rounded-md border border-border bg-card overflow-hidden flex flex-col">
        {!selected ? (
          <div className="h-full flex items-center justify-center p-6">
            <div className="max-w-md w-full rounded-md border border-border bg-background/50 p-4 space-y-3">
              <div className="text-sm font-semibold">开始使用数据源</div>
              <div className="text-xs text-muted-foreground">
                先创建一个 SQLite/Postgres/MySQL/Milvus
                数据源，然后在详情页里做数据预览与变量生成。
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCreateOpen(true)}
                >
                  {t("dataSourceManager.new")}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <Tabs defaultValue="overview" className="h-full flex flex-col">
            <div className="p-3 border-b border-border flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">
                  {selected.name}
                </div>
                <div className="text-[10px] text-muted-foreground font-mono truncate">
                  {selected.driver} · {selected.id} · updated{" "}
                  {selected.updatedAt}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isSqlDriver(selected.driver) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setBrowseSqlFor({ id: selected.id, name: selected.name })
                    }
                  >
                    {t("sqlBrowser.open")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleTest(selected.id)}
                >
                  {t("dataSourceManager.test")}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => void handleDelete(selected.id)}
                >
                  {t("dataSourceManager.delete")}
                </Button>
              </div>
            </div>

            <div className="p-3 border-b border-border">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                {isSqlDriver(selected.driver) && (
                  <TabsTrigger value="explore">Explore</TabsTrigger>
                )}
                {isSqlDriver(selected.driver) && (
                  <TabsTrigger value="builder">Builder</TabsTrigger>
                )}
                <TabsTrigger value="permissions">Permissions</TabsTrigger>
                {selected.driver === "milvus" && (
                  <TabsTrigger value="milvus">Milvus</TabsTrigger>
                )}
              </TabsList>
            </div>

            <div className="flex-1 overflow-hidden">
              <TabsContent
                value="overview"
                className="h-full m-0 p-4 overflow-auto"
              >
                <div className="space-y-3">
                  <div className="rounded-md border border-border bg-background/50 p-3">
                    <div className="text-xs text-muted-foreground">能力</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {capabilities.map(c => (
                        <span
                          key={c.key}
                          className={`text-[11px] rounded border px-2 py-1 ${
                            c.enabled
                              ? "border-primary/40 text-primary"
                              : "border-border text-muted-foreground"
                          }`}
                        >
                          {c.label}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border border-border bg-background/50 p-3">
                    <div className="text-xs text-muted-foreground">解析器</div>
                    <div className="mt-2 font-mono text-xs break-all">
                      {getResolver(selected.driver, selected.id)}
                    </div>
                  </div>

                  {isSqlDriver(selected.driver) &&
                    Boolean(selected.allowImport) && (
                      <div className="rounded-md border border-border bg-background/50 p-3 flex items-center justify-between">
                        <div>
                          <div className="text-sm">CSV 导入</div>
                          <div className="text-xs text-muted-foreground">
                            将 CSV 导入到指定表（受后端限制与权限开关影响）
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setImportForId(selected.id)}
                        >
                          {t("imports.open")}
                        </Button>
                      </div>
                    )}
                </div>
              </TabsContent>

              {isSqlDriver(selected.driver) && (
                <TabsContent
                  value="explore"
                  className="h-full m-0 p-4 overflow-auto"
                >
                  <div className="space-y-3">
                    <div className="rounded-md border border-border bg-background/50 p-3 space-y-2">
                      <div className="text-xs text-muted-foreground">
                        表数据预览（适用于 sqlite/postgres/mysql）
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2 space-y-1">
                          <div className="text-xs text-muted-foreground">
                            Table
                          </div>
                          <Select
                            value={selectedTable}
                            onValueChange={v => setSelectedTable(v)}
                          >
                            <SelectTrigger className="w-full font-mono">
                              <SelectValue placeholder="table" />
                            </SelectTrigger>
                            <SelectContent>
                              {sqlTables.map(tn => (
                                <SelectItem key={tn} value={tn}>
                                  {tn}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">
                            Limit
                          </div>
                          <Input
                            value={previewLimit}
                            onChange={e => setPreviewLimit(e.target.value)}
                            className="h-9 font-mono text-xs"
                            inputMode="numeric"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handlePreviewRows()}
                          disabled={!selectedTable.trim() || previewLoading}
                        >
                          {previewLoading ? "加载中…" : "预览"}
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-md border border-border bg-background/50 p-3">
                      <div className="text-xs text-muted-foreground">Rows</div>
                      <pre className="mt-2 text-[11px] leading-5 overflow-auto max-h-[420px]">
                        {previewRows
                          ? JSON.stringify(previewRows, null, 2)
                          : "（未加载）"}
                      </pre>
                    </div>
                  </div>
                </TabsContent>
              )}

              {isSqlDriver(selected.driver) && (
                <TabsContent
                  value="builder"
                  className="h-full m-0 p-4 overflow-auto"
                >
                  <div className="space-y-3">
                    <div className="rounded-md border border-border bg-background/50 p-3 space-y-2">
                      <div className="text-xs text-muted-foreground">
                        SQL Builder（只读查询用于预览；变量执行仍以解析器为准）
                      </div>
                      <Textarea
                        value={sqlBuilderQuery}
                        onChange={e => setSqlBuilderQuery(e.target.value)}
                        className="min-h-28 font-mono text-xs"
                      />
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Input
                            value={sqlBuilderVarName}
                            onChange={e => setSqlBuilderVarName(e.target.value)}
                            className="h-9 font-mono text-xs w-56"
                            placeholder="变量名"
                          />
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={sqlBuilderAttach}
                              onCheckedChange={setSqlBuilderAttach}
                            />
                            <div className="text-xs text-muted-foreground">
                              绑定到当前节点
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleRunSqlBuilder()}
                            disabled={
                              sqlBuilderRunning || !sqlBuilderQuery.trim()
                            }
                          >
                            {sqlBuilderRunning ? "运行中…" : "运行"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleCreateSqlVariable()}
                            disabled={
                              !sqlBuilderVarName.trim() ||
                              !sqlBuilderQuery.trim()
                            }
                          >
                            生成变量
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border border-border bg-background/50 p-3">
                      <div className="text-xs text-muted-foreground">结果</div>
                      <pre className="mt-2 text-[11px] leading-5 overflow-auto max-h-[420px]">
                        {sqlBuilderResult
                          ? JSON.stringify(sqlBuilderResult, null, 2)
                          : "（未运行）"}
                      </pre>
                    </div>
                  </div>
                </TabsContent>
              )}

              <TabsContent
                value="permissions"
                className="h-full m-0 p-4 overflow-auto"
              >
                {isSqlDriver(selected.driver) ? (
                  <div className="space-y-3">
                    <div className="rounded-md border border-border bg-background/50 p-3 flex items-center justify-between">
                      <div className="text-sm">
                        {t("dataSourceManager.allowImport")}
                      </div>
                      <Switch
                        checked={Boolean(selected.allowImport)}
                        onCheckedChange={v =>
                          void handleToggle(selected, { allowImport: v })
                        }
                      />
                    </div>
                    <div className="rounded-md border border-border bg-background/50 p-3 flex items-center justify-between">
                      <div className="text-sm">
                        {t("dataSourceManager.allowWrite")}
                      </div>
                      <Switch
                        checked={Boolean(selected.allowWrite)}
                        onCheckedChange={v =>
                          void handleToggle(selected, { allowWrite: v })
                        }
                      />
                    </div>
                    <div className="rounded-md border border-border bg-background/50 p-3 flex items-center justify-between">
                      <div className="text-sm">
                        {t("dataSourceManager.allowSchema")}
                      </div>
                      <Switch
                        checked={Boolean(selected.allowSchema)}
                        onCheckedChange={v =>
                          void handleToggle(selected, { allowSchema: v })
                        }
                      />
                    </div>
                    <div className="rounded-md border border-border bg-background/50 p-3 flex items-center justify-between">
                      <div className="text-sm">
                        {t("dataSourceManager.allowDelete")}
                      </div>
                      <Switch
                        checked={Boolean(selected.allowDelete)}
                        onCheckedChange={v =>
                          void handleToggle(selected, { allowDelete: v })
                        }
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    当前数据源类型暂未提供可视化权限配置
                  </div>
                )}
              </TabsContent>

              {selected.driver === "milvus" && (
                <TabsContent
                  value="milvus"
                  className="h-full m-0 p-4 overflow-auto"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        Collections
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleLoadMilvusCollections()}
                        disabled={milvusLoading}
                      >
                        {milvusLoading ? "加载中…" : "加载"}
                      </Button>
                    </div>
                    <div className="rounded-md border border-border bg-background/50 p-3">
                      <pre className="text-[11px] leading-5 overflow-auto max-h-[420px]">
                        {milvusCollections
                          ? JSON.stringify(milvusCollections, null, 2)
                          : "（未加载）"}
                      </pre>
                    </div>

                    <div className="rounded-md border border-border bg-background/50 p-3 space-y-2">
                      <div className="text-xs text-muted-foreground">
                        Milvus Ops
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">
                            Op
                          </div>
                          <Select
                            value={milvusOp}
                            onValueChange={v =>
                              setMilvusOp(v as "search" | "query" | "insert")
                            }
                          >
                            <SelectTrigger className="w-full font-mono">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="search">search</SelectItem>
                              <SelectItem value="query">query</SelectItem>
                              <SelectItem value="insert">insert</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">
                            变量名
                          </div>
                          <Input
                            value={milvusVarName}
                            onChange={e => setMilvusVarName(e.target.value)}
                            className="h-9 font-mono text-xs"
                          />
                        </div>
                      </div>
                      <Textarea
                        value={milvusBodyText}
                        onChange={e => setMilvusBodyText(e.target.value)}
                        className="min-h-40 font-mono text-xs"
                      />
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={milvusAttach}
                            onCheckedChange={setMilvusAttach}
                          />
                          <div className="text-xs text-muted-foreground">
                            绑定到当前节点
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleRunMilvus()}
                            disabled={milvusRunLoading}
                          >
                            {milvusRunLoading ? "运行中…" : "运行"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleCreateMilvusVariable()}
                            disabled={
                              !milvusVarName.trim() || !milvusBodyText.trim()
                            }
                          >
                            生成变量
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border border-border bg-background/50 p-3">
                      <div className="text-xs text-muted-foreground">结果</div>
                      <pre className="mt-2 text-[11px] leading-5 overflow-auto max-h-[420px]">
                        {milvusRunResult
                          ? JSON.stringify(milvusRunResult, null, 2)
                          : "（未运行）"}
                      </pre>
                    </div>
                  </div>
                </TabsContent>
              )}
            </div>
          </Tabs>
        )}
      </div>
    </div>
  );
}
