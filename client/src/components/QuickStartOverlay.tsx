import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CONTEXT_TEMPLATES } from "@/lib/templates";
import { useTranslation } from "react-i18next";

export default function QuickStartOverlay(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectTemplate: (templateId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("quickStart.title")}</DialogTitle>
          <DialogDescription>{t("quickStart.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {CONTEXT_TEMPLATES.map(tpl => (
            <div
              key={tpl.id}
              className="border rounded-md p-4 flex items-center justify-between gap-4"
            >
              <div className="grid gap-1">
                <div className="text-sm font-semibold">{tpl.name}</div>
                <div className="text-xs text-muted-foreground">
                  {tpl.description}
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => props.onSelectTemplate(tpl.id)}
              >
                {tpl.id === "minimal_runnable"
                  ? t("quickStart.useMinimalTemplate")
                  : t("quickStart.useTemplate")}
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
