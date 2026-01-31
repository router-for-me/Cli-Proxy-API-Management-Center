import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { OAuthModelAliasEntry } from '@/types';
import { useThemeStore } from '@/stores';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconTrash2 } from '@/components/ui/icons';
import styles from './ModelMappingDiagram.module.scss';

// Type definition for models from API
export interface AuthFileModelItem {
  id: string;
  display_name?: string;
  type?: string;
  owned_by?: string;
}

export interface ModelMappingDiagramProps {
  modelAlias: Record<string, OAuthModelAliasEntry[]>;
  allProviderModels?: Record<string, AuthFileModelItem[]>;
  onUpdate?: (provider: string, sourceModel: string, newAlias: string) => void;
  onDeleteLink?: (provider: string, sourceModel: string, alias: string) => void;
  onToggleFork?: (provider: string, sourceModel: string, alias: string, fork: boolean) => void;
  onRenameAlias?: (oldAlias: string, newAlias: string) => void;
  onDeleteAlias?: (alias: string) => void;
  onEditProvider?: (provider: string) => void;
  onDeleteProvider?: (provider: string) => void;
  className?: string;
}

// Helper to generate consistent colors
const PROVIDER_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', 
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'
];

function getProviderColor(provider: string): string {
  const hash = provider.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return PROVIDER_COLORS[hash % PROVIDER_COLORS.length];
}

interface SourceNode {
  id: string; // unique: provider::name
  provider: string;
  name: string;
  aliases: { alias: string; fork: boolean }[]; // all aliases this source maps to
}

interface AliasNode {
  id: string; // alias
  alias: string;
  sources: SourceNode[];
}

interface ContextMenuState {
  x: number;
  y: number;
  type: 'alias' | 'background' | 'provider' | 'source';
  data?: string;
}

export interface ModelMappingDiagramRef {
  collapseAll: () => void;
  refreshLayout: () => void;
}

