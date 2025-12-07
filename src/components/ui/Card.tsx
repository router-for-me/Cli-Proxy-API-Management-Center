import type { PropsWithChildren, ReactNode } from 'react';

interface CardProps {
  title?: ReactNode;
  extra?: ReactNode;
}

export function Card({ title, extra, children }: PropsWithChildren<CardProps>) {
  return (
    <div className="card">
      {(title || extra) && (
        <div className="card-header">
          <div className="title">{title}</div>
          {extra}
        </div>
      )}
      {children}
    </div>
  );
}
