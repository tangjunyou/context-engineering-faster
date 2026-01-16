import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ImportCsvDialog } from "@/components/ImportCsvDialog";
import { SqlBrowserDialog } from "@/components/SqlBrowserDialog";
import { ImportHistoryDialog } from "@/components/ImportHistoryDialog";
import { VectorStudioDialog } from "@/components/VectorStudioDialog";
import { ModelStudioDialog } from "@/components/ModelStudioDialog";
import { DatasetCenterDialog } from "@/components/DatasetCenterDialog";
import { JobCenterDialog } from "@/components/JobCenterDialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  createDataSource,
  createLocalSqliteDataSource,
  deleteDataSource,
  listDataSources,
  testDataSource,
  updateDataSource,
} from "@/lib/api/datasources";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type DataSource = Awaited<ReturnType<typeof listDataSources>>[number];

export default function DataSourceManager() {
  const { t } = useTranslation();
  const [items, setItems] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [importForId, setImportForId] = useState<string | null>(null);
  const [browseSqlFor, setBrowseSqlFor] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [importHistoryOpen, setImportHistoryOpen] = useState(false);
  const [vectorStudioOpen, setVectorStudioOpen] = useState(false);
  const [modelStudioOpen, setModelStudioOpen] = useState(false);
  const [datasetCenterOpen, setDatasetCenterOpen] = useState(false);
  const [jobCenterOpen, setJobCenterOpen] = useState(false);

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("dataSourceManager.validation.nameRequired")),
        driver: z.enum(["sqlite", "postgres", "mysql"]),
        url: z.string().min(1, t("dataSourceManager.validation.urlRequired")),
        allowImport: z.boolean().optional(),
      }),
    [t]
  );

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", driver: "sqlite", url: "", allowImport: false },
  });

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await listDataSources();
      setItems(list);
    } catch (e) {
      toast.error(t("dataSourceManager.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const submit = form.handleSubmit(async values => {
    try {
      const created = await createDataSource({
        name: values.name,
        driver: values.driver,
        url: values.url,
        allowImport: values.allowImport,
      });
      toast.success(t("dataSourceManager.created"));
      setItems(prev => [created, ...prev]);
      form.reset({ name: "", driver: "sqlite", url: "", allowImport: false });
    } catch (e) {
      toast.error(t("dataSourceManager.createFailed"));
    }
  });

  const handleTest = async (id: string) => {
    try {
      const res = await testDataSource(id);
      if (res.ok) toast.success(t("dataSourceManager.testOk"));
      else toast.error(t("dataSourceManager.testFailed"));
    } catch (e) {
      toast.error(t("dataSourceManager.testFailed"));
    }
  };

  const handleDelete = async (id: string) => {
    const ok = window.confirm(t("dataSourceManager.deleteConfirm"));
    if (!ok) return;
    try {
      await deleteDataSource(id);
      setItems(prev => prev.filter(v => v.id !== id));
      toast.success(t("dataSourceManager.deleted"));
    } catch (e) {
      toast.error(t("dataSourceManager.deleteFailed"));
    }
  };

  const handleToggleImport = async (ds: DataSource, allowImport: boolean) => {
    try {
      const updated = await updateDataSource(ds.id, { allowImport });
      setItems(prev => prev.map(v => (v.id === ds.id ? updated : v)));
      toast.success(
        allowImport
          ? t("dataSourceManager.importEnabled")
          : t("dataSourceManager.importDisabled")
      );
    } catch {
      toast.error(t("dataSourceManager.updateFailed"));
    }
  };

  const handleToggleWrite = async (ds: DataSource, allowWrite: boolean) => {
    try {
      const updated = await updateDataSource(ds.id, { allowWrite });
      setItems(prev => prev.map(v => (v.id === ds.id ? updated : v)));
      toast.success(
        allowWrite
          ? t("dataSourceManager.writeEnabled")
          : t("dataSourceManager.writeDisabled")
      );
    } catch {
      toast.error(t("dataSourceManager.updateFailed"));
    }
  };

  const handleToggleSchema = async (ds: DataSource, allowSchema: boolean) => {
    try {
      const updated = await updateDataSource(ds.id, { allowSchema });
      setItems(prev => prev.map(v => (v.id === ds.id ? updated : v)));
      toast.success(
        allowSchema
          ? t("dataSourceManager.schemaEnabled")
          : t("dataSourceManager.schemaDisabled")
      );
    } catch {
      toast.error(t("dataSourceManager.updateFailed"));
    }
  };

  const handleToggleDelete = async (ds: DataSource, allowDelete: boolean) => {
    try {
      const updated = await updateDataSource(ds.id, { allowDelete });
      setItems(prev => prev.map(v => (v.id === ds.id ? updated : v)));
      toast.success(
        allowDelete
          ? t("dataSourceManager.deleteEnabled")
          : t("dataSourceManager.deleteDisabled")
      );
    } catch {
      toast.error(t("dataSourceManager.updateFailed"));
    }
  };

  const handleCreateLocalSqlite = async () => {
    const name = window.prompt(t("dataSourceManager.localSqlitePrompt"));
    if (!name) return;
    try {
      const created = await createLocalSqliteDataSource({ name });
      toast.success(t("dataSourceManager.created"));
      setItems(prev => [created, ...prev]);
    } catch {
      toast.error(t("dataSourceManager.createFailed"));
    }
  };

  return (
    <div className="h-full flex flex-col bg-card border-l border-border">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="font-mono font-bold text-sm uppercase tracking-wider">
          {t("dataSourceManager.title")}
        </h2>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleCreateLocalSqlite()}
          >
            {t("dataSourceManager.createLocalSqlite")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setVectorStudioOpen(true)}
          >
            {t("vectorStudio.open")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setModelStudioOpen(true)}
          >
            {t("modelStudio.open")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDatasetCenterOpen(true)}
          >
            {t("datasetCenter.open")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setJobCenterOpen(true)}
          >
            {t("jobCenter.open")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setImportHistoryOpen(true)}
          >
            {t("importHistory.open")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            {t("dataSourceManager.refresh")}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          <VectorStudioDialog
            open={vectorStudioOpen}
            onOpenChange={setVectorStudioOpen}
          />
          <ModelStudioDialog
            open={modelStudioOpen}
            onOpenChange={setModelStudioOpen}
          />
          <DatasetCenterDialog
            open={datasetCenterOpen}
            onOpenChange={setDatasetCenterOpen}
          />
          <JobCenterDialog
            open={jobCenterOpen}
            onOpenChange={setJobCenterOpen}
          />
          <ImportHistoryDialog
            open={importHistoryOpen}
            onOpenChange={setImportHistoryOpen}
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
          <Form {...form}>
            <form onSubmit={submit} className="space-y-3">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">
                      {t("dataSourceManager.name")}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} className="h-8 font-mono text-xs" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="driver"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">
                      {t("dataSourceManager.driver")}
                    </FormLabel>
                    <FormControl>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger size="sm" className="w-full font-mono">
                          <SelectValue placeholder="sqlite" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sqlite">sqlite</SelectItem>
                          <SelectItem value="postgres">postgres</SelectItem>
                          <SelectItem value="mysql">mysql</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">
                      {t("dataSourceManager.url")}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} className="h-8 font-mono text-xs" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="allowImport"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">
                      {t("dataSourceManager.allowImport")}
                    </FormLabel>
                    <FormControl>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={Boolean(field.value)}
                          onCheckedChange={field.onChange}
                        />
                        <div className="text-xs text-muted-foreground">
                          {t("dataSourceManager.allowImportHint")}
                        </div>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" size="sm" disabled={loading}>
                {t("dataSourceManager.create")}
              </Button>
            </form>
          </Form>

          <div className="text-xs text-muted-foreground">
            {t("dataSourceManager.hint")}
          </div>

          <div className="space-y-2">
            {items.map(ds => (
              <div
                key={ds.id}
                className="rounded-md border border-border bg-background/50 p-3"
              >
                <div className="flex items-center justify-between">
                  <div className="font-mono text-xs font-bold text-primary">
                    {ds.name}
                  </div>
                  <div className="flex gap-2">
                    {(ds.driver === "sqlite" ||
                      ds.driver === "postgres" ||
                      ds.driver === "mysql") && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setBrowseSqlFor({ id: ds.id, name: ds.name })
                        }
                      >
                        {t("sqlBrowser.open")}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleTest(ds.id)}
                    >
                      {t("dataSourceManager.test")}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void handleDelete(ds.id)}
                    >
                      {t("dataSourceManager.delete")}
                    </Button>
                  </div>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {ds.driver} · {ds.id}
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground font-mono">
                  {t("dataSourceManager.resolver")}: sql://{ds.id}
                </div>
                {(ds.driver === "sqlite" ||
                  ds.driver === "postgres" ||
                  ds.driver === "mysql") && (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        {t("dataSourceManager.allowImport")}
                      </div>
                      <Switch
                        checked={Boolean(ds.allowImport)}
                        onCheckedChange={v => void handleToggleImport(ds, v)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        {t("dataSourceManager.allowWrite")}
                      </div>
                      <Switch
                        checked={Boolean(ds.allowWrite)}
                        onCheckedChange={v => void handleToggleWrite(ds, v)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        {t("dataSourceManager.allowSchema")}
                      </div>
                      <Switch
                        checked={Boolean(ds.allowSchema)}
                        onCheckedChange={v => void handleToggleSchema(ds, v)}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        {t("dataSourceManager.allowDelete")}
                      </div>
                      <Switch
                        checked={Boolean(ds.allowDelete)}
                        onCheckedChange={v => void handleToggleDelete(ds, v)}
                      />
                    </div>
                  </div>
                )}
                {(ds.driver === "sqlite" ||
                  ds.driver === "postgres" ||
                  ds.driver === "mysql") &&
                  Boolean(ds.allowImport) && (
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setImportForId(ds.id)}
                      >
                        {t("imports.open")}
                      </Button>
                    </div>
                  )}
              </div>
            ))}
            {!items.length && !loading && (
              <div className="text-xs text-muted-foreground">
                {t("dataSourceManager.empty")}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
