import type { PropsWithChildren, ReactNode } from 'react';
import { Card } from '@/components/ui/Card';

interface ConfigSectionProps {
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}

export function ConfigSection({ title, description, className, children }: PropsWithChildren<ConfigSectionProps>) {
  return (
    <Card title={title} className={className}>
      {description && (
        <p style={{ margin: '-4px 0 16px 0', color: 'var(--text-secondary)', fontSize: 13 }}>
          {description}
        </p>
      )}
      {children}
    </Card>
  );
}