export const ModelMappingDiagram = forwardRef<ModelMappingDiagramRef, ModelMappingDiagramProps>(function ModelMappingDiagram({ 
  modelAlias, 
  allProviderModels = {}, 
  onUpdate,
  onDeleteLink,
  onToggleFork,
  onRenameAlias,
  onDeleteAlias,
  onEditProvider,
  onDeleteProvider,
  className
}, ref) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const isDark = resolvedTheme === 'dark';
  
  const containerRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<{ path: string; color: string; id: string }[]>([]);
  const [draggedSource, setDraggedSource] = useState<SourceNode | null>(null);
  const [draggedAlias, setDraggedAlias] = useState<string | null>(null);
  const [dropTargetAlias, setDropTargetAlias] = useState<string | null>(null);
  const [dropTargetSource, setDropTargetSource] = useState<string | null>(null);
  const [extraAliases, setExtraAliases] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(new Set());
  const [renameState, setRenameState] = useState<{ oldAlias: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [addAliasOpen, setAddAliasOpen] = useState(false);
  const [addAliasValue, setAddAliasValue] = useState('');
  const [addAliasError, setAddAliasError] = useState('');
  const [settingsAlias, setSettingsAlias] = useState<string | null>(null);
  const [settingsSourceId, setSettingsSourceId] = useState<string | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = (event: globalThis.MouseEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Parse data: each source model (provider+name) and each alias is distinct by id; 1 source -> many aliases.
  const { aliasNodes, providerNodes } = useMemo(() => {
    const sourceMap = new Map<
      string,
      { provider: string; name: string; aliases: Map<string, boolean> }
    >();
    const aliasSet = new Set<string>();

    // 1. Existing mappings: group by (provider, name), each source has a set of aliases
    Object.entries(modelAlias).forEach(([provider, mappings]) => {
      (mappings ?? []).forEach((m) => {
        const name = (m?.name || '').trim();
        const alias = (m?.alias || '').trim();
        if (!name || !alias) return;

        const pk = `${provider.toLowerCase()}::${name.toLowerCase()}`;
        if (!sourceMap.has(pk)) {
          sourceMap.set(pk, { provider, name, aliases: new Map() });
        }
        sourceMap.get(pk)!.aliases.set(alias, m?.fork === true);
        aliasSet.add(alias);
      });
    });

    // 2. Unmapped models from allProviderModels (no mapping yet)
    Object.entries(allProviderModels).forEach(([provider, models]) => {
      (models ?? []).forEach((m) => {
        const name = (m.id || '').trim();
        if (!name) return;
        const pk = `${provider.toLowerCase()}::${name.toLowerCase()}`;
        if (sourceMap.has(pk)) {
          // Already in sourceMap from mappings; keep provider from mapping for correct grouping.
          return;
        }
        sourceMap.set(pk, { provider, name, aliases: new Map() });
      });
    });

    // 3. Source nodes: distinct by id = provider::name
    const sources: SourceNode[] = Array.from(sourceMap.entries())
      .map(([id, v]) => ({
        id,
        provider: v.provider,
        name: v.name,
        aliases: Array.from(v.aliases.entries()).map(([alias, fork]) => ({ alias, fork }))
      }))
      .sort((a, b) => {
        if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
        return a.name.localeCompare(b.name);
      });

    // 4. Extra aliases (no mapping yet)
    extraAliases.forEach((alias) => aliasSet.add(alias));

    // 5. Alias nodes: distinct by id = alias; sources = SourceNodes that have this alias in their aliases
    const aliasNodesList: AliasNode[] = Array.from(aliasSet)
      .map((alias) => ({
        id: alias,
        alias,
        sources: sources.filter((s) => s.aliases.some((entry) => entry.alias === alias))
      }))
      .sort((a, b) => {
        if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
        return a.alias.localeCompare(b.alias);
      });

    // 6. Group sources by provider
    const providerMap = new Map<string, SourceNode[]>();
    sources.forEach((s) => {
      if (!providerMap.has(s.provider)) providerMap.set(s.provider, []);
      providerMap.get(s.provider)!.push(s);
    });
    const providerNodesList = Array.from(providerMap.entries())
      .map(([provider, providerSources]) => ({ provider, sources: providerSources }))
      .sort((a, b) => a.provider.localeCompare(b.provider));

    return { aliasNodes: aliasNodesList, providerNodes: providerNodesList };
  }, [modelAlias, allProviderModels, extraAliases]);

  // Track element positions
  const providerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const sourceRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const aliasRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const toggleProviderCollapse = (provider: string) => {
    setCollapsedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  };

  // Calculate lines: provider→source, source→alias (when expanded); midpoint + linkData for source→alias
  const updateLines = useCallback(() => {
    if (!containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const newLines: { path: string; color: string; id: string }[] = [];

    const bezier = (
      x1: number, y1: number,
      x2: number, y2: number
    ) => {
      const cpx1 = x1 + (x2 - x1) * 0.5;
      const cpx2 = x2 - (x2 - x1) * 0.5;
      return `M ${x1} ${y1} C ${cpx1} ${y1}, ${cpx2} ${y2}, ${x2} ${y2}`;
    };

    providerNodes.forEach(({ provider, sources }) => {
      const collapsed = collapsedProviders.has(provider);
      if (collapsed) return;

      const providerEl = providerRefs.current.get(provider);
      if (!providerEl) return;
      const providerRect = providerEl.getBoundingClientRect();
      const px = providerRect.right - containerRect.left;
      const py = providerRect.top + providerRect.height / 2 - containerRect.top;
      const color = getProviderColor(provider);

      // Provider → Source (branch link, no dot)
      sources.forEach((source) => {
        const sourceEl = sourceRefs.current.get(source.id);
        if (!sourceEl) return;
        const sourceRect = sourceEl.getBoundingClientRect();
        const sx = sourceRect.left - containerRect.left;
        const sy = sourceRect.top + sourceRect.height / 2 - containerRect.top;
        newLines.push({
          id: `provider-${provider}-source-${source.id}`,
          path: bezier(px, py, sx, sy),
          color
        });
      });
      // Source → Alias: one line per alias
      sources.forEach((source) => {
        if (!source.aliases || source.aliases.length === 0) return;
        
        source.aliases.forEach((aliasEntry) => {
          const sourceEl = sourceRefs.current.get(source.id);
          const aliasEl = aliasRefs.current.get(aliasEntry.alias);
          if (!sourceEl || !aliasEl) return;
          
          const sourceRect = sourceEl.getBoundingClientRect();
          const aliasRect = aliasEl.getBoundingClientRect();
          
          // Calculate coordinates relative to the container
          const x1 = sourceRect.right - containerRect.left;
          const y1 = sourceRect.top + sourceRect.height / 2 - containerRect.top;
          const x2 = aliasRect.left - containerRect.left;
          const y2 = aliasRect.top + aliasRect.height / 2 - containerRect.top;
          
          newLines.push({
            id: `${source.id}-${aliasEntry.alias}`,
            path: bezier(x1, y1, x2, y2),
            color
          });
        });
      });
    });

    setLines(newLines);
  }, [providerNodes, collapsedProviders]);

  useImperativeHandle(
    ref,
    () => ({
      collapseAll: () => setCollapsedProviders(new Set(providerNodes.map((p) => p.provider))),
      refreshLayout: () => updateLines()
    }),
    [providerNodes, updateLines]
  );

  useLayoutEffect(() => {
    // updateLines is called after layout is calculated, ensuring elements are in place.
    updateLines();
    const raf = requestAnimationFrame(updateLines);
    window.addEventListener('resize', updateLines);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', updateLines);
    };
  }, [updateLines, aliasNodes]);

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => updateLines());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [updateLines]);

  // Drag and Drop handlers
  // 1. Source -> Alias
  const handleDragStart = (e: DragEvent, source: SourceNode) => {
    setDraggedSource(source);
    e.dataTransfer.effectAllowed = 'link';
  };

  const handleDragOver = (e: DragEvent, alias: string) => {
    e.preventDefault(); // Allow drop
    if (draggedSource && !draggedSource.aliases.some((entry) => entry.alias === alias)) {
      setDropTargetAlias(alias);
    }
  };

  const handleDragLeave = () => {
    setDropTargetAlias(null);
  };

  const handleDrop = (e: DragEvent, alias: string) => {
    e.preventDefault();
    if (draggedSource && !draggedSource.aliases.some((entry) => entry.alias === alias) && onUpdate) {
      onUpdate(draggedSource.provider, draggedSource.name, alias);
    }
    setDraggedSource(null);
    setDropTargetAlias(null);
  };

  // 2. Alias -> Source
  const handleDragStartAlias = (e: DragEvent, alias: string) => {
    setDraggedAlias(alias);
    e.dataTransfer.effectAllowed = 'link';
  };

  const handleDragOverSource = (e: DragEvent, source: SourceNode) => {
    e.preventDefault();
    if (draggedAlias && !source.aliases.some((entry) => entry.alias === draggedAlias)) {
      setDropTargetSource(source.id);
    }
  };

  const handleDragLeaveSource = () => {
    setDropTargetSource(null);
  };

  const handleDropOnSource = (e: DragEvent, source: SourceNode) => {
    e.preventDefault();
    if (draggedAlias && !source.aliases.some((entry) => entry.alias === draggedAlias) && onUpdate) {
      onUpdate(source.provider, source.name, draggedAlias);
    }
    setDraggedAlias(null);
    setDropTargetSource(null);
  };

  const handleContextMenu = (
    e: ReactMouseEvent,
    type: 'alias' | 'background' | 'provider' | 'source',
    data?: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      type,
      data
    });
  };

  const closeContextMenu = () => setContextMenu(null);

  const resolveSourceById = useCallback(
    (id: string | null) => {
      if (!id) return null;
      for (const { sources } of providerNodes) {
        const found = sources.find((source) => source.id === id);
        if (found) return found;
      }
      return null;
    },
    [providerNodes]
  );

  const handleUnlinkSource = (provider: string, sourceModel: string, alias: string) => {
    if (onDeleteLink) onDeleteLink(provider, sourceModel, alias);
  };

  const handleToggleFork = (
    provider: string,
    sourceModel: string,
    alias: string,
    value: boolean
  ) => {
    if (onToggleFork) onToggleFork(provider, sourceModel, alias, value);
  };

  const handleAddAlias = () => {
    closeContextMenu();
    setAddAliasOpen(true);
    setAddAliasValue('');
    setAddAliasError('');
  };

  const handleAddAliasSubmit = () => {
    const trimmed = addAliasValue.trim();
    if (!trimmed) {
      setAddAliasError(t('oauth_model_alias.diagram_please_enter_alias'));
      return;
    }
    if (aliasNodes.some(a => a.alias === trimmed)) {
      setAddAliasError(t('oauth_model_alias.diagram_alias_exists'));
      return;
    }
    setExtraAliases(prev => [...prev, trimmed]);
    setAddAliasOpen(false);
  };

  const handleRenameClick = (oldAlias: string) => {
    closeContextMenu();
    setRenameState({ oldAlias });
    setRenameValue(oldAlias);
    setRenameError('');
  };

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError(t('oauth_model_alias.diagram_please_enter_alias'));
      return;
    }
    if (trimmed === renameState?.oldAlias) {
      setRenameState(null);
      return;
    }
    if (aliasNodes.some(a => a.alias === trimmed)) {
      setRenameError(t('oauth_model_alias.diagram_alias_exists'));
      return;
    }
    if (onRenameAlias && renameState) onRenameAlias(renameState.oldAlias, trimmed);
    if (extraAliases.includes(renameState?.oldAlias ?? '')) {
      setExtraAliases(prev => prev.map(a => a === renameState?.oldAlias ? trimmed : a));
    }
    setRenameState(null);
  };

  const handleDeleteClick = (alias: string) => {
    closeContextMenu();
    const node = aliasNodes.find(n => n.alias === alias);
    if (!node) return;

    if (node.sources.length === 0) {
      setExtraAliases(prev => prev.filter(a => a !== alias));
    } else {
      if (onDeleteAlias) onDeleteAlias(alias);
    }
  };

  const renderAliasMenu = () => {
    const aliasData = contextMenu?.data;
    if (contextMenu?.type !== 'alias' || aliasData == null) return null;
    return (
      <>
        <div className={styles.menuItem} onClick={() => handleRenameClick(aliasData)}>
          <span>{t('oauth_model_alias.diagram_rename')}</span>
        </div>
        <div
          className={styles.menuItem}
          onClick={() => {
            closeContextMenu();
            setSettingsAlias(aliasData);
          }}
        >
          <span>{t('oauth_model_alias.diagram_settings')}</span>
        </div>
        <div className={styles.menuDivider} />
        <div className={`${styles.menuItem} ${styles.danger}`} onClick={() => handleDeleteClick(aliasData)}>
          <span>{t('oauth_model_alias.diagram_delete_alias')}</span>
        </div>
      </>
    );
  };

  const renderProviderMenu = () => {
    const provider = contextMenu?.data;
    if (contextMenu?.type !== 'provider' || !provider) return null;
    return (
      <>
        <div
          className={styles.menuItem}
          onClick={() => {
            closeContextMenu();
            onEditProvider?.(provider);
          }}
        >
          <span>{t('common.edit')}</span>
        </div>
        <div className={styles.menuDivider} />
        <div
          className={`${styles.menuItem} ${styles.danger}`}
          onClick={() => {
            closeContextMenu();
            onDeleteProvider?.(provider);
          }}
        >
          <span>{t('oauth_model_alias.delete')}</span>
        </div>
      </>
    );
  };

  const renderSourceMenu = () => {
    const sourceId = contextMenu?.data;
    const source = resolveSourceById(sourceId ?? null);
    if (contextMenu?.type !== 'source' || !source) return null;
    return (
      <>
        <div
          className={styles.menuItem}
          onClick={() => {
            closeContextMenu();
            setSettingsSourceId(source.id);
          }}
        >
          <span>{t('oauth_model_alias.diagram_settings')}</span>
        </div>
      </>
    );
  };

  return (
    <div 
      className={`${styles.container} ${className}`} 
      ref={containerRef}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handleContextMenu(e, 'background');
      }}
    >
      <svg className={styles.connections}>
        {lines.map((line) => (
          <path
            key={line.id}
            d={line.path}
            stroke={line.color}
            strokeOpacity={isDark ? 0.4 : 0.3}
          />
        ))}
      </svg>

      {/* Column 1: Providers (mindmap root branch) */}
      <div
        className={`${styles.column} ${styles.providers}`}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleContextMenu(e, 'background');
        }}
      >
        <div className={styles.columnHeader}>{t('oauth_model_alias.diagram_providers')}</div>
        {providerNodes.map(({ provider, sources }) => {
          const collapsed = collapsedProviders.has(provider);
          return (
            <div
              key={provider}
              ref={(el) => {
                if (el) providerRefs.current.set(provider, el);
                else providerRefs.current.delete(provider);
              }}
              className={`${styles.item} ${styles.providerItem}`}
              style={{ borderLeftColor: getProviderColor(provider) }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleContextMenu(e, 'provider', provider);
              }}
            >
              <button
                type="button"
                className={styles.collapseBtn}
                onClick={() => toggleProviderCollapse(provider)}
                aria-label={collapsed ? t('oauth_model_alias.diagram_expand') : t('oauth_model_alias.diagram_collapse')}
                title={collapsed ? t('oauth_model_alias.diagram_expand') : t('oauth_model_alias.diagram_collapse')}
              >
                <span className={collapsed ? styles.chevronRight : styles.chevronDown} />
              </button>
              <span
                className={styles.providerLabel}
                style={{ color: getProviderColor(provider) }}
              >
                {provider}
              </span>
              <span className={styles.itemCount}>{sources.length}</span>
            </div>
          );
        })}
      </div>

      {/* Column 2: Source Models (children per provider; hidden when provider collapsed) */}
      <div
        className={`${styles.column} ${styles.sources}`}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleContextMenu(e, 'background');
        }}
      >
        <div className={styles.columnHeader}>{t('oauth_model_alias.diagram_source_models')}</div>
        {providerNodes.flatMap(({ provider, sources }) => {
          if (collapsedProviders.has(provider)) return [];
          return sources.map((source) => (
            <div
              key={source.id}
              ref={(el) => {
                if (el) sourceRefs.current.set(source.id, el);
                else sourceRefs.current.delete(source.id);
              }}
              className={`${styles.item} ${styles.sourceItem} ${
                draggedSource?.id === source.id ? styles.dragging : ''
              } ${dropTargetSource === source.id ? styles.dropTarget : ''}`}
              draggable={!!onUpdate}
              onDragStart={(e) => handleDragStart(e, source)}
              onDragEnd={() => {
                setDraggedSource(null);
                setDropTargetAlias(null);
              }}
              onDragOver={(e) => handleDragOverSource(e, source)}
              onDragLeave={handleDragLeaveSource}
              onDrop={(e) => handleDropOnSource(e, source)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleContextMenu(e, 'source', source.id);
              }}
            >
              <span className={styles.itemName} title={source.name}>
                {source.name}
              </span>
              <div
                className={styles.dot}
                style={{
                  background: getProviderColor(source.provider),
                  opacity: source.aliases.length > 0 ? 1 : 0.3
                }}
              />
            </div>
          ));
        })}
      </div>

      <div
        className={`${styles.column} ${styles.aliases}`}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleContextMenu(e, 'background');
        }}
      >
        <div className={styles.columnHeader}>{t('oauth_model_alias.diagram_aliases')}</div>
        {aliasNodes.map((node) => (
          <div
            key={node.id}
            ref={(el) => {
              if (el) aliasRefs.current.set(node.id, el);
              else aliasRefs.current.delete(node.id);
            }}
            className={`${styles.item} ${styles.aliasItem} ${
              dropTargetAlias === node.alias ? styles.dropTarget : ''
            } ${draggedAlias === node.alias ? styles.dragging : ''}`}
            draggable={!!onUpdate}
            onDragStart={(e) => handleDragStartAlias(e, node.alias)}
            onDragEnd={() => {
              setDraggedAlias(null);
              setDropTargetSource(null);
            }}
            onDragOver={(e) => handleDragOver(e, node.alias)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, node.alias)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleContextMenu(e, 'alias', node.alias);
            }}
          >
            <div className={`${styles.dot} ${styles.dotLeft}`} />
            <span className={styles.itemName} title={node.alias}>
              {node.alias}
            </span>
            <span className={styles.itemCount}>{node.sources.length}</span>
          </div>
        ))}
      </div>

      {contextMenu &&
        createPortal(
          <div
            ref={contextMenuRef}
            className={styles.contextMenu}
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.type === 'background' && (
              <div className={styles.menuItem} onClick={handleAddAlias}>
                <span>{t('oauth_model_alias.diagram_add_alias')}</span>
              </div>
            )}
            {contextMenu.type === 'alias' && renderAliasMenu()}
            {contextMenu.type === 'provider' && renderProviderMenu()}
            {contextMenu.type === 'source' && renderSourceMenu()}
          </div>,
          document.body
        )}

      <Modal
        open={!!renameState}
        onClose={() => setRenameState(null)}
        title={t('oauth_model_alias.diagram_rename_alias_title')}
        width={400}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameState(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleRenameSubmit}>
              {t('oauth_model_alias.diagram_rename_btn')}
            </Button>
          </>
        }
      >
        <Input
          label={t('oauth_model_alias.diagram_rename_alias_label')}
          value={renameValue}
          onChange={(e) => {
            setRenameValue(e.target.value);
            setRenameError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRenameSubmit();
          }}
          error={renameError}
          placeholder={t('oauth_model_alias.diagram_rename_placeholder')}
          autoFocus
        />
      </Modal>

      <Modal
        open={addAliasOpen}
        onClose={() => setAddAliasOpen(false)}
        title={t('oauth_model_alias.diagram_add_alias_title')}
        width={400}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddAliasOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleAddAliasSubmit}>
              {t('oauth_model_alias.diagram_add_btn')}
            </Button>
          </>
        }
      >
        <Input
          label={t('oauth_model_alias.diagram_add_alias_label')}
          value={addAliasValue}
          onChange={(e) => {
            setAddAliasValue(e.target.value);
            setAddAliasError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAddAliasSubmit();
          }}
          error={addAliasError}
          placeholder={t('oauth_model_alias.diagram_add_placeholder')}
          autoFocus
        />
      </Modal>

      <Modal
        open={Boolean(settingsAlias)}
        onClose={() => setSettingsAlias(null)}
        title={t('oauth_model_alias.diagram_settings_title', { alias: settingsAlias ?? '' })}
        width={720}
        footer={
          <Button variant="secondary" onClick={() => setSettingsAlias(null)}>
            {t('common.close')}
          </Button>
        }
      >
        {settingsAlias ? (
          (() => {
            const node = aliasNodes.find((n) => n.alias === settingsAlias);
            if (!node || node.sources.length === 0) {
              return <div className={styles.settingsEmpty}>{t('oauth_model_alias.diagram_settings_empty')}</div>;
            }
            return (
              <div className={styles.settingsList}>
                {node.sources.map((source) => {
                  const entry = source.aliases.find((item) => item.alias === settingsAlias);
                  const forkEnabled = entry?.fork === true;
                  return (
                    <div key={source.id} className={styles.settingsRow}>
                      <div className={styles.settingsNames}>
                        <span className={styles.settingsSource}>{source.name}</span>
                        <span className={styles.settingsArrow}>→</span>
                        <span className={styles.settingsAlias}>{settingsAlias}</span>
                      </div>
                      <div className={styles.settingsActions}>
                        <span className={styles.settingsLabel}>
                          {t('oauth_model_alias.alias_fork_label')}
                        </span>
                        <ToggleSwitch
                          checked={forkEnabled}
                          onChange={(value) => handleToggleFork(source.provider, source.name, settingsAlias, value)}
                          ariaLabel={t('oauth_model_alias.alias_fork_label')}
                        />
                        <button
                          type="button"
                          className={styles.settingsDelete}
                          onClick={() => handleUnlinkSource(source.provider, source.name, settingsAlias)}
                          aria-label={t('oauth_model_alias.diagram_delete_link', {
                            provider: source.provider,
                            name: source.name
                          })}
                          title={t('oauth_model_alias.diagram_delete_link', {
                            provider: source.provider,
                            name: source.name
                          })}
                        >
                          <IconTrash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()
        ) : null}
      </Modal>

      <Modal
        open={Boolean(settingsSourceId)}
        onClose={() => setSettingsSourceId(null)}
        title={t('oauth_model_alias.diagram_settings_source_title')}
        width={720}
        footer={
          <Button variant="secondary" onClick={() => setSettingsSourceId(null)}>
            {t('common.close')}
          </Button>
        }
      >
        {settingsSourceId ? (
          (() => {
            const source = resolveSourceById(settingsSourceId);
            if (!source || source.aliases.length === 0) {
              return <div className={styles.settingsEmpty}>{t('oauth_model_alias.diagram_settings_empty')}</div>;
            }
            return (
              <div className={styles.settingsList}>
                {source.aliases.map((entry) => (
                  <div key={`${source.id}-${entry.alias}`} className={styles.settingsRow}>
                    <div className={styles.settingsNames}>
                      <span className={styles.settingsSource}>{source.name}</span>
                      <span className={styles.settingsArrow}>→</span>
                      <span className={styles.settingsAlias}>{entry.alias}</span>
                    </div>
                    <div className={styles.settingsActions}>
                      <span className={styles.settingsLabel}>
                        {t('oauth_model_alias.alias_fork_label')}
                      </span>
                      <ToggleSwitch
                        checked={entry.fork === true}
                        onChange={(value) =>
                          handleToggleFork(source.provider, source.name, entry.alias, value)
                        }
                        ariaLabel={t('oauth_model_alias.alias_fork_label')}
                      />
                      <button
                        type="button"
                        className={styles.settingsDelete}
                        onClick={() => handleUnlinkSource(source.provider, source.name, entry.alias)}
                        aria-label={t('oauth_model_alias.diagram_delete_link', {
                          provider: source.provider,
                          name: source.name
                        })}
                        title={t('oauth_model_alias.diagram_delete_link', {
                          provider: source.provider,
                          name: source.name
                        })}
                      >
                        <IconTrash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()
        ) : null}
      </Modal>
    </div>
  );
});
