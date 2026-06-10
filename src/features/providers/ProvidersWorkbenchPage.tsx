import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuthStore, useNotificationStore } from '@/stores';
import { useProviderRecentRequests } from '@/components/providers/hooks/useProviderRecentRequests';
import {
  getOpenAIProviderRecentWindowStats,
  getProviderRecentWindowStats,
  type ProviderRecentUsageMap,
} from '@/components/providers/utils';
import type { OpenAIProviderConfig } from '@/types';
import { ProviderHeaderCard } from './components/ProviderHeaderCard';
import { ProviderCategoryList } from './components/ProviderCategoryList';
import { ProviderResourcePanel } from './components/ProviderResourcePanel';
import type { ProviderPanelControls } from './components/ProviderResourcePanel';
import { ProviderSheet, type ProviderSheetHandle } from './sheets/ProviderSheet';
import { useProviderWorkbench } from './useProviderWorkbench';
import {
  getProviderFilterState,
  readProvidersWorkbenchUiState,
  writeProvidersWorkbenchUiState,
  type ProviderFilterState,
  type ProvidersWorkbenchUiState,
} from './uiState';
import type { ProviderBrand, ProviderResource, ProviderSortBy, SortDir } from './types';
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const getResourceModels = (resource: ProviderResource): string[] => {
  if (!isRecord(resource.raw)) return [];
  if (resource.brand === 'ampcode') {
    const mappings = resource.raw.modelMappings;
    if (!Array.isArray(mappings)) return [];
    const seen = new Set<string>();
    mappings.forEach((mapping) => {
      if (!isRecord(mapping)) return;
      const from = typeof mapping.from === 'string' ? mapping.from.trim() : '';
      const to = typeof mapping.to === 'string' ? mapping.to.trim() : '';
      if (from) seen.add(from);
      if (to) seen.add(to);
    });
    return Array.from(seen);
  }
  const models = resource.raw.models;
  if (!Array.isArray(models)) return [];
  const seen = new Set<string>();
  models.forEach((model) => {
    if (!isRecord(model)) return;
    const name = typeof model.name === 'string' ? model.name.trim() : '';
    if (name) seen.add(name);
  });
  return Array.from(seen);
};

const getResourcePriority = (resource: ProviderResource): number => {
  if (!isRecord(resource.raw)) return 0;
  const priority = resource.raw.priority;
  return typeof priority === 'number' && Number.isFinite(priority) ? priority : 0;
};

const getResourceSortName = (resource: ProviderResource): string =>
  (resource.name ?? resource.identifier ?? resource.apiKeyPreview ?? '').toLowerCase();

const getResourceRecentSuccess = (
  resource: ProviderResource,
  usageByProvider: ProviderRecentUsageMap
): number => {
  if (resource.brand === 'openaiCompatibility') {
    return getOpenAIProviderRecentWindowStats(
      resource.raw as OpenAIProviderConfig,
      usageByProvider
    ).success;
  }
  if (resource.brand === 'ampcode') return 0;
  return getProviderRecentWindowStats(
    usageByProvider,
    resource.brand,
    resource.apiKey ?? undefined,
    resource.baseUrl ?? undefined
  ).success;
};

