import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuthStore, useNotificationStore } from '@/stores';
import { ProviderHeaderCard } from './components/ProviderHeaderCard';
import { ProviderCategoryList } from './components/ProviderCategoryList';
import { ProviderResourcePanel } from './components/ProviderResourcePanel';
import { ProviderSheet } from './sheets/ProviderSheet';
import { useProviderWorkbench } from './useProviderWorkbench';
import type { ProviderBrand, ProviderResource } from './types';
import styles from './ProvidersWorkbenchPage.module.scss';

type SheetMode = 'detail' | 'create' | 'edit';

interface SheetState {
  open: boolean;
  brand: ProviderBrand;
  mode: SheetMode;
  resource: ProviderResource | null;
}

const formatDateTime = (iso: string, locale?: string) => {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return iso;
  }
};

const matchesFilter = (r: ProviderResource, normalized: string): boolean => {
  if (!normalized) return true;
  const haystack = [
    r.identifier,
    r.name,
    r.authIndex,
    r.apiKeyPreview,
    r.apiKey,
    r.baseUrl,
    r.proxyUrl,
    r.prefix,
  ]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());
  return haystack.some((v) => v.includes(normalized));
};

export function ProvidersWorkbenchPage() {
  const { t, i18n } = useTranslation();
  const connectionStatus = useAuthStore((s) => s.connectionStatus);
  const { showNotification, showConfirmation } = useNotificationStore();

  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.status === 'current' : true;

  const workbench = useProviderWorkbench();
  const [activeBrand, setActiveBrand] = useState<ProviderBrand>('gemini');
  const [filter, setFilter] = useState('');
  const [sheetState, setSheetState] = useState<SheetState>({
    open: false,
    brand: 'gemini',
    mode: 'detail',
    resource: null,
  });

  const handleRefresh = useCallback(async () => {
    await workbench.refetch();
  }, [workbench]);

  useHeaderRefresh(handleRefresh, isCurrentLayer);

  const disableMutations = connectionStatus !== 'connected' || workbench.mutating;

  const groups = useMemo(() => workbench.snapshot?.groups ?? [], [workbench.snapshot]);
  const activeGroup =
    groups.find((g) => g.id === activeBrand) ?? groups[0] ?? null;

  const filteredResources = useMemo(() => {
    if (!activeGroup) return [];
    const normalized = filter.trim().toLowerCase();
    return activeGroup.resources.filter((r) => matchesFilter(r, normalized));
  }, [activeGroup, filter]);

  const totalResources = useMemo(
    () =>
      groups.reduce(
        (sum, g) => sum + g.resources.filter((r) => !r.flags.isPlaceholder).length,
        0
      ),
    [groups]
  );

  const totalActive = useMemo(
    () =>
      groups.reduce(
        (sum, g) =>
          sum +
          g.resources.filter((r) => !r.disabled && !r.flags.isPlaceholder).length,
        0
      ),
    [groups]
  );

  const providerFamilies = useMemo(
    () =>
      groups.filter(
        (g) => g.resources.some((r) => !r.flags.isPlaceholder)
      ).length,
    [groups]
  );

  const updatedAtLabel = workbench.snapshot
    ? formatDateTime(workbench.snapshot.fetchedAt, i18n.language)
    : t('providersPage.modelCatalog.notLoaded');

  const openCreate = useCallback(() => {
    const brand = activeBrand;
    if (brand === 'ampcode') {
      // ampcode 走单例编辑
      const r =
        groups.find((g) => g.id === 'ampcode')?.resources[0] ?? null;
      setSheetState({ open: true, brand: 'ampcode', mode: 'edit', resource: r });
    } else {
      setSheetState({ open: true, brand, mode: 'create', resource: null });
    }
  }, [activeBrand, groups]);

  const openView = useCallback((resource: ProviderResource) => {
    setSheetState({
      open: true,
      brand: resource.brand,
      mode: 'detail',
      resource,
    });
  }, []);

  const openEdit = useCallback((resource: ProviderResource) => {
    setSheetState({
      open: true,
      brand: resource.brand,
      mode: 'edit',
      resource,
    });
  }, []);

  const closeSheet = useCallback(() => {
    setSheetState((s) => ({ ...s, open: false }));
  }, []);

  const handleDelete = useCallback(
    (resource: ProviderResource) => {
      const isAmpcode = resource.brand === 'ampcode';
      const name =
        resource.name ?? resource.apiKeyPreview ?? resource.identifier ?? '';
      showConfirmation({
        title: isAmpcode
          ? t('providersPage.delete.ampcodeTitle')
          : t('providersPage.delete.title'),
        message: isAmpcode
          ? t('providersPage.delete.ampcodeConfirm')
          : t('providersPage.delete.confirm', { name }),
        variant: 'danger',
        confirmText: isAmpcode
          ? t('providersPage.actions.clear')
          : t('providersPage.actions.delete'),
        onConfirm: async () => {
          try {
            await workbench.deleteProvider(resource);
            showNotification(t('providersPage.toast.deleted'), 'success');
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            showNotification(`${t('notification.delete_failed')}: ${msg}`, 'error');
          }
        },
      });
    },
    [showConfirmation, showNotification, t, workbench]
  );

  const handleCreated = useCallback(() => {
    showNotification(t('providersPage.toast.created'), 'success');
    closeSheet();
  }, [closeSheet, showNotification, t]);

  const handleUpdated = useCallback(() => {
    showNotification(t('providersPage.toast.updated'), 'success');
    closeSheet();
  }, [closeSheet, showNotification, t]);

  // 加载状态
  if (!workbench.snapshot && workbench.isPending) {
    return (
      <div className={styles.page}>
        <Skeleton height={120} />
        <div className={styles.layout}>
          <Skeleton height={420} />
          <Skeleton height={420} />
        </div>
      </div>
    );
  }

  if (!activeGroup) {
    return (
      <div className={styles.page}>
        <ProviderHeaderCard
          totalActive={0}
          totalResources={0}
          providerFamilies={0}
          updatedAtLabel={updatedAtLabel}
          isFetching={workbench.isFetching}
          onRefresh={() => void handleRefresh()}
          onNew={() => {}}
          isNewDisabled
        />
      </div>
    );
  }

  const ampcodeBrandActive = activeBrand === 'ampcode';

  return (
    <div className={styles.page}>
      <ProviderHeaderCard
        totalActive={totalActive}
        totalResources={totalResources}
        providerFamilies={providerFamilies}
        updatedAtLabel={updatedAtLabel}
        issueCount={workbench.snapshot?.issues.length ?? 0}
        isFetching={workbench.isFetching}
        isNewDisabled={disableMutations && !ampcodeBrandActive}
        newLabel={
          ampcodeBrandActive
            ? t('providersPage.actions.edit')
            : t('providersPage.actions.new')
        }
        onRefresh={() => void handleRefresh()}
        onNew={openCreate}
      />

      <div className={styles.layout}>
        <ProviderCategoryList
          groups={groups}
          activeBrand={activeGroup.id}
          onSelect={(brand) => {
            setActiveBrand(brand);
            setFilter('');
            // 关闭 Sheet 以避免数据错位
            if (sheetState.open && sheetState.brand !== brand) {
              closeSheet();
            }
          }}
        />
        <ProviderResourcePanel
          group={activeGroup}
          filter={filter}
          onFilterChange={setFilter}
          filteredResources={filteredResources}
          selectedId={sheetState.open ? sheetState.resource?.id ?? null : null}
          disableMutations={disableMutations}
          onView={openView}
          onEdit={openEdit}
          onDelete={handleDelete}
          onCreate={openCreate}
        />
      </div>

      <ProviderSheet
        state={sheetState}
        onClose={closeSheet}
        onSwitchToEdit={() => {
          setSheetState((s) =>
            s.resource ? { ...s, mode: 'edit' } : s
          );
        }}
        workbench={workbench}
        onCreated={handleCreated}
        onUpdated={handleUpdated}
      />
    </div>
  );
}
