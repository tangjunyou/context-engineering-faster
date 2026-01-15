import { Handle, Position, NodeProps } from '@xyflow/react';
import type { Node } from '@xyflow/react';
import { cn } from '@/lib/utils';
import type { ContextNodeData } from '@/lib/types';
import { useTranslation } from 'react-i18next';
import { 
  Bot, 
  Wrench, 
  Database, 
  MessageSquare, 
  Info, 
  User,
  MoreHorizontal
} from 'lucide-react';

const typeIcons = {
  system_prompt: Bot,
  tools: Wrench,
  memory: Database,
  messages: MessageSquare,
  metadata: Info,
  user_input: User,
  retrieval: Database, // Fallback
};

const typeColors = {
  system_prompt: 'border-chart-1 bg-chart-1/10 text-chart-1',
  tools: 'border-chart-2 bg-chart-2/10 text-chart-2',
  memory: 'border-chart-3 bg-chart-3/10 text-chart-3',
  retrieval: 'border-chart-4 bg-chart-4/10 text-chart-4',
  messages: 'border-chart-5 bg-chart-5/10 text-chart-5',
  metadata: 'border-chart-1 bg-chart-1/10 text-chart-1',
  user_input: 'border-chart-5 bg-chart-5/10 text-chart-5',
};

export default function ContextNode({ data, selected }: NodeProps<Node<ContextNodeData>>) {
  const { t } = useTranslation();
  const Icon = typeIcons[data.type as keyof typeof typeIcons] || MoreHorizontal;
  const colorClass = typeColors[data.type as keyof typeof typeColors] || 'border-border bg-card';

  return (
    <div className={cn(
      "w-64 rounded-md border-2 shadow-lg transition-all duration-200",
      "bg-card hover:shadow-xl",
      selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "",
      colorClass
    )}>
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-foreground border-2 border-background" />
      
      <div className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <div className={cn("p-1.5 rounded-md bg-background/50 backdrop-blur-sm")}>
            <Icon size={16} />
          </div>
          <span className="font-mono text-sm font-bold uppercase tracking-wider opacity-90">
            {data.label}
          </span>
        </div>
        
        <div className="text-xs opacity-70 line-clamp-3 font-mono bg-background/30 p-2 rounded">
          {data.content || t('contextNode.empty')}
        </div>

        {data.variables && data.variables.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {data.variables.map((v: string) => (
              <span key={v} className="text-[10px] px-1.5 py-0.5 rounded-full bg-background/50 border border-border/50 opacity-80">
                {v}
              </span>
            ))}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-foreground border-2 border-background" />
    </div>
  );
}
