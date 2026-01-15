import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  deleteDataSource,
  listDataSources,
  testDataSource,
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

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("dataSourceManager.validation.nameRequired")),
        driver: z.enum(["sqlite", "postgres", "mysql"]),
        url: z.string().min(1, t("dataSourceManager.validation.urlRequired")),
      }),
    [t]
  );

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", driver: "sqlite", url: "" },
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
      const created = await createDataSource(values);
      toast.success(t("dataSourceManager.created"));
      setItems(prev => [created, ...prev]);
      form.reset({ name: "", driver: "sqlite", url: "" });
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

  return (
    <div className="h-full flex flex-col bg-card border-l border-border">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="font-mono font-bold text-sm uppercase tracking-wider">
          {t("dataSourceManager.title")}
        </h2>
        <Button size="sm" variant="outline" onClick={() => void refresh()}>
          {t("dataSourceManager.refresh")}
        </Button>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
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
