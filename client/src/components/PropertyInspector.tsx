import { useStore } from '@/lib/store';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Variable } from '@/lib/types';
import { useTranslation } from 'react-i18next';
import { shallow } from "zustand/shallow";

export default function PropertyInspector() {
  const { t } = useTranslation();
  const { selectedNodeId, nodes, updateNodeData, variables } = useStore(
    (state) => ({
      selectedNodeId: state.selectedNodeId,
      nodes: state.nodes,
      updateNodeData: state.updateNodeData,
      variables: state.variables,
    }),
    shallow
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  if (!selectedNode) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm p-4 text-center">
        {t('propertyInspector.empty')}
      </div>
    );
  }

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    const foundVars = newContent.match(/\{\{([^}]+)\}\}/g)?.map(v => v.slice(2, -2)) || [];
    
    const validVarIds = Array.from(
      new Set(
        foundVars
          .map((vName) => variables.find((v) => v.name === vName)?.id)
          .filter((id): id is string => Boolean(id))
      )
    );

    updateNodeData(selectedNode.id, { 
      content: newContent,
      variables: validVarIds
    });
  };

  const insertVariable = (v: Variable) => {
    const textarea = document.getElementById('node-content-editor') as HTMLTextAreaElement;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = selectedNode.data.content;
      const newText = text.substring(0, start) + `{{${v.name}}}` + text.substring(end);
      
      updateNodeData(selectedNode.id, { 
        content: newText,
        variables: Array.from(new Set([...(selectedNode.data.variables || []), v.id]))
      });
    }
  };

  return (
    <div className="h-full flex flex-col bg-card border-l border-border">
      <div className="p-4 border-b border-border">
        <h2 className="font-mono font-bold text-sm uppercase tracking-wider">{t('propertyInspector.title')}</h2>
        <div className="text-xs text-muted-foreground mt-1 font-mono">{selectedNode.id}</div>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-6">
          <div className="grid gap-2">
            <Label>{t('propertyInspector.label')}</Label>
            <Input 
              value={selectedNode.data.label} 
              onChange={(e) => updateNodeData(selectedNode.id, { label: e.target.value })}
            />
          </div>

          <div className="grid gap-2">
            <Label>{t('propertyInspector.type')}</Label>
            <Badge variant="outline" className="w-fit font-mono">
              {selectedNode.data.type}
            </Badge>
          </div>

          <div className="grid gap-2">
            <Label>{t('propertyInspector.description')}</Label>
            <Input 
              value={selectedNode.data.description || ''} 
              onChange={(e) => updateNodeData(selectedNode.id, { description: e.target.value })}
              className="text-xs"
            />
          </div>

          <Separator />

          <div className="grid gap-2">
            <div className="flex justify-between items-center">
              <Label>{t('propertyInspector.contentTemplate')}</Label>
              <span className="text-[10px] text-muted-foreground">{t('propertyInspector.supportsVar')}</span>
            </div>
            <Textarea 
              id="node-content-editor"
              value={selectedNode.data.content} 
              onChange={handleContentChange}
              className="font-mono text-xs min-h-[200px] resize-y"
            />
          </div>

          <div className="grid gap-2">
            <Label className="text-xs text-muted-foreground">{t('propertyInspector.insertVariable')}</Label>
            <div className="flex flex-wrap gap-1">
              {variables.map(v => (
                <Badge 
                  key={v.id} 
                  variant="secondary" 
                  className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                  onClick={() => insertVariable(v)}
                >
                  {v.name}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
