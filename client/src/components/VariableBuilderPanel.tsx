import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useStore } from "@/lib/store";
import {
  createVariableLibraryItem,
  testVariable,
  type VariableTestResponse,
} from "@/lib/api/variable-library";
import {
  listDataSources,
  listDataSourceTables,
  listMilvusCollections,
  listNeo4jLabels,
  listTableColumns,
  type DataSource,
} from "@/lib/api/datasources";
import { listSessions, type SessionSummary } from "@/lib/api/sessions";
import { getSuggestionForErrorCode } from "@/lib/errorSuggestions";
import { useTranslation } from "react-i18next";

type Scheme = "sql" | "chat" | "neo4j" | "milvus";

function formatApiError(err: unknown): string {
  if (err && typeof err === "object") {
    const anyErr = err as { message?: unknown; bodyText?: unknown };
    if (typeof anyErr.bodyText === "string" && anyErr.bodyText.trim()) {
      try {
        const json = JSON.parse(anyErr.bodyText) as {
          message?: unknown;
          error?: unknown;
        };
        const msg =
          typeof json.message === "string"
            ? json.message
            : typeof json.error === "string"
              ? json.error
              : null;
        if (msg) return msg;
      } catch {
        return anyErr.bodyText;
      }
    }
    if (typeof anyErr.message === "string") return anyErr.message;
  }
  return "未知错误";
}

