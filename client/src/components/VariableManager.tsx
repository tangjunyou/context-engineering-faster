import { useStore } from '@/lib/store';
import { Variable } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Trash2, Edit2, Save, X } from 'lucide-react';
import { useMemo, useState } from "react";
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { shallow } from "zustand/shallow";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

export default function VariableManager() {
  const { t } = useTranslation();
  const { variables, addVariable, updateVariable, deleteVariable } = useStore(
    (state) => ({
      variables: state.variables,
      addVariable: state.addVariable,
      updateVariable: state.updateVariable,
      deleteVariable: state.deleteVariable,
    }),
    shallow
  );

  const [editingId, setEditingId] = useState<string | null>(null);

  const variableSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("variableManager.validation.nameRequired")),
        type: z.enum(["static", "dynamic"]),
        value: z.string(),
      }),
    [t]
  );

  type VariableFormValues = z.infer<typeof variableSchema>;

  const form = useForm<VariableFormValues>({
    resolver: zodResolver(variableSchema),
    defaultValues: { name: "", type: "static", value: "" },
    mode: "onChange",
  });

  const handleEdit = (v: Variable) => {
    setEditingId(v.id);
    form.reset({
      name: v.name,
      type: v.type,
      value: v.value ?? "",
    });
  };

  const submit = form.handleSubmit((values) => {
    if (!editingId) return;
    const original = variables.find((v) => v.id === editingId);
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
                <Form {...form}>
                  <form onSubmit={submit} className="space-y-3">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">{t("variableManager.name")}</FormLabel>
                          <FormControl>
                            <Input {...field} className="h-8 font-mono text-xs" />
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
                          <FormLabel className="text-xs">{t("variableManager.type")}</FormLabel>
                          <FormControl>
                            <div className="flex gap-2">
                              <Badge
                                variant={field.value === "static" ? "default" : "outline"}
                                className="cursor-pointer"
                                onClick={() => field.onChange("static")}
                              >
                                {t("variableManager.static")}
                              </Badge>
                              <Badge
                                variant={field.value === "dynamic" ? "default" : "outline"}
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
                          <FormLabel className="text-xs">{t("variableManager.valueExample")}</FormLabel>
                          <FormControl>
                            <Input {...field} className="h-8 font-mono text-xs" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

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
                      <Button type="submit" size="icon" variant="default" className="h-6 w-6">
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
