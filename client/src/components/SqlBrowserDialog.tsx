import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { shallow } from "zustand/shallow";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/lib/store";
import type { Variable } from "@/lib/types";
import {
  createSqliteTable,
  deleteSqliteTableRow,
  insertSqliteTableRow,
  listDataSourceTables,
  listSqliteTableRows,
  listTableColumns,
  type ColumnInfo,
  type SqliteRow,
} from "@/lib/api/datasources";
import { sqlQuery, type SqlQueryResponse } from "@/lib/api/sql";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataSourceId: string;
  dataSourceName: string;
};

export function SqlBrowserDialog(props: Props) {
  const { t } = useTranslation();
  const { open, onOpenChange, dataSourceId, dataSourceName } = props;
  const { addVariable, selectedNodeId, updateNodeData, nodes } = useStore(
    s => ({
      addVariable: s.addVariable,
      selectedNodeId: s.selectedNodeId,
      updateNodeData: s.updateNodeData,
      nodes: s.nodes,
    }),
    shallow
  );

  const [isLoading, setIsLoading] = useState(false);
  const [tables, setTables] = useState<string[]>([]);
  const [tableFilter, setTableFilter] = useState("");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);

  const [query, setQuery] = useState("");
  const [rowLimit, setRowLimit] = useState(10);
  const [queryResult, setQueryResult] = useState<SqlQueryResponse | null>(null);
  const [runningQuery, setRunningQuery] = useState(false);

  const [varName, setVarName] = useState("");
  const [attachToSelectedNode, setAttachToSelectedNode] = useState(true);
  const [tableRows, setTableRows] = useState<SqliteRow[] | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTables([]);
    setSelectedTable(null);
    setColumns([]);
    setQuery("");
    setQueryResult(null);
    setVarName("");
    setAttachToSelectedNode(true);
    setTableRows(null);
    setTableFilter("");

    setIsLoading(true);
    listDataSourceTables({ dataSourceId })
      .then(res => setTables(res.tables ?? []))
      .catch(() => toast.error(t("sqlBrowser.loadTablesFailed")))
      .finally(() => setIsLoading(false));
  }, [open, dataSourceId, t]);

  useEffect(() => {
    if (!open) return;
    if (!selectedTable) return;
    setColumns([]);
    setQueryResult(null);
    setTableRows(null);
    setIsLoading(true);
    listTableColumns({ dataSourceId, table: selectedTable })
      .then(res => {
        setColumns(res.columns ?? []);
        const first = (res.columns ?? [])[0]?.name;
        const defaultQuery = first
          ? `SELECT ${first} AS value FROM ${selectedTable} LIMIT 1`
          : `SELECT * FROM ${selectedTable} LIMIT 10`;
        setQuery(defaultQuery);
        const safeVarName = selectedTable
          .replaceAll(".", "_")
          .replaceAll("-", "_")
          .replaceAll(" ", "_");
        setVarName(`${safeVarName}_value`);
      })
      .catch(() => toast.error(t("sqlBrowser.loadColumnsFailed")))
      .finally(() => setIsLoading(false));
  }, [open, selectedTable, dataSourceId, t]);

  const filteredTables = useMemo(() => {
    const f = tableFilter.trim().toLowerCase();
    if (!f) return tables;
    return tables.filter(x => x.toLowerCase().includes(f));
  }, [tables, tableFilter]);

  const handleRun = async () => {
    const q = query.trim();
    if (!q) return;
    setRunningQuery(true);
    try {
      const res = await sqlQuery({
        dataSourceId,
        query: q,
        rowLimit,
      });
      setQueryResult(res);
      toast.success(t("sqlBrowser.queryOk"));
    } catch {
      setQueryResult(null);
      toast.error(t("sqlBrowser.queryFailed"));
    } finally {
      setRunningQuery(false);
    }
  };

  const handleCreateTable = async () => {
    const table = window.prompt(t("sqlBrowser.createTablePrompt"));
    if (!table) return;
    const colsText = window.prompt(
      t("sqlBrowser.createTableColumnsPrompt"),
      JSON.stringify(
        [{ name: "id", dataType: "INTEGER", nullable: false }],
        null,
        2
      )
    );
    if (!colsText) return;
    let cols: { name: string; dataType: string; nullable?: boolean }[] = [];
    try {
      cols = JSON.parse(colsText);
    } catch {
      toast.error(t("sqlBrowser.invalidJson"));
      return;
    }
    try {
      await createSqliteTable({ dataSourceId, table, columns: cols });
      toast.success(t("sqlBrowser.tableCreated"));
      const res = await listDataSourceTables({ dataSourceId });
      setTables(res.tables ?? []);
      setSelectedTable(table);
    } catch {
      toast.error(t("sqlBrowser.tableCreateFailed"));
    }
  };

  const handleLoadRows = async () => {
    if (!selectedTable) return;
    setLoadingRows(true);
    try {
      const res = await listSqliteTableRows({
        dataSourceId,
        table: selectedTable,
        limit: 50,
        offset: 0,
      });
      setTableRows(res.rows);
      toast.success(t("sqlBrowser.rowsLoaded"));
    } catch {
      setTableRows(null);
      toast.error(t("sqlBrowser.rowsLoadFailed"));
    } finally {
      setLoadingRows(false);
    }
  };

  const handleInsertRow = async () => {
    if (!selectedTable) return;
    const text = window.prompt(
      t("sqlBrowser.insertRowPrompt"),
      '{"name":"Alice"}'
    );
    if (!text) return;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(text);
    } catch {
      toast.error(t("sqlBrowser.invalidJson"));
      return;
    }
    try {
      await insertSqliteTableRow({ dataSourceId, table: selectedTable, row });
      toast.success(t("sqlBrowser.rowInserted"));
      await handleLoadRows();
    } catch {
      toast.error(t("sqlBrowser.rowInsertFailed"));
    }
  };

  const handleDeleteRow = async () => {
    if (!selectedTable) return;
    const text = window.prompt(t("sqlBrowser.deleteRowPrompt"), "1");
    if (!text) return;
    const rowId = Number(text);
    if (!Number.isFinite(rowId)) {
      toast.error(t("sqlBrowser.invalidNumber"));
      return;
    }
    try {
      await deleteSqliteTableRow({ dataSourceId, table: selectedTable, rowId });
      toast.success(t("sqlBrowser.rowDeleted"));
      await handleLoadRows();
    } catch {
      toast.error(t("sqlBrowser.rowDeleteFailed"));
    }
  };

  const handleCreateVariable = () => {
    const name = varName.trim();
    const q = query.trim();
    if (!name || !q) return;

    const v: Variable = {
      id: `var_${Date.now()}`,
      name,
      type: "dynamic",
      value: q,
      resolver: `sql://${dataSourceId}`,
      source: dataSourceName,
      description: t("sqlBrowser.varDesc", { table: selectedTable ?? "" }),
    };
    addVariable(v);
    if (attachToSelectedNode && selectedNodeId) {
      const current = nodes.find(n => n.id === selectedNodeId);
      const currentVars = current?.data?.variables ?? [];
      const nextVars = currentVars.includes(v.id)
        ? currentVars
        : [...currentVars, v.id];
      updateNodeData(selectedNodeId, {
        variables: nextVars,
      });
    }
    toast.success(t("sqlBrowser.variableCreated"));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {t("sqlBrowser.title", { name: dataSourceName })}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-1 space-y-2">
            <div className="text-xs text-muted-foreground">
              {t("sqlBrowser.tables")}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleCreateTable()}
            >
              {t("sqlBrowser.createTable")}
            </Button>
            <Input
              value={tableFilter}
              onChange={e => setTableFilter(e.target.value)}
              placeholder={t("sqlBrowser.searchTables")}
              className="h-9"
            />
            <ScrollArea className="h-[420px] rounded-md border border-border">
              <div className="p-2 space-y-1">
                {filteredTables.length === 0 ? (
                  <div className="text-xs text-muted-foreground p-2">
                    {isLoading
                      ? t("sqlBrowser.loading")
                      : t("sqlBrowser.emptyTables")}
                  </div>
                ) : (
                  filteredTables.map(tn => (
                    <button
                      key={tn}
                      type="button"
                      onClick={() => setSelectedTable(tn)}
                      className={`w-full text-left rounded-md border border-border px-3 py-2 transition-colors ${
                        selectedTable === tn
                          ? "bg-muted"
                          : "bg-background/50 hover:bg-muted/50"
                      }`}
                    >
                      <div className="text-sm font-medium truncate">{tn}</div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {t("sqlBrowser.columns")}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={String(rowLimit)}
                  onChange={e => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n))
                      setRowLimit(Math.max(1, Math.min(1000, n)));
                  }}
                  className="h-9 w-24 font-mono"
                />
                <Button
                  onClick={() => void handleRun()}
                  disabled={runningQuery || !query.trim()}
                >
                  {runningQuery ? t("sqlBrowser.running") : t("sqlBrowser.run")}
                </Button>
              </div>
            </div>

            <div className="rounded-md border border-border bg-background/50 p-3">
              {selectedTable ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">
                      {t("sqlBrowser.columnList")}
                    </div>
                    <ScrollArea className="h-[120px] rounded-md border border-border">
                      <div className="p-2 space-y-1">
                        {columns.length === 0 ? (
                          <div className="text-xs text-muted-foreground p-2">
                            {isLoading
                              ? t("sqlBrowser.loading")
                              : t("sqlBrowser.emptyColumns")}
                          </div>
                        ) : (
                          columns.map(c => (
                            <div
                              key={c.name}
                              className="flex items-center justify-between rounded border border-border px-2 py-1 bg-background/50"
                            >
                              <div className="text-xs font-mono truncate">
                                {c.name}
                              </div>
                              <div className="text-[11px] text-muted-foreground truncate">
                                {c.dataType}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">
                      {t("sqlBrowser.variable")}
                    </div>
                    <Input
                      value={varName}
                      onChange={e => setVarName(e.target.value)}
                      className="h-9 font-mono"
                      placeholder="my_variable"
                    />
                    <div className="text-[11px] text-muted-foreground font-mono">
                      {`resolver: sql://${dataSourceId}`}
                    </div>
                    {selectedNodeId && (
                      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                        <div className="text-xs text-muted-foreground">
                          {t("sqlBrowser.attachToSelected")}
                        </div>
                        <Switch
                          checked={attachToSelectedNode}
                          onCheckedChange={setAttachToSelectedNode}
                        />
                      </div>
                    )}
                    <Button
                      variant="outline"
                      onClick={handleCreateVariable}
                      disabled={!varName.trim() || !query.trim()}
                    >
                      {t("sqlBrowser.createVariable")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  {t("sqlBrowser.selectTable")}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                {t("sqlBrowser.query")}
              </div>
              <Textarea
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="min-h-24 font-mono text-xs"
              />
              {selectedTable && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => void handleLoadRows()}
                    disabled={loadingRows}
                  >
                    {loadingRows
                      ? t("sqlBrowser.loading")
                      : t("sqlBrowser.loadRows")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void handleInsertRow()}
                  >
                    {t("sqlBrowser.insertRow")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void handleDeleteRow()}
                  >
                    {t("sqlBrowser.deleteRow")}
                  </Button>
                </div>
              )}
              {tableRows && (
                <div className="rounded-md border border-border p-3">
                  <div className="text-xs text-muted-foreground">
                    {t("sqlBrowser.tableRows")}
                  </div>
                  <pre className="mt-2 text-[11px] leading-5 overflow-auto max-h-40">
                    {JSON.stringify(tableRows, null, 2)}
                  </pre>
                </div>
              )}
              {queryResult && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border border-border p-3">
                    <div className="text-xs text-muted-foreground">
                      {t("sqlBrowser.value")}
                    </div>
                    <div className="mt-1 font-mono text-sm break-all">
                      {queryResult.value}
                    </div>
                  </div>
                  <div className="rounded-md border border-border p-3">
                    <div className="text-xs text-muted-foreground">
                      {t("sqlBrowser.rows")}
                    </div>
                    <pre className="mt-2 text-[11px] leading-5 overflow-auto max-h-40">
                      {JSON.stringify(queryResult.rows, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
