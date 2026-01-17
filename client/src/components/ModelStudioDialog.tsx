import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createProvider,
  deleteProvider,
  listProviders,
  providerChatCompletions,
  providerEmbeddings,
  type Provider,
} from "@/lib/api/providers";

export function ModelStudioDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { open, onOpenChange } = props;

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Provider[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("siliconflow");
  const [createApiKey, setCreateApiKey] = useState("");
  const [createBaseUrl, setCreateBaseUrl] = useState("https://api.siliconflow.cn/v1");
  const [createChatModel, setCreateChatModel] = useState("deepseek-ai/DeepSeek-V3");
  const [createEmbeddingModel, setCreateEmbeddingModel] = useState("BAAI/bge-large-zh-v1.5");
  const [testEmbeddingOpen, setTestEmbeddingOpen] = useState(false);
  const [testEmbeddingText, setTestEmbeddingText] = useState("你好，世界");
  const [testChatOpen, setTestChatOpen] = useState(false);
  const [testChatText, setTestChatText] = useState("用一句话解释向量数据库是什么");

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await listProviders();
      setItems(list);
      if (!selectedId && list[0]) setSelectedId(list[0].id);
    } catch {
      toast.error(t("modelStudio.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setFilter("");
    setCreateOpen(false);
    setTestEmbeddingOpen(false);
    setTestChatOpen(false);
    void refresh();
  }, [open]);

  const filtered = items.filter(p =>
    `${p.name} ${p.provider} ${p.baseUrl}`
      .toLowerCase()
      .includes(filter.trim().toLowerCase())
  );

  const selected = items.find(p => p.id === selectedId) ?? null;

  const handleCreateSiliconFlow = async () => {
    const name = createName.trim();
    const apiKey = createApiKey.trim();
    const baseUrl = createBaseUrl.trim();
    const chatModel = createChatModel.trim();
    const embModel = createEmbeddingModel.trim();
    if (!name || !apiKey || !baseUrl) return;
    try {
      const created = await createProvider({
        name,
        provider: "siliconflow",
        baseUrl,
        apiKey,
        defaultChatModel: chatModel || undefined,
        defaultEmbeddingModel: embModel || undefined,
      });
      toast.success(t("modelStudio.created"));
      setItems(prev => [created, ...prev]);
      setSelectedId(created.id);
      setCreateOpen(false);
    } catch {
      toast.error(t("modelStudio.createFailed"));
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    if (!window.confirm(t("modelStudio.deleteConfirm"))) return;
    try {
      await deleteProvider(selectedId);
      toast.success(t("modelStudio.deleted"));
      setItems(prev => prev.filter(p => p.id !== selectedId));
      setSelectedId(null);
      setResult(null);
    } catch {
      toast.error(t("modelStudio.deleteFailed"));
    }
  };

  const handleTestEmbeddings = async () => {
    if (!selected) return;
    try {
      const res = await providerEmbeddings({
        providerId: selected.id,
        input: [testEmbeddingText],
      });
      setResult(res);
      toast.success(t("modelStudio.testOk"));
      setTestEmbeddingOpen(false);
    } catch {
      setResult(null);
      toast.error(t("modelStudio.testFailed"));
    }
  };

  const handleTestChat = async () => {
    if (!selected) return;
    try {
      const res = await providerChatCompletions({
        providerId: selected.id,
        messages: [
          { role: "user", content: testChatText, createdAt: String(Date.now()) },
        ],
      });
      setResult(res);
      toast.success(t("modelStudio.testOk"));
      setTestChatOpen(false);
    } catch {
      setResult(null);
      toast.error(t("modelStudio.testFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("modelStudio.title")}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-1 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {t("modelStudio.providers")}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCreateOpen(v => !v)}
              >
                {t("modelStudio.create")}
              </Button>
            </div>
            {createOpen && (
              <div className="rounded-md border border-border p-3 space-y-2">
                <div className="text-xs text-muted-foreground">
                  {t("modelStudio.create")}
                </div>
                <Input
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  placeholder={t("modelStudio.createPromptName")}
                  className="h-9 font-mono text-xs"
                />
                <Input
                  value={createApiKey}
                  onChange={e => setCreateApiKey(e.target.value)}
                  placeholder={t("modelStudio.createPromptApiKey")}
                  type="password"
                  className="h-9 font-mono text-xs"
                />
                <Input
                  value={createBaseUrl}
                  onChange={e => setCreateBaseUrl(e.target.value)}
                  placeholder={t("modelStudio.createPromptBaseUrl")}
                  className="h-9 font-mono text-xs"
                />
                <Input
                  value={createChatModel}
                  onChange={e => setCreateChatModel(e.target.value)}
                  placeholder={t("modelStudio.createPromptChatModel")}
                  className="h-9 font-mono text-xs"
                />
                <Input
                  value={createEmbeddingModel}
                  onChange={e => setCreateEmbeddingModel(e.target.value)}
                  placeholder={t("modelStudio.createPromptEmbeddingModel")}
                  className="h-9 font-mono text-xs"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => void handleCreateSiliconFlow()}
                    disabled={!createName.trim() || !createApiKey.trim() || !createBaseUrl.trim()}
                  >
                    {t("modelStudio.create")}
                  </Button>
                </div>
              </div>
            )}
            <Input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder={t("modelStudio.search")}
              className="h-9"
            />
            <ScrollArea className="h-[420px] rounded-md border border-border">
              <div className="p-2 space-y-1">
                {filtered.length === 0 ? (
                  <div className="text-xs text-muted-foreground p-2">
                    {loading
                      ? t("modelStudio.loading")
                      : t("modelStudio.empty")}
                  </div>
                ) : (
                  filtered.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={`w-full text-left rounded-md border border-border px-3 py-2 transition-colors ${
                        selectedId === p.id
                          ? "bg-muted"
                          : "bg-background/50 hover:bg-muted/50"
                      }`}
                    >
                      <div className="text-sm font-medium truncate">
                        {p.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {p.provider}
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">
                        {p.baseUrl}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void refresh()}
              disabled={loading}
            >
              {t("modelStudio.refresh")}
            </Button>
          </div>

          <div className="col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {t("modelStudio.actions")}
              </div>
              <div className="text-xs text-muted-foreground font-mono">
                {selected?.id ?? "-"}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setTestEmbeddingOpen(v => !v)}
                disabled={!selected}
              >
                {t("modelStudio.testEmbedding")}
              </Button>
              <Button
                variant="outline"
                onClick={() => setTestChatOpen(v => !v)}
                disabled={!selected}
              >
                {t("modelStudio.testChat")}
              </Button>
              <Button
                variant="outline"
                onClick={() => void handleDelete()}
                disabled={!selected}
              >
                {t("modelStudio.delete")}
              </Button>
            </div>
            {testEmbeddingOpen && (
              <div className="rounded-md border border-border p-3 space-y-2">
                <div className="text-xs text-muted-foreground">
                  {t("modelStudio.testEmbedding")}
                </div>
                <Textarea
                  value={testEmbeddingText}
                  onChange={e => setTestEmbeddingText(e.target.value)}
                  className="min-h-20 font-mono text-xs"
                />
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    onClick={() => void handleTestEmbeddings()}
                    disabled={!selected || !testEmbeddingText.trim()}
                  >
                    {t("modelStudio.testEmbedding")}
                  </Button>
                </div>
              </div>
            )}
            {testChatOpen && (
              <div className="rounded-md border border-border p-3 space-y-2">
                <div className="text-xs text-muted-foreground">
                  {t("modelStudio.testChat")}
                </div>
                <Textarea
                  value={testChatText}
                  onChange={e => setTestChatText(e.target.value)}
                  className="min-h-20 font-mono text-xs"
                />
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    onClick={() => void handleTestChat()}
                    disabled={!selected || !testChatText.trim()}
                  >
                    {t("modelStudio.testChat")}
                  </Button>
                </div>
              </div>
            )}

            <div className="rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground">
                {t("modelStudio.result")}
              </div>
              <pre className="mt-2 text-[11px] leading-5 overflow-auto max-h-[360px]">
                {result
                  ? JSON.stringify(result, null, 2)
                  : t("modelStudio.noResult")}
              </pre>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
