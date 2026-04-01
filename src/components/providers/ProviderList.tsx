import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

interface ProviderListProps<T> {
  items: T[];
  loading: boolean;
  keyField: (item: T, index: number) => string;
  renderContent: (item: T, index: number) => ReactNode;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  emptyTitle: string;
  emptyDescription: string;
  deleteLabel?: string;
  actionsDisabled?: boolean;
  getRowDisabled?: (item: T, index: number) => boolean;
  renderExtraActions?: (item: T, index: number) => ReactNode;
  containerClassName?: string;
  rowClassName?: string;
  metaClassName?: string;
  actionsClassName?: string;
}

export function ProviderList<T>({
  items,
  loading,
  keyField,
  renderContent,
  onEdit,
  onDelete,
  emptyTitle,
  emptyDescription,
  deleteLabel,
  actionsDisabled = false,
  getRowDisabled,
  renderExtraActions,
  containerClassName,
  rowClassName,
  metaClassName,
  actionsClassName,
}: ProviderListProps<T>) {
  const { t } = useTranslation();

  if (loading && items.length === 0) {
    return <div className="hint">{t('common.loading')}</div>;
  }

  if (!items.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className={containerClassName ? `item-list ${containerClassName}` : 'item-list'}>
      {items.map((item, index) => {
        const rowDisabled = getRowDisabled ? getRowDisabled(item, index) : false;
        const rowClassNames = ['item-row', rowClassName].filter(Boolean).join(' ');
        const metaClassNames = ['item-meta', metaClassName].filter(Boolean).join(' ');
        const actionsClassNames = ['item-actions', actionsClassName].filter(Boolean).join(' ');
        return (
          <div
            key={keyField(item, index)}
            className={rowClassNames}
            style={rowDisabled ? { opacity: 0.6 } : undefined}
          >
            <div className={metaClassNames}>{renderContent(item, index)}</div>
            <div className={actionsClassNames}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onEdit(index)}
                disabled={actionsDisabled}
              >
                {t('common.edit')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => onDelete(index)}
                disabled={actionsDisabled}
              >
                {deleteLabel || t('common.delete')}
              </Button>
              {renderExtraActions ? renderExtraActions(item, index) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
