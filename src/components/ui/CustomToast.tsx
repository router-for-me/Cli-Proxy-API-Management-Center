import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import type { NotificationType } from '@/types';

const typeConfig = {
  success: { icon: '✓', label: 'SUCCESS', color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', barColor: 'bg-emerald-500' },
  error: { icon: '✕', label: 'ERROR', color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20', barColor: 'bg-red-500' },
  warning: { icon: '!', label: 'WARNING', color: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/20', barColor: 'bg-amber-500' },
  info: { icon: 'i', label: 'INFO', color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/20', barColor: 'bg-primary' },
};

interface CustomToastProps {
  t: string | number;
  message: string;
  type: NotificationType;
}

function CustomToast({ t, message, type }: CustomToastProps) {
  const config = typeConfig[type] || typeConfig.info;
  
  return (
    <div className="flex flex-col w-[320px] bg-card border border-border shadow-xl relative overflow-hidden font-mono">
      <div className="flex gap-3 p-3">
        <div className="relative shrink-0">
          <div className={`absolute inset-0 ${config.bg} rounded blur-sm`} />
          <div className={`relative flex items-center justify-center w-8 h-8 bg-card border ${config.border} ${config.color} rounded shadow-sm font-bold text-sm`}>
            {config.icon}
          </div>
        </div>
        <div className="flex-1 min-w-0 pt-1">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-xs font-bold text-foreground tracking-wide">{config.label}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toast.dismiss(t)}
              className="size-6 p-0 -mt-1 -mr-1 text-muted-foreground/70 hover:text-foreground"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{message}</p>
        </div>
      </div>
      <div className="h-0.5 bg-muted w-full">
        <div className={`h-full ${config.barColor} animate-shrink-width`} onAnimationEnd={() => toast.dismiss(t)} />
      </div>
    </div>
  );
}

export function showCustomToast(message: string, type: NotificationType = 'info') {
  toast.custom((t) => <CustomToast t={t} message={message} type={type} />, { duration: 1000 });
}
