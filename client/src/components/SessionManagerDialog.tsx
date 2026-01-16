import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  appendSessionMessages,
  createSession,
  getSession,
  listSessions,
  type SessionDoc,
  type SessionMessage,
  type SessionSummary,
} from "@/lib/api/sessions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

export function SessionManagerDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { open, onOpenChange } = props;

  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isAppending, setIsAppending] = useState(false);

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );
  const [selectedSession, setSelectedSession] = useState<SessionDoc | null>(
    null
  );

  const [newName, setNewName] = useState("");
  const [role, setRole] = useState<SessionMessage["role"]>("user");
  const [content, setContent] = useState("");

  useEffect(() => {
    if (!open) return;
    setIsLoading(true);
    listSessions()
      .then(list => {
        setSessions(list);
        if (selectedSessionId) return;
        const first = list
          .slice()
          .sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))[0];
        if (first) setSelectedSessionId(first.id);
      })
      .catch(() => toast.error(t("sessions.loadFailed")))
      .finally(() => setIsLoading(false));
  }, [open, selectedSessionId, t]);

  useEffect(() => {
    if (!open) return;
    if (!selectedSessionId) {
      setSelectedSession(null);
      return;
    }
    setIsLoading(true);
    getSession(selectedSessionId)
      .then(setSelectedSession)
      .catch(() => toast.error(t("sessions.loadFailed")))
      .finally(() => setIsLoading(false));
  }, [open, selectedSessionId, t]);

  const sortedSessions = useMemo(
    () =>
      sessions
        .slice()
        .sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt)),
    [sessions]
  );

  const refreshList = async () => {
    setIsLoading(true);
    try {
      const list = await listSessions();
      setSessions(list);
    } catch {
      toast.error(t("sessions.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim() || t("sessions.untitled");
    setIsCreating(true);
    try {
      const s = await createSession({ name });
      setNewName("");
      setSelectedSessionId(s.id);
      await refreshList();
      toast.success(t("sessions.created"));
    } catch {
      toast.error(t("sessions.createFailed"));
    } finally {
      setIsCreating(false);
    }
  };

  const handleAppend = async () => {
    if (!selectedSession) return;
    const text = content.trim();
    if (!text) return;
    setIsAppending(true);
    try {
      const msg: SessionMessage = {
        role,
        content: text,
        createdAt: Date.now().toString(),
      };
      const updated = await appendSessionMessages({
        sessionId: selectedSession.id,
        messages: [msg],
      });
      setSelectedSession(updated);
      setContent("");
      await refreshList();
      toast.success(t("sessions.appended"));
    } catch {
      toast.error(t("sessions.appendFailed"));
    } finally {
      setIsAppending(false);
    }
  };

  const handleCopyResolver = async () => {
    if (!selectedSession) return;
    await navigator.clipboard.writeText(`chat://${selectedSession.id}`);
    toast.success(t("sessions.copiedResolver"));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("sessions.title")}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                {t("sessions.new")}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder={t("sessions.namePlaceholder")}
                  className="h-9"
                />
                <Button
                  onClick={() => void handleCreate()}
                  disabled={isCreating}
                >
                  {isCreating ? t("sessions.creating") : t("sessions.create")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void refreshList()}
                  disabled={isLoading}
                >
                  {t("sessions.refresh")}
                </Button>
              </div>
            </div>

            <ScrollArea className="h-[320px] rounded-md border border-border">
              <div className="p-2 space-y-2">
                {sortedSessions.length === 0 ? (
                  <div className="text-xs text-muted-foreground p-2">
                    {isLoading ? t("sessions.loading") : t("sessions.empty")}
                  </div>
                ) : (
                  sortedSessions.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedSessionId(s.id)}
                      className={`w-full text-left rounded-md border border-border px-3 py-2 transition-colors ${
                        selectedSessionId === s.id
                          ? "bg-muted"
                          : "bg-background/50 hover:bg-muted/50"
                      }`}
                    >
                      <div className="text-sm font-medium truncate">
                        {s.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">
                        {s.id}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {t("sessions.detail")}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleCopyResolver()}
                  disabled={!selectedSession}
                >
                  {t("sessions.copyResolver")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!selectedSessionId) return;
                    setIsLoading(true);
                    getSession(selectedSessionId)
                      .then(setSelectedSession)
                      .catch(() => toast.error(t("sessions.loadFailed")))
                      .finally(() => setIsLoading(false));
                  }}
                  disabled={!selectedSessionId || isLoading}
                >
                  {t("sessions.reload")}
                </Button>
              </div>
            </div>

            <div className="rounded-md border border-border bg-background/50 p-3">
              <div className="text-sm font-medium truncate">
                {selectedSession?.name ?? t("sessions.noSelection")}
              </div>
              <div className="text-[11px] text-muted-foreground font-mono truncate">
                {selectedSession?.id ?? ""}
              </div>
            </div>

            <ScrollArea className="h-[210px] rounded-md border border-border">
              <div className="p-3 space-y-2">
                {selectedSession?.messages?.length ? (
                  selectedSession.messages.map((m, idx) => (
                    <div
                      key={`${m.createdAt}_${idx}`}
                      className="rounded-md border border-border p-2"
                    >
                      <div className="text-[11px] text-muted-foreground font-mono">
                        {m.role} · {m.createdAt}
                      </div>
                      <div className="text-sm whitespace-pre-wrap">
                        {m.content}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-muted-foreground">
                    {selectedSession
                      ? t("sessions.noMessages")
                      : t("sessions.noSelection")}
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="rounded-md border border-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={role === "user" ? "default" : "outline"}
                  onClick={() => setRole("user")}
                >
                  user
                </Button>
                <Button
                  size="sm"
                  variant={role === "assistant" ? "default" : "outline"}
                  onClick={() => setRole("assistant")}
                >
                  assistant
                </Button>
                <Button
                  size="sm"
                  variant={role === "system" ? "default" : "outline"}
                  onClick={() => setRole("system")}
                >
                  system
                </Button>
              </div>
              <Textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder={t("sessions.messagePlaceholder")}
                className="min-h-20"
              />
              <div className="flex justify-end">
                <Button
                  onClick={() => void handleAppend()}
                  disabled={!selectedSession || isAppending}
                >
                  {isAppending ? t("sessions.appending") : t("sessions.append")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
