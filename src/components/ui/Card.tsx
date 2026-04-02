import type { PropsWithChildren, ReactNode } from 'react';

interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  extra?: ReactNode;
  className?: string;
}

export function Card({ title, subtitle, extra, children, className }: PropsWithChildren<CardProps>) {
  return (
    <div className={className ? `card ${className}` : 'card'}>
      {(title || subtitle || extra) && (
        <div className="card-header">
          <div>
            <div className="title">{title}</div>
            {subtitle ? <div className="text-secondary text-sm">{subtitle}</div> : null}
          </div>
          {extra}
        </div>
      )}
      {children}
    </div>
  );
}