export default function VariableBuilderPanel() {
  const { t } = useTranslation();
  const { projectId } = useStore(s => ({ projectId: s.projectId }));
  const [scheme, setScheme] = useState<Scheme>("sql");
  const [name, setName] = useState("var_name");

  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [sqlDsId, setSqlDsId] = useState<string>("");
  const [sqlQuery, setSqlQuery] = useState("SELECT 1 AS value");
  const [sqlTables, setSqlTables] = useState<string[]>([]);
  const [sqlTable, setSqlTable] = useState<string>("");
  const [sqlColumns, setSqlColumns] = useState<string[]>([]);
  const [sqlColumn, setSqlColumn] = useState<string>("");
  const [sqlTablesError, setSqlTablesError] = useState<string | null>(null);
  const [sqlColumnsError, setSqlColumnsError] = useState<string | null>(null);

  const [chatSessionId, setChatSessionId] = useState("");
  const [chatMaxMessages, setChatMaxMessages] = useState(20);

  const [neo4jDsId, setNeo4jDsId] = useState("");
  const [neo4jLabels, setNeo4jLabels] = useState<string[]>([]);
  const [neo4jLabel, setNeo4jLabel] = useState("");
  const [neo4jLabelsError, setNeo4jLabelsError] = useState<string | null>(null);
  const [neo4jCypher, setNeo4jCypher] = useState(
    "MATCH (n) RETURN 1 AS value LIMIT 1"
  );

  const [milvusDsId, setMilvusDsId] = useState("");
  const [milvusCollections, setMilvusCollections] = useState<string[]>([]);
  const [milvusCollection, setMilvusCollection] = useState("");
  const [milvusCollectionsError, setMilvusCollectionsError] = useState<
    string | null
  >(null);
  const [milvusOp, setMilvusOp] = useState("list_collections");
  const [milvusJson, setMilvusJson] = useState(
    JSON.stringify({ op: "list_collections" }, null, 2)
  );
  const [useMilvusJson, setUseMilvusJson] = useState(false);

  const [testResult, setTestResult] = useState<VariableTestResponse | null>(
    null
  );

  const sqlDataSources = useMemo(
    () =>
      dataSources.filter(ds =>
        ["sqlite", "mysql", "postgres"].includes(ds.driver)
      ),
    [dataSources]
  );
  const neo4jDataSources = useMemo(
    () => dataSources.filter(ds => ds.driver === "neo4j"),
    [dataSources]
  );
  const milvusDataSources = useMemo(
    () => dataSources.filter(ds => ds.driver === "milvus"),
    [dataSources]
  );

  const currentResolver = useMemo(() => {
    if (scheme === "sql") return sqlDsId ? `sql://${sqlDsId}` : "";
    if (scheme === "chat")
      return chatSessionId ? `chat://${chatSessionId}` : "";
    if (scheme === "neo4j") return neo4jDsId ? `neo4j://${neo4jDsId}` : "";
    if (scheme === "milvus") return milvusDsId ? `milvus://${milvusDsId}` : "";
    return "";
  }, [scheme, sqlDsId, chatSessionId, neo4jDsId, milvusDsId]);

  const currentValue = useMemo(() => {
    if (scheme === "sql") return sqlQuery;
    if (scheme === "chat") return String(chatMaxMessages);
    if (scheme === "neo4j") return neo4jCypher;
    if (scheme === "milvus") return useMilvusJson ? milvusJson : milvusOp;
    return "";
  }, [
    scheme,
    sqlQuery,
    chatMaxMessages,
    neo4jCypher,
    useMilvusJson,
    milvusJson,
    milvusOp,
  ]);

  const loadCatalog = async () => {
    setIsLoading(true);
    try {
      const [ds, ss] = await Promise.all([listDataSources(), listSessions()]);
      setDataSources(ds);
      setSessions(ss);
      if (!sqlDsId && ds.find(x => x.driver === "sqlite")) {
        setSqlDsId(ds.find(x => x.driver === "sqlite")!.id);
      }
      if (!neo4jDsId && ds.find(x => x.driver === "neo4j")) {
        setNeo4jDsId(ds.find(x => x.driver === "neo4j")!.id);
      }
      if (!milvusDsId && ds.find(x => x.driver === "milvus")) {
        setMilvusDsId(ds.find(x => x.driver === "milvus")!.id);
      }
      if (!chatSessionId && ss[0]?.id) setChatSessionId(ss[0].id);
    } catch {
      toast.error("加载数据源/会话失败");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadCatalog();
  }, []);

  useEffect(() => {
    if (scheme !== "sql") return;
    if (!sqlDsId) return;
    setSqlTables([]);
    setSqlTable("");
    setSqlColumns([]);
    setSqlColumn("");
    setSqlTablesError(null);
    setSqlColumnsError(null);
    void listDataSourceTables({ dataSourceId: sqlDsId })
      .then(res => setSqlTables(res.tables ?? []))
      .catch(err => {
        const msg = formatApiError(err);
        setSqlTablesError(msg);
        toast.error(`加载表失败：${msg}`);
      });
  }, [scheme, sqlDsId]);

  useEffect(() => {
    if (scheme !== "sql") return;
    if (!sqlDsId || !sqlTable) return;
    setSqlColumns([]);
    setSqlColumn("");
    setSqlColumnsError(null);
    void listTableColumns({ dataSourceId: sqlDsId, table: sqlTable })
      .then(res => {
        const cols = (res.columns ?? []).map(c => c.name);
        setSqlColumns(cols);
        const first = cols[0];
        if (first) setSqlColumn(first);
      })
      .catch(err => {
        const msg = formatApiError(err);
        setSqlColumnsError(msg);
        toast.error(`加载列失败：${msg}`);
      });
  }, [scheme, sqlDsId, sqlTable]);

  useEffect(() => {
    if (scheme !== "sql") return;
    if (!sqlTable || !sqlColumn) return;
    setSqlQuery(`SELECT ${sqlColumn} AS value FROM ${sqlTable} LIMIT 1`);
    const safe = sqlTable
      .replaceAll(".", "_")
      .replaceAll("-", "_")
      .replaceAll(" ", "_");
    setName(`${safe}_${sqlColumn}`.toLowerCase());
  }, [scheme, sqlTable, sqlColumn]);

  useEffect(() => {
    if (scheme !== "neo4j") return;
    if (!neo4jDsId) return;
    setNeo4jLabels([]);
    setNeo4jLabel("");
    setNeo4jLabelsError(null);
    void listNeo4jLabels({ dataSourceId: neo4jDsId })
      .then(res => {
        setNeo4jLabels(res.labels ?? []);
        if (res.labels?.[0]) setNeo4jLabel(res.labels[0]);
      })
      .catch(err => {
        const msg = formatApiError(err);
        setNeo4jLabelsError(msg);
        toast.error(`加载 Neo4j Labels 失败：${msg}`);
      });
  }, [scheme, neo4jDsId]);

  useEffect(() => {
    if (scheme !== "neo4j") return;
    if (!neo4jLabel) return;
    setNeo4jCypher(`MATCH (n:${neo4jLabel}) RETURN n AS value LIMIT 1`);
    setName(`${neo4jLabel}`.toLowerCase());
  }, [scheme, neo4jLabel]);

  useEffect(() => {
    if (scheme !== "milvus") return;
    if (!milvusDsId) return;
    setMilvusCollections([]);
    setMilvusCollection("");
    setMilvusCollectionsError(null);
    void listMilvusCollections({ dataSourceId: milvusDsId })
      .then(res => {
        setMilvusCollections(res.collections ?? []);
        if (res.collections?.[0]) setMilvusCollection(res.collections[0]);
      })
      .catch(err => {
        const msg = formatApiError(err);
        setMilvusCollectionsError(msg);
        toast.error(`加载 Milvus Collections 失败：${msg}`);
      });
  }, [scheme, milvusDsId]);

  useEffect(() => {
    if (scheme !== "milvus") return;
    if (!milvusCollection) return;
    setName(`${milvusCollection}`.toLowerCase());
  }, [scheme, milvusCollection]);

  const handleTest = async () => {
    if (!projectId) return;
    const n = name.trim();
    if (!n) return;
    if (!currentResolver.trim()) {
      toast.error("请先选择 resolver");
      return;
    }
    setIsLoading(true);
    try {
      const res = await testVariable(projectId, {
        id: `test_${Date.now()}`,
        name: n,
        type: "dynamic",
        value: currentValue,
        resolver: currentResolver,
      });
      setTestResult(res);
      toast.success(res.ok ? "测试成功" : "测试失败（已回退）");
    } catch {
      setTestResult(null);
      toast.error("测试请求失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!projectId) return;
    const n = name.trim();
    if (!n) return;
    if (!currentResolver.trim()) {
      toast.error("请先选择 resolver");
      return;
    }
    setIsLoading(true);
    try {
      await createVariableLibraryItem(projectId, {
        name: n,
        type: "dynamic",
        value: currentValue,
        resolver: currentResolver,
        tags: [],
      });
      toast.success("已保存到变量库");
    } catch {
      toast.error("保存失败");
    } finally {
      setIsLoading(false);
    }
  };

  if (!projectId) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        需要先选择/创建一个项目，才能使用抽取器 Builder。
      </div>
    );
  }

  return (
    <div className="h-full grid grid-cols-2 gap-4 overflow-hidden">
      <ScrollArea className="h-full border border-border rounded-md">
        <div className="p-4 space-y-4">
          <div className="text-xs font-mono font-bold text-primary">
            抽取器 Builder
          </div>

          <div className="grid gap-2">
            <div className="text-[10px] text-muted-foreground">变量名</div>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              name="variableName"
              autoComplete="off"
            />
          </div>

          <div className="grid gap-2">
            <div className="text-[10px] text-muted-foreground">类型</div>
            <div className="grid grid-cols-4 gap-2">
              {(["sql", "chat", "neo4j", "milvus"] as Scheme[]).map(s => (
                <Button
                  key={s}
                  variant={scheme === s ? "default" : "outline"}
                  onClick={() => setScheme(s)}
                >
                  {s.toUpperCase()}
                </Button>
              ))}
            </div>
          </div>

          {scheme === "sql" && (
            <div className="space-y-3">
              <div className="grid gap-2">
                <div className="text-[10px] text-muted-foreground">数据源</div>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={sqlDsId}
                  onChange={e => setSqlDsId(e.target.value)}
                  name="sqlDataSourceId"
                >
                  <option value="">请选择</option>
                  {sqlDataSources.map(ds => (
                    <option key={ds.id} value={ds.id}>
                      {ds.name} ({ds.driver})
                    </option>
                  ))}
                </select>
                {sqlTablesError && (
                  <div className="text-[10px] text-destructive">
                    表列表加载失败：{sqlTablesError}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <div className="text-[10px] text-muted-foreground">表</div>
                  <select
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={sqlTable}
                    onChange={e => setSqlTable(e.target.value)}
                    name="sqlTable"
                  >
                    <option value="">选择表</option>
                    {sqlTables.map(t => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <div className="text-[10px] text-muted-foreground">列</div>
                  <select
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={sqlColumn}
                    onChange={e => setSqlColumn(e.target.value)}
                    name="sqlColumn"
                  >
                    <option value="">选择列</option>
                    {sqlColumns.map(c => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {sqlColumnsError && (
                    <div className="text-[10px] text-destructive">
                      列加载失败：{sqlColumnsError}
                    </div>
                  )}
                </div>
              </div>
              <div className="grid gap-2">
                <div className="text-[10px] text-muted-foreground">
                  SQL（只读）
                </div>
                <Textarea
                  value={sqlQuery}
                  onChange={e => setSqlQuery(e.target.value)}
                  rows={6}
                />
              </div>
            </div>
          )}

          {scheme === "chat" && (
            <div className="space-y-3">
              <div className="grid gap-2">
                <div className="text-[10px] text-muted-foreground">会话</div>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={chatSessionId}
                  onChange={e => setChatSessionId(e.target.value)}
                  name="chatSessionId"
                >
                  <option value="">请选择</option>
                  {sessions.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <div className="text-[10px] text-muted-foreground">
                  最大消息数
                </div>
                <Input
                  value={String(chatMaxMessages)}
                  onChange={e =>
                    setChatMaxMessages(Number(e.target.value) || 0)
                  }
                  name="chatMaxMessages"
                  autoComplete="off"
                />
              </div>
            </div>
          )}

          {scheme === "neo4j" && (
            <div className="space-y-3">
              <div className="grid gap-2">
                <div className="text-[10px] text-muted-foreground">数据源</div>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={neo4jDsId}
                  onChange={e => setNeo4jDsId(e.target.value)}
                  name="neo4jDataSourceId"
                >
                  <option value="">请选择</option>
                  {neo4jDataSources.map(ds => (
                    <option key={ds.id} value={ds.id}>
                      {ds.name}
                    </option>
                  ))}
                </select>
                {neo4jLabelsError && (
                  <div className="text-[10px] text-destructive">
                    Labels 加载失败：{neo4jLabelsError}
                  </div>
                )}
              </div>
              <div className="grid gap-2">
                <div className="text-[10px] text-muted-foreground">Label</div>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={neo4jLabel}
                  onChange={e => setNeo4jLabel(e.target.value)}
                  name="neo4jLabel"
                >
                  <option value="">选择 label</option>
                  {neo4jLabels.map(l => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <div className="text-[10px] text-muted-foreground">Cypher</div>
                <Textarea
                  value={neo4jCypher}
                  onChange={e => setNeo4jCypher(e.target.value)}
                  rows={6}
                />
              </div>
            </div>
          )}

          {scheme === "milvus" && (
            <div className="space-y-3">
              <div className="grid gap-2">
                <div className="text-[10px] text-muted-foreground">数据源</div>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={milvusDsId}
                  onChange={e => setMilvusDsId(e.target.value)}
                  name="milvusDataSourceId"
                >
                  <option value="">请选择</option>
                  {milvusDataSources.map(ds => (
                    <option key={ds.id} value={ds.id}>
                      {ds.name}
                    </option>
                  ))}
                </select>
                {milvusCollectionsError && (
                  <div className="text-[10px] text-destructive">
                    Collections 加载失败：{milvusCollectionsError}
                  </div>
                )}
              </div>
              <div className="grid gap-2">
                <div className="text-[10px] text-muted-foreground">
                  Collection（浏览）
                </div>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={milvusCollection}
                  onChange={e => setMilvusCollection(e.target.value)}
                  name="milvusCollection"
                >
                  <option value="">选择 collection</option>
                  {milvusCollections.map(c => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <div className="text-[10px] text-muted-foreground">操作</div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant={!useMilvusJson ? "default" : "outline"}
                    onClick={() => setUseMilvusJson(false)}
                  >
                    简单模式
                  </Button>
                  <Button
                    variant={useMilvusJson ? "default" : "outline"}
                    onClick={() => setUseMilvusJson(true)}
                  >
                    JSON 模式
                  </Button>
                </div>
              </div>
              {!useMilvusJson ? (
                <div className="grid gap-2">
                  <div className="text-[10px] text-muted-foreground">op</div>
                  <Input
                    value={milvusOp}
                    onChange={e => setMilvusOp(e.target.value)}
                    name="milvusOp"
                    autoComplete="off"
                  />
                </div>
              ) : (
                <div className="grid gap-2">
                  <div className="text-[10px] text-muted-foreground">JSON</div>
                  <Textarea
                    value={milvusJson}
                    onChange={e => setMilvusJson(e.target.value)}
                    rows={8}
                    name="milvusJson"
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => void loadCatalog()}
              disabled={isLoading}
            >
              刷新资源
            </Button>
            <Button onClick={() => void handleTest()} disabled={isLoading}>
              一键测试
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleSave()}
              disabled={isLoading}
            >
              保存到变量库
            </Button>
          </div>

          <div className="rounded-md border border-border p-3 bg-background/50">
            <div className="text-[10px] text-muted-foreground">Resolver</div>
            <div className="text-xs font-mono break-all">
              {currentResolver || "-"}
            </div>
          </div>
        </div>
      </ScrollArea>

      <ScrollArea className="h-full border border-border rounded-md">
        <div className="p-4 space-y-4">
          <div className="text-xs font-mono font-bold text-primary">
            测试结果
          </div>
          {!testResult ? (
            <div className="text-sm text-muted-foreground">尚未测试</div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md border border-border p-3">
                <div className="text-[10px] text-muted-foreground">value</div>
                <pre className="mt-2 text-xs font-mono whitespace-pre-wrap">
                  {testResult.value}
                </pre>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-[10px] text-muted-foreground">trace</div>
                <div className="mt-2 text-xs font-mono">
                  [{testResult.trace.severity}] {testResult.trace.code}:{" "}
                  {testResult.trace.message}
                </div>
                {(() => {
                  const details =
                    testResult.trace.details &&
                    typeof testResult.trace.details === "object"
                      ? (testResult.trace.details as any)
                      : null;
                  const errorCode =
                    details && typeof details.errorCode === "string"
                      ? details.errorCode
                      : null;
                  const suggestion = getSuggestionForErrorCode(errorCode, t);
                  return suggestion ? (
                    <div className="mt-2 text-xs text-primary">
                      {t("preview.suggestion")}
                      {suggestion}
                    </div>
                  ) : null;
                })()}
                <pre className="mt-2 text-[10px] text-muted-foreground whitespace-pre-wrap">
                  {JSON.stringify(testResult.trace.details ?? null, null, 2)}
                </pre>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-[10px] text-muted-foreground">debug</div>
                <pre className="mt-2 text-[10px] text-muted-foreground whitespace-pre-wrap">
                  {JSON.stringify(testResult.debug ?? null, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