export function ProvidersWorkbenchPage() {
  const { t, i18n } = useTranslation();
  const connectionStatus = useAuthStore((s) => s.connectionStatus);
  const { showNotification, showConfirmation } = useNotificationStore();

  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.status === 'current' : true;

  const workbench = useProviderWorkbench();
  const [uiState, setUiState] = useState<ProvidersWorkbenchUiState>(
    readProvidersWorkbenchUiState
  );
  const [sheetState, setSheetState] = useState<SheetState>({
    open: false,
    brand: 'gemini',
    mode: 'detail',
    resource: null,
  });
  const sheetRef = useRef<ProviderSheetHandle>(null);

  const connected = connectionStatus === 'connected';
  const { usageByProvider, refreshRecentRequests } = useProviderRecentRequests({
    enabled: connected,
  });

  const handleRefresh = useCallback(async () => {
    await Promise.allSettled([
      workbench.refetch(),
      refreshRecentRequests().catch(() => undefined),
    ]);
  }, [refreshRecentRequests, workbench]);

  useHeaderRefresh(handleRefresh, isCurrentLayer);

  const disableMutations = connectionStatus !== 'connected' || workbench.mutating;

  const persistUiState = useCallback(
    (updater: (prev: ProvidersWorkbenchUiState) => ProvidersWorkbenchUiState) => {
      setUiState((prev) => {
        const next = updater(prev);
        writeProvidersWorkbenchUiState(next);
        return next;
      });
    },
    []
  );

  const setActiveBrand = useCallback(
    (brand: ProviderBrand) => {
      persistUiState((prev) =>
        prev.activeBrand === brand ? prev : { ...prev, activeBrand: brand }
      );
    },
    [persistUiState]
  );

  const updateActiveFilterState = useCallback(
    (patch: Partial<ProviderFilterState>) => {
      persistUiState((prev) => {
        const brand = prev.activeBrand;
        const current = getProviderFilterState(prev, brand);
        return {
          ...prev,
          filtersByBrand: {
            ...prev.filtersByBrand,
            [brand]: {
              ...current,
              ...patch,
            },
          },
        };
      });
    },
    [persistUiState]
  );

  const groups = useMemo(() => workbench.snapshot?.groups ?? [], [workbench.snapshot]);
  const activeBrand = uiState.activeBrand;
  const activeFilterState = getProviderFilterState(uiState, activeBrand);
  const filter = activeFilterState.filter;
  const providerSortBy = activeFilterState.sortBy;
  const providerSortDir = activeFilterState.sortDir;
  const activeGroup =
    groups.find((g) => g.id === activeBrand) ?? groups[0] ?? null;

  const filteredResources = useMemo(() => {
    if (!activeGroup) return [];
    const normalized = filter.trim().toLowerCase();
    return activeGroup.resources.filter((r) => matchesFilter(r, normalized));
  }, [activeGroup, filter]);

  const availableModels = useMemo(() => {
    if (!activeGroup) return [];
    const seen = new Set<string>();
    activeGroup.resources.forEach((r) => {
      getResourceModels(r).forEach((name) => seen.add(name));
    });
    return Array.from(seen).sort();
  }, [activeGroup]);

  const selectedModels = useMemo(() => {
    if (availableModels.length === 0) return new Set<string>();
    const availableModelSet = new Set(availableModels);
    return new Set(
      activeFilterState.selectedModels.filter((name) => availableModelSet.has(name))
    );
  }, [activeFilterState.selectedModels, availableModels]);

  const visibleResources = useMemo(() => {
    let arr = filteredResources;
    if (selectedModels.size > 0) {
      arr = arr.filter((r) => {
        const models = getResourceModels(r);
        return models.some((name) => selectedModels.has(name));
      });
    }

    const sorted = [...arr].sort((a, b) => {
      let diff = 0;
      if (providerSortBy === 'name') {
        diff = getResourceSortName(a).localeCompare(getResourceSortName(b));
      } else if (providerSortBy === 'priority') {
        const ap = getResourcePriority(a);
        const bp = getResourcePriority(b);
        diff = ap - bp;
      } else {
        diff =
          getResourceRecentSuccess(a, usageByProvider) -
          getResourceRecentSuccess(b, usageByProvider);
      }
      if (diff === 0) {
        diff = a.originalIndex - b.originalIndex;
      }
      return providerSortDir === 'asc' ? diff : -diff;
    });

    return sorted;
  }, [
    filteredResources,
    providerSortBy,
    providerSortDir,
    selectedModels,
    usageByProvider,
  ]);

  const toolbarControls = useMemo<ProviderPanelControls | undefined>(() => {
    if (!activeGroup) return undefined;
    return {
      sortBy: providerSortBy,
      sortDir: providerSortDir,
      onSortBy: (value: ProviderSortBy) => updateActiveFilterState({ sortBy: value }),
      onSortDir: (value: SortDir) => updateActiveFilterState({ sortDir: value }),
      availableModels,
      selectedModels,
      onSelectedModelsChange: (next) =>
        updateActiveFilterState({
          selectedModels: Array.from(next).sort((a, b) => a.localeCompare(b)),
        }),
    };
  }, [
    activeGroup,
    availableModels,
    providerSortBy,
    providerSortDir,
    selectedModels,
    updateActiveFilterState,
  ]);

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

  const handleToggleDisabled = useCallback(
    async (resource: ProviderResource, disabled: boolean) => {
      try {
        await workbench.toggleDisabled(resource, disabled);
        showNotification(
          disabled
            ? t('providersPage.toast.disabled')
            : t('providersPage.toast.enabled'),
          'success'
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showNotification(
          `${t('providersPage.toast.toggleFailed')}: ${msg}`,
          'error'
        );
      }
    },
    [showNotification, t, workbench]
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
            const isSwitching = sheetState.open && sheetState.brand !== brand;
            const proceed = isSwitching && sheetRef.current
              ? sheetRef.current.confirmDiscardIfDirty()
              : Promise.resolve(true);
            void proceed.then((ok) => {
              if (!ok) return;
              setActiveBrand(brand);
              if (isSwitching) {
                closeSheet();
              }
            });
          }}
        />
        <ProviderResourcePanel
          group={activeGroup}
          filter={filter}
          onFilterChange={(value) => updateActiveFilterState({ filter: value })}
          filteredResources={visibleResources}
          selectedId={sheetState.open ? sheetState.resource?.id ?? null : null}
          disableMutations={disableMutations}
          usageByProvider={usageByProvider}
          toolbarControls={toolbarControls}
          onView={openView}
          onEdit={openEdit}
          onDelete={handleDelete}
          onToggleDisabled={handleToggleDisabled}
          onCreate={openCreate}
        />
      </div>

      <ProviderSheet
        ref={sheetRef}
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
        mutationDisabled={disableMutations}
        usageByProvider={usageByProvider}
      />
    </div>
  );
}
