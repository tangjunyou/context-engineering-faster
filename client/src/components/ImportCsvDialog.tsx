import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { importCsvToSqliteDataSource } from "@/lib/api/imports";

export function ImportCsvDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataSourceId: string;
}) {
  const { t } = useTranslation();
  const { open, onOpenChange, dataSourceId } = props;
  const [table, setTable] = useState("imported");
  const [header, setHeader] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTable("imported");
    setHeader(true);
    setFile(null);
    setIsImporting(false);
  }, [open]);

  const canImport = useMemo(
    () => Boolean(file) && table.trim().length > 0,
    [file, table]
  );

  const handleImport = async () => {
    if (!file) return;
    const tableName = table.trim();
    if (!tableName) return;
    setIsImporting(true);
    try {
      const res = await importCsvToSqliteDataSource({
        dataSourceId,
        table: tableName,
        header,
        file,
      });
      toast.success(t("imports.imported", { n: res.insertedRows }));
      onOpenChange(false);
    } catch (e) {
      toast.error(t("imports.importFailed"));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("imports.title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            {t("imports.hint")}
          </div>

          <div className="space-y-1">
            <div className="text-xs">{t("imports.table")}</div>
            <Input
              value={table}
              onChange={e => setTable(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <div className="text-sm">{t("imports.header")}</div>
              <div className="text-xs text-muted-foreground">
                {t("imports.headerHint")}
              </div>
            </div>
            <Switch checked={header} onCheckedChange={setHeader} />
          </div>

          <div className="space-y-1">
            <div className="text-xs">{t("imports.file")}</div>
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="h-9"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("imports.cancel")}
            </Button>
            <Button
              onClick={() => void handleImport()}
              disabled={!canImport || isImporting}
            >
              {isImporting ? t("imports.importing") : t("imports.import")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
