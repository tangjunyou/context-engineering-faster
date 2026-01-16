import { useStore } from "@/lib/store";
import { Variable } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Trash2, Edit2, Save, X } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { shallow } from "zustand/shallow";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getVariableLibraryItem,
  listVariableLibrary,
  type VariableLibraryItem,
  type VariableLibrarySummary,
} from "@/lib/api/variable-library";
import { toast } from "sonner";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

export default function VariableManager() {
  const { t } = useTranslation();
  const { projectId, variables, addVariable, updateVariable, deleteVariable } =
    useStore(
      state => ({
        projectId: state.projectId,
        variables: state.variables,
        addVariable: state.addVariable,
        updateVariable: state.updateVariable,
        deleteVariable: state.deleteVariable,
      }),
      shallow
    );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [libraryList, setLibraryList] = useState<VariableLibrarySummary[]>([]);
  const [librarySelectedId, setLibrarySelectedId] = useState<string | null>(
    null
  );
  const [librarySelected, setLibrarySelected] =
    useState<VariableLibraryItem | null>(null);

  const variableSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("variableManager.validation.nameRequired")),
        type: z.enum(["static", "dynamic"]),
        value: z.string(),
        resolver: z.string().optional(),
      }),
    [t]
  );

  type VariableFormValues = z.infer<typeof variableSchema>;

  const form = useForm<VariableFormValues>({
    resolver: zodResolver(variableSchema),
    defaultValues: { name: "", type: "static", value: "", resolver: "" },
    mode: "onChange",
  });

  const handleEdit = (v: Variable) => {
    setEditingId(v.id);
    form.reset({
      name: v.name,
      type: v.type,
      value: v.value ?? "",
      resolver: v.resolver ?? "",
    });
  };

  const submit = form.handleSubmit(values => {
    if (!editingId) return;
    const original = variables.find(v => v.id === editingId);
    if (!original) return;
    updateVariable({ ...original, ...values });
    setEditingId(null);
    form.reset();
  });

  const handleCancel = () => {
    setEditingId(null);
    form.reset();
  };

  const handleAdd = () => {
    const newVar: Variable = {
      id: `var_${Date.now()}`,
      name: "new_variable",
      type: "static",
      value: "",
      source: t("variableManager.userDefined"),
      resolver: "",
    };
    addVariable(newVar);
    handleEdit(newVar);
  };

  const openImport = async () => {
    if (!projectId) {
      toast.error("需要先选择/创建项目");
      return;
    }
    setImportOpen(true);
    setImportLoading(true);
    setLibraryList([]);
    setLibrarySelectedId(null);
    setLibrarySelected(null);
    try {
      const list = await listVariableLibrary(projectId);
      setLibraryList(list);
    } catch {
      toast.error("加载变量库失败");
    } finally {
      setImportLoading(false);
    }
  };

  const loadLibraryItem = async (id: string) => {
    if (!projectId) return;
    setLibrarySelectedId(id);
    setLibrarySelected(null);
    setImportLoading(true);
    try {
      const item = await getVariableLibraryItem(projectId, id);
      setLibrarySelected(item);
    } catch {
      toast.error("加载变量详情失败");
    } finally {
      setImportLoading(false);
    }
  };

  const importSelected = () => {
    const item = librarySelected;
    if (!item) return;
    const current =
      item.versions.find(v => v.versionId === item.currentVersionId) ??
      item.versions[item.versions.length - 1];
    if (!current) return;
    const v: Variable = {
      id: item.id,
      name: current.data.name,
      type:
        current.data.type === "static" || current.data.type === "dynamic"
          ? current.data.type
          : "dynamic",
      value: current.data.value,
      description: current.data.description,
      source: current.data.source ?? "variable_library",
      resolver: current.data.resolver ?? "",
    };
    if (variables.some(x => x.id === v.id)) {
      updateVariable(v);
    } else {
      addVariable(v);
    }
    toast.success("已导入到项目变量");
    setImportOpen(false);
  };

  return (
    <div className="h-full flex flex-col bg-card border-l border-border">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="font-mono font-bold text-sm uppercase tracking-wider">
          {t("variableManager.title")}
        </h2>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void openImport()}>
            导入变量库
          </Button>
          <Button size="sm" variant="outline" onClick={handleAdd}>
            <Plus className="w-4 h-4 mr-1" /> {t("variableManager.add")}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {variables.map(v => (
            <div
              key={v.id}
              className={cn(
                "p-3 rounded-md border border-border bg-background/50 transition-all",
                editingId === v.id
                  ? "ring-2 ring-primary"
                  : "hover:border-primary/50"
              )}
            >
              {editingId === v.id ? (
                <Form {...form}>
                  <form onSubmit={submit} className="space-y-3">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">
                            {t("variableManager.name")}
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              className="h-8 font-mono text-xs"
                              autoComplete="off"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="type"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">
                            {t("variableManager.type")}
                          </FormLabel>
                          <FormControl>
                            <div className="flex gap-2">
                              <Badge
                                variant={
                                  field.value === "static"
                                    ? "default"
                                    : "outline"
                                }
                                className="cursor-pointer"
                                onClick={() => field.onChange("static")}
                              >
                                {t("variableManager.static")}
                              </Badge>
                              <Badge
                                variant={
                                  field.value === "dynamic"
                                    ? "default"
                                    : "outline"
                                }
                                className="cursor-pointer"
                                onClick={() => field.onChange("dynamic")}
                              >
                                {t("variableManager.dynamic")}
                              </Badge>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="value"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">
                            {t("variableManager.valueExample")}
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              className="h-8 font-mono text-xs"
                              autoComplete="off"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {form.watch("type") === "dynamic" && (
                      <FormField
                        control={form.control}
                        name="resolver"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">
                              {t("variableManager.sourceUrl")}
                            </FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                className="h-8 font-mono text-xs"
                                autoComplete="off"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    <div className="flex justify-end gap-2 mt-2">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={handleCancel}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                      <Button
                        type="submit"
                        size="icon"
                        variant="default"
                        className="h-6 w-6"
                      >
                        <Save className="w-3 h-3" />
                      </Button>
                    </div>
                  </form>
                </Form>
              ) : (
                <div className="flex items-start justify-between group">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm font-bold text-primary">
                        {`{{${v.name}}}`}
                      </span>
                      <Badge
                        variant="secondary"
                        className="text-[10px] h-4 px-1"
                      >
                        {v.type}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                      {v.value || t("variableManager.noValue")}
                    </div>
                    {v.type === "dynamic" && v.resolver && (
                      <div className="text-[10px] text-muted-foreground/70 mt-1 font-mono truncate max-w-[180px]">
                        {v.resolver}
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground/70 mt-1">
                      {t("variableManager.source")}: {v.source}
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => handleEdit(v)}
                    >
                      <Edit2 className="w-3 h-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={() => deleteVariable(v.id)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>从变量库导入</DialogTitle>
            <DialogDescription>
              选择变量库条目并导入到当前项目变量，用于上下文装配插值与预览。
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 overflow-hidden">
            <div className="border border-border rounded-md overflow-hidden">
              <ScrollArea className="h-80">
                <div className="p-2 space-y-1">
                  {libraryList.map(x => (
                    <button
                      key={x.id}
                      className={`w-full text-left rounded px-2 py-2 text-sm border ${
                        librarySelectedId === x.id
                          ? "border-primary bg-primary/10"
                          : "border-transparent hover:border-border hover:bg-muted/30"
                      }`}
                      onClick={() => void loadLibraryItem(x.id)}
                    >
                      <div className="font-medium">{x.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {x.type}
                      </div>
                    </button>
                  ))}
                  {libraryList.length === 0 && (
                    <div className="p-3 text-xs text-muted-foreground">
                      {importLoading ? "加载中…" : "暂无数据"}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
            <div className="border border-border rounded-md overflow-hidden">
              <ScrollArea className="h-80">
                <div className="p-3 space-y-2">
                  {!librarySelected ? (
                    <div className="text-sm text-muted-foreground">
                      选择一个变量查看详情
                    </div>
                  ) : (
                    <>
                      <div className="text-xs font-mono text-primary">
                        {librarySelected.id}
                      </div>
                      <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap">
                        {JSON.stringify(librarySelected, null, 2)}
                      </pre>
                    </>
                  )}
                </div>
              </ScrollArea>
              <div className="p-3 border-t border-border flex justify-end">
                <Button
                  disabled={!librarySelected}
                  onClick={() => importSelected()}
                >
                  导入
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
