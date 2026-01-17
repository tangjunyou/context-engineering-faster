import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  cloneVariableLibraryItem,
  createVariableLibraryItem,
  deleteVariableLibraryItem,
  getVariableLibraryItem,
  listVariableLibrary,
  rollbackVariableLibraryItem,
  updateVariableLibraryItem,
  type VariableLibraryItem,
  type VariableLibrarySummary,
} from "@/lib/api/variable-library";

type Props = {
  onImportToProjectVariables?: (item: VariableLibraryItem) => void;
  initialSelectedId?: string | null;
  initialFilter?: string | null;
};

export default function VariableLibraryPanel(props: Props) {
  const { projectId } = useStore(s => ({ projectId: s.projectId }));
  const [isLoading, setIsLoading] = useState(false);
  const [items, setItems] = useState<VariableLibrarySummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(
    props.initialSelectedId ?? null
  );
  const [selected, setSelected] = useState<VariableLibraryItem | null>(null);
  const [filter, setFilter] = useState(props.initialFilter ?? "");

  const [createName, setCreateName] = useState("");
  const [createType, setCreateType] = useState<"static" | "dynamic">("dynamic");
  const [createResolver, setCreateResolver] = useState("");
  const [createValue, setCreateValue] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return items;
    return items.filter(
      x =>
        x.name.toLowerCase().includes(f) ||
        x.tags.some(t => t.toLowerCase().includes(f))
    );
  }, [filter, items]);

  const refreshList = async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const res = await listVariableLibrary(projectId);
      setItems(res);
    } catch {
      toast.error("加载变量库失败");
    } finally {
      setIsLoading(false);
    }
  };

  const loadSelected = async (id: string) => {
    if (!projectId) return;
    try {
      const res = await getVariableLibraryItem(projectId, id);
      setSelected(res);
    } catch {
      setSelected(null);
      toast.error("加载变量详情失败");
    }
  };

  useEffect(() => {
    void refreshList();
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    if (!selectedId) {
      setSelected(null);
      return;
    }
    void loadSelected(selectedId);
  }, [projectId, selectedId]);

  const currentVersion = useMemo(() => {
    if (!selected) return null;
    return (
      selected.versions.find(v => v.versionId === selected.currentVersionId) ??
      null
    );
  }, [selected]);

  const handleCreate = async () => {
    if (!projectId) return;
    const name = createName.trim();
    if (!name) return;
    setIsLoading(true);
    try {
      const item = await createVariableLibraryItem(projectId, {
        name,
        type: createType,
        value: createValue,
        resolver: createResolver.trim() || undefined,
        tags: [],
      });
      toast.success("已创建变量");
      setCreateName("");
      setCreateResolver("");
      setCreateValue("");
      setSelectedId(item.id);
      await refreshList();
    } catch {
      toast.error("创建失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!projectId || !selectedId) return;
    if (!window.confirm("确定删除该变量？")) return;
    setIsLoading(true);
    try {
      await deleteVariableLibraryItem(projectId, selectedId);
      toast.success("已删除");
      setSelectedId(null);
      setSelected(null);
      await refreshList();
    } catch {
      toast.error("删除失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClone = async () => {
    if (!projectId || !selectedId) return;
    setIsLoading(true);
    try {
      const cloned = await cloneVariableLibraryItem(projectId, selectedId);
      toast.success("已复制变量");
      setSelectedId(cloned.id);
      await refreshList();
    } catch {
      toast.error("复制失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRollback = async (versionId: string) => {
    if (!projectId || !selectedId) return;
    setIsLoading(true);
    try {
      const item = await rollbackVariableLibraryItem(
        projectId,
        selectedId,
        versionId
      );
      setSelected(item);
      toast.success("已回滚版本");
      await refreshList();
    } catch {
      toast.error("回滚失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickRename = async () => {
    if (!projectId || !selectedId || !currentVersion) return;
    setRenameValue(currentVersion.data.name);
    setRenameOpen(true);
  };

  const handleRenameSubmit = async () => {
    if (!projectId || !selectedId) return;
    const name = renameValue.trim();
    if (!name) return;
    setIsLoading(true);
    try {
      const item = await updateVariableLibraryItem(projectId, selectedId, {
        name,
      });
      setSelected(item);
      toast.success("已更新");
      await refreshList();
      setRenameOpen(false);
    } catch {
      toast.error("更新失败");
    } finally {
      setIsLoading(false);
    }
  };

  if (!projectId) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        需要先选择/创建一个项目，才能使用变量库。
      </div>
    );
  }

  return (
    <div className="h-full grid grid-cols-3 gap-4 overflow-hidden">
      <div className="col-span-1 border border-border rounded-md overflow-hidden flex flex-col">
        <div className="p-3 border-b border-border bg-muted/30 space-y-2">
          <div className="text-xs font-mono font-bold text-primary">变量库</div>
          <Input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="搜索变量名/标签"
            name="variableLibraryFilter"
            autoComplete="off"
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={createName}
              onChange={e => setCreateName(e.target.value)}
              placeholder="新变量名"
              name="variableLibraryCreateName"
              autoComplete="off"
            />
            <Button
              disabled={isLoading || !createName.trim()}
              onClick={() => void handleCreate()}
            >
              创建
            </Button>
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {filtered.map(x => (
              <button
                key={x.id}
                className={`w-full text-left rounded px-2 py-2 text-sm border ${
                  selectedId === x.id
                    ? "border-primary bg-primary/10"
                    : "border-transparent hover:border-border hover:bg-muted/30"
                }`}
                onClick={() => setSelectedId(x.id)}
              >
                <div className="font-medium">{x.name}</div>
                <div className="text-[10px] text-muted-foreground">
                  {x.type} · {new Date(Number(x.updatedAt)).toLocaleString()}
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="p-3 text-xs text-muted-foreground">暂无数据</div>
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="col-span-2 border border-border rounded-md overflow-hidden flex flex-col">
        {!selected ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            选择一个变量查看详情
          </div>
        ) : (
          <>
            <div className="p-3 border-b border-border bg-muted/30 flex items-center justify-between">
              <div className="space-y-1">
                <div className="text-sm font-bold">
                  {currentVersion?.data.name}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  当前版本：{selected.currentVersionId} · 更新：
                  {new Date(Number(selected.updatedAt)).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleQuickRename()}
                >
                  重命名
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleClone()}
                >
                  复制
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void handleDelete()}
                >
                  删除
                </Button>
                {props.onImportToProjectVariables && (
                  <Button
                    size="sm"
                    onClick={() => props.onImportToProjectVariables?.(selected)}
                  >
                    导入到项目变量
                  </Button>
                )}
              </div>
            </div>
            {renameOpen && (
              <div className="px-3 py-2 border-b border-border bg-muted/10 flex items-center gap-2">
                <Input
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  className="h-9 font-mono text-xs"
                  autoComplete="off"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleRenameSubmit()}
                  disabled={!renameValue.trim() || isLoading}
                >
                  保存
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRenameOpen(false)}
                >
                  取消
                </Button>
              </div>
            )}

            <div className="flex-1 overflow-hidden grid grid-cols-2">
              <ScrollArea className="h-full border-r border-border">
                <div className="p-4 space-y-3">
                  <div className="text-xs font-mono font-bold text-primary">
                    当前配置
                  </div>
                  <div className="grid gap-2">
                    <div className="text-[10px] text-muted-foreground">
                      类型
                    </div>
                    <Input value={currentVersion?.data.type ?? ""} readOnly />
                    <div className="text-[10px] text-muted-foreground">
                      Resolver
                    </div>
                    <Input
                      value={currentVersion?.data.resolver ?? ""}
                      readOnly
                    />
                    <div className="text-[10px] text-muted-foreground">
                      值/查询
                    </div>
                    <Textarea
                      value={currentVersion?.data.value ?? ""}
                      readOnly
                      rows={8}
                    />
                  </div>
                </div>
              </ScrollArea>

              <ScrollArea className="h-full">
                <div className="p-4 space-y-3">
                  <div className="text-xs font-mono font-bold text-primary">
                    版本历史
                  </div>
                  <div className="space-y-2">
                    {selected.versions
                      .slice()
                      .reverse()
                      .map(v => (
                        <div
                          key={v.versionId}
                          className="rounded-md border border-border p-3"
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-xs font-mono">
                              {v.versionId}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                v.versionId === selected.currentVersionId
                              }
                              onClick={() => void handleRollback(v.versionId)}
                            >
                              回滚到此版本
                            </Button>
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-1">
                            {new Date(Number(v.createdAt)).toLocaleString()} ·{" "}
                            {v.data.type}
                          </div>
                          <div className="mt-2 text-[10px] text-muted-foreground">
                            {v.data.name}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </ScrollArea>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
