import { useStore } from '@/lib/store';
import { Variable } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Trash2, Edit2, Save, X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

export default function VariableManager() {
  const { t } = useTranslation();
  const variables = useStore((state) => state.variables);
  const addVariable = useStore((state) => state.addVariable);
  const updateVariable = useStore((state) => state.updateVariable);
  const deleteVariable = useStore((state) => state.deleteVariable);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Variable>>({});

  const handleEdit = (v: Variable) => {
    setEditingId(v.id);
    setEditForm(v);
  };

  const handleSave = () => {
    if (editingId && editForm.name) {
      updateVariable(editForm as Variable);
      setEditingId(null);
      setEditForm({});
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleAdd = () => {
    const newVar: Variable = {
      id: `var_${Date.now()}`,
      name: 'new_variable',
      type: 'static',
      value: '',
      source: t('variableManager.userDefined')
    };
    addVariable(newVar);
    handleEdit(newVar);
  };

  return (
    <div className="h-full flex flex-col bg-card border-l border-border">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className="font-mono font-bold text-sm uppercase tracking-wider">{t('variableManager.title')}</h2>
        <Button size="sm" variant="outline" onClick={handleAdd}>
          <Plus className="w-4 h-4 mr-1" /> {t('variableManager.add')}
        </Button>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {variables.map((v) => (
            <div key={v.id} className={cn(
              "p-3 rounded-md border border-border bg-background/50 transition-all",
              editingId === v.id ? "ring-2 ring-primary" : "hover:border-primary/50"
            )}>
              {editingId === v.id ? (
                <div className="space-y-3">
                  <div className="grid gap-2">
                    <Label className="text-xs">{t('variableManager.name')}</Label>
                    <Input 
                      value={editForm.name} 
                      onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-xs">{t('variableManager.type')}</Label>
                    <div className="flex gap-2">
                      <Badge 
                        variant={editForm.type === 'static' ? 'default' : 'outline'}
                        className="cursor-pointer"
                        onClick={() => setEditForm({...editForm, type: 'static'})}
                      >
                        {t('variableManager.static')}
                      </Badge>
                      <Badge 
                        variant={editForm.type === 'dynamic' ? 'default' : 'outline'}
                        className="cursor-pointer"
                        onClick={() => setEditForm({...editForm, type: 'dynamic'})}
                      >
                        {t('variableManager.dynamic')}
                      </Badge>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-xs">{t('variableManager.valueExample')}</Label>
                    <Input 
                      value={editForm.value} 
                      onChange={(e) => setEditForm({...editForm, value: e.target.value})}
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                  <div className="flex justify-end gap-2 mt-2">
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleCancel}>
                      <X className="w-3 h-3" />
                    </Button>
                    <Button size="icon" variant="default" className="h-6 w-6" onClick={handleSave}>
                      <Save className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between group">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm font-bold text-primary">
                        {`{{${v.name}}}`}
                      </span>
                      <Badge variant="secondary" className="text-[10px] h-4 px-1">
                        {v.type}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                      {v.value || t('variableManager.noValue')}
                    </div>
                    <div className="text-[10px] text-muted-foreground/70 mt-1">
                      {t('variableManager.source')}: {v.source}
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleEdit(v)}>
                      <Edit2 className="w-3 h-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => deleteVariable(v.id)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
