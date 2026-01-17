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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createDataSource,
  createLocalSqliteDataSource,
  createSqliteTable,
  listDataSourceTables,
  listDataSources,
  listSqliteTableRows,
  listTableColumns,
  type ColumnInfo,
  type DataSource,
} from "@/lib/api/datasources";
import { sqlQuery } from "@/lib/api/sql";
import { useStore } from "@/lib/store";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/lib/api/types";

export default function DatabaseWorkbench() {
  const { t } = useTranslation();
  const addVariable = useStore(s => s.addVariable);

  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(false);

  const [createLocalOpen, setCreateLocalOpen] = useState(false);
  const [createExternalOpen, setCreateExternalOpen] = useState(false);

  const [selectedDataSourceId, setSelectedDataSourceId] = useState<string>("");
  const selectedDataSource = useMemo(
    () => dataSources.find(ds => ds.id === selectedDataSourceId) ?? null,
    [dataSources, selectedDataSourceId]
  );

  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);

  const [qbValueColumn, setQbValueColumn] = useState<string>("");
  const [qbWhereColumn, setQbWhereColumn] = useState<string>("");
  const [qbWhereValue, setQbWhereValue] = useState<string>("");
  const [qbLimit, setQbLimit] = useState<number>(10);
  const [qbPreview, setQbPreview] = useState<Record<string, unknown>[]>([]);

  const refreshDataSources = async () => {
    setLoading(true);
    try {
      const list = await listDataSources();
      setDataSources(list);
      if (!selectedDataSourceId && list[0]?.id) {
        setSelectedDataSourceId(list[0].id);
      }
    } catch {
      toast.error(t("dataSourceManager.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshDataSources();
  }, []);

  useEffect(() => {
    const ds = selectedDataSource;
    if (!ds) return;
    setTables([]);
    setSelectedTable("");
    setColumns([]);
    setRows([]);
    setQbPreview([]);
    void (async () => {
      try {
        const res = await listDataSourceTables({ dataSourceId: ds.id });
        setTables(res.tables);
        if (res.tables[0]) setSelectedTable(res.tables[0]);
      } catch {
        toast.error(t("dataSourceManager.loadFailed"));
      }
    })();
  }, [selectedDataSource?.id, t]);

  useEffect(() => {
    const ds = selectedDataSource;
    if (!ds || !selectedTable) return;
    setColumns([]);
    setRows([]);
    void (async () => {
      try {
        const res = await listTableColumns({
          dataSourceId: ds.id,
          table: selectedTable,
        });
        setColumns(res.columns);
        if (!qbValueColumn && res.columns[0]?.name) {
          setQbValueColumn(res.columns[0].name);
        }
      } catch {
        toast.error(t("sqlBrowser.loadColumnsFailed"));
      }
    })();
    if (ds.driver !== "sqlite") return;
    void (async () => {
      try {
        const res = await listSqliteTableRows({
          dataSourceId: ds.id,
          table: selectedTable,
          limit: 50,
          offset: 0,
        });
        setRows(res.rows);
      } catch {
        setRows([]);
      }
    })();
  }, [
    qbValueColumn,
    selectedDataSource?.driver,
    selectedDataSource?.id,
    selectedTable,
    t,
  ]);

  const headerCards = (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="text-sm font-semibold">{t("database.localTitle")}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {t("database.localDesc")}
        </div>
        <div className="mt-3 flex gap-2">
          <Button onClick={() => setCreateLocalOpen(true)}>
            {t("database.createLocal")}
          </Button>
          <Button variant="outline" onClick={() => void refreshDataSources()}>
            {t("dataSourceManager.refresh")}
          </Button>
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="text-sm font-semibold">
          {t("database.externalTitle")}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {t("database.externalDesc")}
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" onClick={() => setCreateExternalOpen(true)}>
            {t("database.createExternal")}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <WorkbenchLayout title={t("workbench.database")}>
      <Dialog open={createLocalOpen} onOpenChange={setCreateLocalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("database.createLocal")}</DialogTitle>
            <DialogDescription>
              {t("database.createLocalHint")}
            </DialogDescription>
          </DialogHeader>
          <CreateLocalDbForm
            onCancel={() => setCreateLocalOpen(false)}
            onCreated={async (ds, template) => {
              await refreshDataSources();
              setSelectedDataSourceId(ds.id);
              setCreateLocalOpen(false);

              if (template === "empty") return;
              try {
                if (template === "documents") {
                  await createSqliteTable({
                    dataSourceId: ds.id,
                    table: "documents",
                    columns: [
                      { name: "id", dataType: "TEXT" },
                      { name: "title", dataType: "TEXT" },
                      { name: "content", dataType: "TEXT" },
                      { name: "created_at", dataType: "TEXT" },
                    ],
                  });
                }
                if (template === "kv") {
                  await createSqliteTable({
                    dataSourceId: ds.id,
                    table: "kv",
                    columns: [
                      { name: "key", dataType: "TEXT" },
                      { name: "value", dataType: "TEXT" },
                    ],
                  });
                }
                toast.success(t("database.templateCreated"));
              } catch {
                toast.error(t("database.templateCreateFailed"));
              }
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={createExternalOpen} onOpenChange={setCreateExternalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("database.createExternal")}</DialogTitle>
            <DialogDescription>
              {t("database.createExternalHint")}
            </DialogDescription>
          </DialogHeader>
          <CreateExternalDbForm
            onCancel={() => setCreateExternalOpen(false)}
            onCreated={async ds => {
              await refreshDataSources();
              setSelectedDataSourceId(ds.id);
              setCreateExternalOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>

      <div className="h-full p-4 flex flex-col gap-4">
        {headerCards}

        <div className="flex-1 grid gap-4 lg:grid-cols-[360px_1fr] overflow-hidden">
          <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="text-sm font-semibold">
                {t("database.catalog")}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refreshDataSources()}
                disabled={loading}
              >
                {t("dataSourceManager.refresh")}
              </Button>
            </div>
            <div className="p-4 border-b border-border">
              <Label className="text-xs text-muted-foreground">
                {t("database.dataSource")}
              </Label>
              <Select
                value={selectedDataSourceId}
                onValueChange={setSelectedDataSourceId}
              >
                <SelectTrigger size="sm" className="mt-2 w-full font-mono">
                  <SelectValue placeholder={t("database.selectDataSource")} />
                </SelectTrigger>
                <SelectContent>
                  {dataSources.map(ds => (
                    <SelectItem key={ds.id} value={ds.id}>
                      {ds.name} · {ds.driver}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="mt-2 text-[11px] text-muted-foreground font-mono">
                {selectedDataSource ? `sql://${selectedDataSource.id}` : ""}
              </div>
            </div>

            <div className="flex-1 overflow-hidden">
              <ScrollArea className="h-full p-4">
                <div className="text-xs font-semibold text-muted-foreground">
                  {t("database.tables")}
                </div>
                {tables.length === 0 ? (
                  <div className="mt-2 text-xs text-muted-foreground">
                    {t("database.noTables")}
                  </div>
                ) : (
                  <div className="mt-2 grid gap-2">
                    {tables.map(tb => (
                      <Button
                        key={tb}
                        variant={tb === selectedTable ? "secondary" : "outline"}
                        className="justify-start font-mono text-xs h-8"
                        onClick={() => setSelectedTable(tb)}
                      >
                        {tb}
                      </Button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">
                  {selectedTable || t("database.noSelection")}
                </div>
                {selectedDataSource?.driver !== "sqlite" && selectedTable ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t("database.rowsOnlySqlite")}
                  </div>
                ) : null}
              </div>
            </div>

            <Tabs defaultValue="browse" className="flex-1 flex flex-col">
              <div className="px-4 pt-2">
                <TabsList className="w-full grid grid-cols-2">
                  <TabsTrigger value="browse">
                    {t("database.browse")}
                  </TabsTrigger>
                  <TabsTrigger value="query">
                    {t("database.queryBuilder")}
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="browse" className="flex-1 overflow-hidden">
                <ScrollArea className="h-full p-4">
                  <div className="text-xs font-semibold text-muted-foreground">
                    {t("database.columns")}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {columns.map(c => (
                      <div
                        key={c.name}
                        className="rounded border border-border bg-background/50 px-2 py-1 text-[11px] font-mono"
                      >
                        {c.name}:{c.dataType}
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 text-xs font-semibold text-muted-foreground">
                    {t("database.rows")}
                  </div>
                  {rows.length === 0 ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {t("database.noRows")}
                    </div>
                  ) : (
                    <pre className="mt-2 rounded-md border border-border bg-background/50 p-3 text-[11px] font-mono overflow-auto">
                      {JSON.stringify(rows.slice(0, 50), null, 2)}
                    </pre>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="query" className="flex-1 overflow-hidden">
                <ScrollArea className="h-full p-4">
                  <div className="grid gap-3">
                    <div className="grid gap-2">
                      <Label className="text-xs text-muted-foreground">
                        {t("database.valueColumn")}
                      </Label>
                      <Select
                        value={qbValueColumn}
                        onValueChange={setQbValueColumn}
                      >
                        <SelectTrigger size="sm" className="w-full font-mono">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {columns.map(c => (
                            <SelectItem key={c.name} value={c.name}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-2">
                      <Label className="text-xs text-muted-foreground">
                        {t("database.where")}
                      </Label>
                      <div className="grid grid-cols-2 gap-2">
                        <Select
                          value={qbWhereColumn}
                          onValueChange={setQbWhereColumn}
                        >
                          <SelectTrigger size="sm" className="w-full font-mono">
                            <SelectValue
                              placeholder={t("database.whereColumn")}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">
                              {t("database.noWhere")}
                            </SelectItem>
                            {columns.map(c => (
                              <SelectItem key={c.name} value={c.name}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          className="h-9 font-mono text-xs"
                          value={qbWhereValue}
                          onChange={e => setQbWhereValue(e.target.value)}
                          placeholder={t("database.whereValue")}
                        />
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Label className="text-xs text-muted-foreground">
                        {t("database.limit")}
                      </Label>
                      <Input
                        type="number"
                        className="h-9 font-mono text-xs"
                        value={qbLimit}
                        min={1}
                        max={1000}
                        onChange={e =>
                          setQbLimit(
                            Math.max(
                              1,
                              Math.min(1000, Number(e.target.value || 10))
                            )
                          )
                        }
                      />
                    </div>

                    <div className="rounded-md border border-border bg-background/50 p-3">
                      <div className="text-xs font-semibold text-muted-foreground">
                        {t("database.generatedSql")}
                      </div>
                      <pre className="mt-2 text-[11px] font-mono whitespace-pre-wrap">
                        {buildSql({
                          table: selectedTable,
                          valueColumn: qbValueColumn,
                          whereColumn: qbWhereColumn,
                          whereValue: qbWhereValue,
                          limit: qbLimit,
                        })}
                      </pre>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        disabled={
                          !selectedDataSource ||
                          !selectedTable ||
                          !qbValueColumn
                        }
                        onClick={async () => {
                          const ds = selectedDataSource;
                          if (!ds) return;
                          const query = buildSql({
                            table: selectedTable,
                            valueColumn: qbValueColumn,
                            whereColumn: qbWhereColumn,
                            whereValue: qbWhereValue,
                            limit: qbLimit,
                          });
                          try {
                            const res = await sqlQuery({
                              dataSourceId: ds.id,
                              query,
                              rowLimit: Math.min(1000, qbLimit),
                            });
                            setQbPreview(res.rows);
                            toast.success(t("database.previewOk"));
                          } catch {
                            setQbPreview([]);
                            toast.error(t("database.previewFailed"));
                          }
                        }}
                      >
                        {t("database.preview")}
                      </Button>

                      <Button
                        disabled={
                          !selectedDataSource ||
                          !selectedTable ||
                          !qbValueColumn
                        }
                        onClick={() => {
                          const ds = selectedDataSource;
                          if (!ds) return;
                          const query = buildSql({
                            table: selectedTable,
                            valueColumn: qbValueColumn,
                            whereColumn: qbWhereColumn,
                            whereValue: qbWhereValue,
                            limit: qbLimit,
                          });
                          const id = `dbvar_${Date.now()}`;
                          addVariable({
                            id,
                            name: `${selectedTable}_${qbValueColumn}`,
                            type: "dynamic",
                            value: query,
                            description: t("database.variableDesc", {
                              table: selectedTable,
                            }),
                            source: "database",
                            resolver: `sql://${ds.id}`,
                          });
                          toast.success(t("database.variableCreated"));
                          window.location.href = `/workbench/variables?varId=${encodeURIComponent(
                            id
                          )}`;
                        }}
                      >
                        {t("database.createVariable")}
                      </Button>
                    </div>

                    {qbPreview.length > 0 ? (
                      <pre className="rounded-md border border-border bg-background/50 p-3 text-[11px] font-mono overflow-auto">
                        {JSON.stringify(qbPreview.slice(0, 50), null, 2)}
                      </pre>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        {t("database.previewEmpty")}
                      </div>
                    )}
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

function buildSql(input: {
  table: string;
  valueColumn: string;
  whereColumn: string;
  whereValue: string;
  limit: number;
}) {
  const table = input.table ? `"${input.table.replaceAll('"', '""')}"` : "";
  const col = input.valueColumn
    ? `"${input.valueColumn.replaceAll('"', '""')}"`
    : "*";
  const limit = Number.isFinite(input.limit) ? Math.max(1, input.limit) : 10;

  if (!table) return "";

  if (input.whereColumn) {
    const whereCol = `"${input.whereColumn.replaceAll('"', '""')}"`;
    const val = input.whereValue.replaceAll("'", "''");
    return `SELECT ${col} FROM ${table} WHERE ${whereCol}='${val}' LIMIT ${limit};`;
  }
  return `SELECT ${col} FROM ${table} LIMIT ${limit};`;
}

function CreateLocalDbForm(props: {
  onCancel: () => void;
  onCreated: (ds: DataSource, template: "empty" | "documents" | "kv") => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<"empty" | "documents" | "kv">(
    "documents"
  );
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label className="text-xs text-muted-foreground">
          {t("database.dbName")}
        </Label>
        <Input
          className="h-9 font-mono text-xs"
          value={name}
          onChange={e => setName(e.target.value)}
          autoComplete="off"
          placeholder={t("database.dbNamePlaceholder")}
        />
      </div>
      <div className="grid gap-2">
        <Label className="text-xs text-muted-foreground">
          {t("database.template")}
        </Label>
        <Select
          value={template}
          onValueChange={v => setTemplate(v as typeof template)}
        >
          <SelectTrigger size="sm" className="w-full font-mono">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="documents">
              {t("database.templateDocuments")}
            </SelectItem>
            <SelectItem value="kv">{t("database.templateKv")}</SelectItem>
            <SelectItem value="empty">{t("database.templateEmpty")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={props.onCancel}
          disabled={submitting}
        >
          {t("database.cancel")}
        </Button>
        <Button
          disabled={submitting || !name.trim()}
          onClick={async () => {
            setSubmitting(true);
            try {
              const ds = await createLocalSqliteDataSource({
                name: name.trim(),
              });
              toast.success(t("dataSourceManager.created"));
              props.onCreated(ds, template);
            } catch (e) {
              const msg =
                getApiErrorMessage(e) ?? t("dataSourceManager.createFailed");
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
  );
}

function CreateExternalDbForm(props: {
  onCancel: () => void;
  onCreated: (ds: DataSource) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [driver, setDriver] = useState<"postgres" | "mysql">("postgres");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
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
          {t("dataSourceManager.driver")}
        </Label>
        <Select
          value={driver}
          onValueChange={v => setDriver(v as typeof driver)}
        >
          <SelectTrigger size="sm" className="w-full font-mono">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="postgres">postgres</SelectItem>
            <SelectItem value="mysql">mysql</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label className="text-xs text-muted-foreground">
          {t("dataSourceManager.url")}
        </Label>
        <Input
          className="h-9 font-mono text-xs"
          value={url}
          onChange={e => setUrl(e.target.value)}
          autoComplete="off"
          placeholder={
            driver === "postgres"
              ? "postgres://user:pass@localhost:5432/db"
              : "mysql://user:pass@localhost:3306/db"
          }
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={props.onCancel}
          disabled={submitting}
        >
          {t("database.cancel")}
        </Button>
        <Button
          disabled={submitting || !name.trim() || !url.trim()}
          onClick={async () => {
            setSubmitting(true);
            try {
              const ds = await createDataSource({
                name: name.trim(),
                driver,
                url: url.trim(),
                allowImport: false,
                allowWrite: false,
                allowSchema: false,
                allowDelete: false,
              });
              toast.success(t("dataSourceManager.created"));
              props.onCreated(ds);
            } catch (e) {
              const msg =
                getApiErrorMessage(e) ?? t("dataSourceManager.createFailed");
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
  );
}
