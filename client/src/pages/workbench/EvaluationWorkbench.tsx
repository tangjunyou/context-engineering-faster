import WorkbenchLayout from "@/components/WorkbenchLayout";
import { useTranslation } from "react-i18next";

export default function EvaluationWorkbench() {
  const { t } = useTranslation();

  return (
    <WorkbenchLayout title={t("workbench.evaluation")}>
      <div className="h-full p-4">
        <div className="h-full rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
          {t("workbench.evaluationHint")}
        </div>
      </div>
    </WorkbenchLayout>
  );
}
