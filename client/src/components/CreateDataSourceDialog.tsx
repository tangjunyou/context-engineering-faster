import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createDataSource,
  createLocalSqliteDataSource,
  type DataSource,
} from "@/lib/api/datasources";

function buildSqlUrl(input: {
  driver: "postgres" | "mysql";
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
}) {
  const user = encodeURIComponent(input.username);
  const pass = encodeURIComponent(input.password);
  const host = input.host.trim();
  const db = input.database.trim();
  const base = `${input.driver}://${user}:${pass}@${host}:${input.port}/${db}`;
  if (!input.ssl) return base;
  if (input.driver === "postgres") return `${base}?sslmode=require`;
  return `${base}?ssl-mode=REQUIRED`;
}

function createDataSourceSchema(t: (key: string, options?: any) => string) {
  return z
    .object({
      name: z.string().min(1, t("dataSourceManager.validation.nameRequired")),
      driver: z.enum(["sqlite", "postgres", "mysql", "milvus"]),
      connectionMode: z.enum(["builder", "url"]),
      url: z.string().optional(),
      sqliteLocal: z.boolean(),
      sqlitePath: z.string().optional(),
      sqlHost: z.string().optional(),
      sqlPort: z.coerce.number().optional(),
      sqlDatabase: z.string().optional(),
      sqlUsername: z.string().optional(),
      sqlPassword: z.string().optional(),
      sqlSsl: z.boolean(),
      milvusBaseUrl: z.string().optional(),
      milvusToken: z.string().optional(),
      allowImport: z.boolean(),
      allowWrite: z.boolean(),
      allowSchema: z.boolean(),
      allowDelete: z.boolean(),
    })
    .superRefine((v, ctx) => {
      if (v.driver === "sqlite") {
        if (!v.sqliteLocal && !v.sqlitePath?.trim()) {
          ctx.addIssue({
            code: "custom",
            message: t("dataSourceManager.validation.urlRequired"),
            path: ["sqlitePath"],
          });
        }
        return;
      }

      if (v.driver === "milvus") {
        if (!v.milvusBaseUrl?.trim()) {
          ctx.addIssue({
            code: "custom",
            message: t("dataSourceManager.validation.urlRequired"),
            path: ["milvusBaseUrl"],
          });
        }
        return;
      }

      if (v.connectionMode === "url") {
        if (!v.url?.trim()) {
          ctx.addIssue({
            code: "custom",
            message: t("dataSourceManager.validation.urlRequired"),
            path: ["url"],
          });
        }
        return;
      }

      const requiredFields: Array<[keyof typeof v, string]> = [
        ["sqlHost", "Host 不能为空"],
        ["sqlPort", "Port 不能为空"],
        ["sqlDatabase", "Database 不能为空"],
        ["sqlUsername", "Username 不能为空"],
        ["sqlPassword", "Password 不能为空"],
      ];
      for (const [key, message] of requiredFields) {
        if (v[key] == null || String(v[key]).trim() === "") {
          ctx.addIssue({ code: "custom", message, path: [key] });
        }
      }
    });
}

type CreateDataSourceSchema = ReturnType<typeof createDataSourceSchema>;
type CreateDataSourceFormInput = z.input<CreateDataSourceSchema>;
type CreateDataSourceFormOutput = z.output<CreateDataSourceSchema>;

