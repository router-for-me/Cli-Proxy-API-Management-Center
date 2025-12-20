import type { PropsWithChildren, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface CardProps {
  title?: ReactNode;
  extra?: ReactNode;
  className?: string;
}

export function Card({ title, extra, children, className }: PropsWithChildren<CardProps>) {
  return (
    <div className={cn(
      "ring-foreground/10 bg-card text-card-foreground rounded-none ring-1 flex flex-col",
      className
    )}>
      {(title || extra) && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border">
          <div className="text-sm font-medium">{title}</div>
          {extra}
        </div>
      )}
      <div className="p-4 text-xs flex-1 flex flex-col min-h-0">{children}</div>
    </div>
  );
}
