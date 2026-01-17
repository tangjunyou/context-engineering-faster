import WorkbenchLayout from "@/components/WorkbenchLayout";
import DataSourceCenter from "@/components/DataSourceCenter";

export default function DataSourcesWorkbench() {
  return (
    <WorkbenchLayout title="数据源中心">
      <DataSourceCenter />
    </WorkbenchLayout>
  );
}