export function CreateDataSourceDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (ds: DataSource) => void;
}) {
  const { t } = useTranslation();
  const schema = useMemo(() => createDataSourceSchema(t), [t]);

  const form = useForm<
    CreateDataSourceFormInput,
    any,
    CreateDataSourceFormOutput
  >({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      driver: "sqlite",
      connectionMode: "builder",
      url: "",
      sqliteLocal: true,
      sqlitePath: "data.db",
      sqlHost: "localhost",
      sqlPort: 5432,
      sqlDatabase: "postgres",
      sqlUsername: "postgres",
      sqlPassword: "",
      sqlSsl: false,
      milvusBaseUrl: "http://localhost:19530",
      milvusToken: "",
      allowImport: false,
      allowWrite: false,
      allowSchema: false,
      allowDelete: false,
    },
  });

  const driver = form.watch("driver");
  const mode = form.watch("connectionMode");
  const sqliteLocal = form.watch("sqliteLocal");

  const submit = form.handleSubmit(async values => {
    try {
      if (values.driver === "sqlite" && values.sqliteLocal) {
        const created = await createLocalSqliteDataSource({
          name: values.name,
        });
        toast.success(t("dataSourceManager.created"));
        props.onCreated(created);
        props.onOpenChange(false);
        form.reset();
        return;
      }

      let url = "";
      let token: string | undefined;

      if (values.driver === "sqlite") {
        url = String(values.sqlitePath ?? "").trim();
      } else if (values.driver === "milvus") {
        url = String(values.milvusBaseUrl ?? "").trim();
        token = String(values.milvusToken ?? "").trim() || undefined;
      } else if (values.connectionMode === "url") {
        url = String(values.url ?? "").trim();
      } else {
        url = buildSqlUrl({
          driver: values.driver,
          host: String(values.sqlHost ?? ""),
          port: Number(values.sqlPort ?? 0),
          database: String(values.sqlDatabase ?? ""),
          username: String(values.sqlUsername ?? ""),
          password: String(values.sqlPassword ?? ""),
          ssl: Boolean(values.sqlSsl),
        });
      }

      const created = await createDataSource({
        name: values.name,
        driver: values.driver,
        url,
        token,
        allowImport: values.allowImport,
        allowWrite: values.allowWrite,
        allowSchema: values.allowSchema,
        allowDelete: values.allowDelete,
      });
      toast.success(t("dataSourceManager.created"));
      props.onCreated(created);
      props.onOpenChange(false);
      form.reset();
    } catch {
      toast.error(t("dataSourceManager.createFailed"));
    }
  });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("dataSourceManager.new")}</DialogTitle>
        </DialogHeader>

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
                    <Input {...field} className="h-9 font-mono text-xs" />
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
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full font-mono">
                        <SelectValue placeholder="sqlite" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sqlite">sqlite</SelectItem>
                        <SelectItem value="postgres">postgres</SelectItem>
                        <SelectItem value="mysql">mysql</SelectItem>
                        <SelectItem value="milvus">milvus</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {driver === "sqlite" && (
              <>
                <FormField
                  control={form.control}
                  name="sqliteLocal"
                  render={({ field }) => (
                    <FormItem className="rounded-md border border-border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm">
                            {t("dataSourceManager.sqliteLocal")}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {t("dataSourceManager.sqliteLocalHint")}
                          </div>
                        </div>
                        <FormControl>
                          <Switch
                            checked={Boolean(field.value)}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {!sqliteLocal && (
                  <FormField
                    control={form.control}
                    name="sqlitePath"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">
                          {t("dataSourceManager.url")}
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            className="h-9 font-mono text-xs"
                            placeholder="data.db"
                            autoComplete="off"
                          />
                        </FormControl>
                        <FormDescription className="text-[10px]">
                          {t("dataSourceManager.urlHintSqlite")}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </>
            )}

            {(driver === "postgres" || driver === "mysql") && (
              <>
                <FormField
                  control={form.control}
                  name="connectionMode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">
                        {t("dataSourceManager.connectionMode")}
                      </FormLabel>
                      <FormControl>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger className="w-full font-mono">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="builder">
                              {t("dataSourceManager.connectionModeBuilder")}
                            </SelectItem>
                            <SelectItem value="url">
                              {t("dataSourceManager.connectionModeUrl")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {mode === "url" ? (
                  <FormField
                    control={form.control}
                    name="url"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">
                          {t("dataSourceManager.url")}
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            className="h-9 font-mono text-xs"
                            placeholder={
                              driver === "postgres"
                                ? "postgres://user:pass@localhost:5432/db"
                                : "mysql://user:pass@localhost:3306/db"
                            }
                            autoComplete="off"
                          />
                        </FormControl>
                        <FormDescription className="text-[10px]">
                          {t("dataSourceManager.urlHintSql")}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="sqlHost"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Host</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              className="h-9 font-mono text-xs"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="sqlPort"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Port</FormLabel>
                          <FormControl>
                            <Input
                              value={
                                field.value == null ? "" : String(field.value)
                              }
                              onChange={e => field.onChange(e.target.value)}
                              onBlur={field.onBlur}
                              name={field.name}
                              ref={field.ref}
                              inputMode="numeric"
                              className="h-9 font-mono text-xs"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="sqlDatabase"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Database</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              className="h-9 font-mono text-xs"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="sqlUsername"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Username</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              className="h-9 font-mono text-xs"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="sqlPassword"
                      render={({ field }) => (
                        <FormItem className="col-span-2">
                          <FormLabel className="text-xs">Password</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="password"
                              className="h-9 font-mono text-xs"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="sqlSsl"
                      render={({ field }) => (
                        <FormItem className="col-span-2 rounded-md border border-border p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm">SSL</div>
                              <div className="text-xs text-muted-foreground">
                                {t("dataSourceManager.sslHint")}
                              </div>
                            </div>
                            <FormControl>
                              <Switch
                                checked={Boolean(field.value)}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </>
            )}

            {driver === "milvus" && (
              <>
                <FormField
                  control={form.control}
                  name="milvusBaseUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Base URL</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          className="h-9 font-mono text-xs"
                          placeholder="https://milvus.example.com"
                          autoComplete="off"
                        />
                      </FormControl>
                      <FormDescription className="text-[10px]">
                        {t("dataSourceManager.milvusUrlHint")}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="milvusToken"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Token</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          className="h-9 font-mono text-xs"
                          placeholder={t("dataSourceManager.optional")}
                          autoComplete="off"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="allowImport"
                render={({ field }) => (
                  <FormItem className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm">
                          {t("dataSourceManager.allowImport")}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t("dataSourceManager.allowImportHint")}
                        </div>
                      </div>
                      <FormControl>
                        <Switch
                          checked={Boolean(field.value)}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="allowWrite"
                render={({ field }) => (
                  <FormItem className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm">
                        {t("dataSourceManager.allowWrite")}
                      </div>
                      <FormControl>
                        <Switch
                          checked={Boolean(field.value)}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="allowSchema"
                render={({ field }) => (
                  <FormItem className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm">
                        {t("dataSourceManager.allowSchema")}
                      </div>
                      <FormControl>
                        <Switch
                          checked={Boolean(field.value)}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="allowDelete"
                render={({ field }) => (
                  <FormItem className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm">
                        {t("dataSourceManager.allowDelete")}
                      </div>
                      <FormControl>
                        <Switch
                          checked={Boolean(field.value)}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => props.onOpenChange(false)}
              >
                {t("imports.cancel")}
              </Button>
              <Button type="submit">{t("dataSourceManager.create")}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
