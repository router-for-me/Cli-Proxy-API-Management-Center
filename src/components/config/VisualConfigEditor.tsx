import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { Collapsible } from '@/components/ui/Collapsible';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconCode,
  IconKey,
  IconNetwork,
  IconSatellite,
  IconScrollText,
  IconSearch,
  IconShield,
  IconSlidersHorizontal,
  IconTimer,
  type IconProps,
} from '@/components/ui/icons';
import { ConfigSection } from '@/components/config/ConfigSection';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type {
  PayloadFilterRule,
  PayloadParamValidationErrorCode,
  PayloadRule,
  PluginStoreAuthRule,
  VisualConfigFieldPath,
  VisualConfigValidationErrorCode,
  VisualConfigValidationErrors,
  VisualConfigValues,
} from '@/types/visualConfig';
import {
  ApiKeysCardEditor,
  PayloadFilterRulesEditor,
  PayloadRulesEditor,
  PluginStoreAuthEditor,
  StringListEditor,
} from './VisualConfigEditorBlocks';
import {
  configFieldDomId,
  searchConfigFields,
  type ConfigFieldSearchEntry,
  type VisualSectionId,
} from './configSearchIndex';
import styles from './VisualConfigEditor.module.scss';

type EditorMode = 'simple' | 'full';

const EDITOR_MODE_STORAGE_KEY = 'config-management:editor-mode';

type VisualSection = {
  id: VisualSectionId;
  title: string;
  icon: ComponentType<IconProps>;
  errorCount: number;
};

interface VisualConfigEditorProps {
  values: VisualConfigValues;
  validationErrors?: VisualConfigValidationErrors;
  hasPayloadValidationErrors?: boolean;
  disabled?: boolean;
  onChange: (values: Partial<VisualConfigValues>) => void;
}

function getValidationMessage(
  t: ReturnType<typeof useTranslation>['t'],
  errorCode?: VisualConfigValidationErrorCode | PayloadParamValidationErrorCode
) {
  if (!errorCode) return undefined;
  return t(`config_management.visual.validation.${errorCode}`);
}

type ToggleRowProps = {
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
};

function ToggleRow({ title, description, checked, disabled, onChange }: ToggleRowProps) {
  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleCopy}>
        <div className={styles.toggleTitle}>{title}</div>
        {description ? <div className={styles.toggleDescription}>{description}</div> : null}
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} ariaLabel={title} />
    </div>
  );
}

function SectionGrid({ children }: { children: ReactNode }) {
  return <div className={styles.sectionGrid}>{children}</div>;
}

function SectionStack({ children }: { children: ReactNode }) {
  return <div className={styles.sectionStack}>{children}</div>;
}

function Divider() {
  return <div className={styles.divider} />;
}

// Stable, stateless anchor around a searchable field. Search jumps target its DOM id
// (see configSearchIndex.ts) and the highlight pulse is applied to it imperatively.
function FieldAnchor({ fieldId, children }: { fieldId: string; children: ReactNode }) {
  return (
    <div id={configFieldDomId(fieldId)} className={styles.fieldAnchor}>
      {children}
    </div>
  );
}

function SectionSubsection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.subsection}>
      <div className={styles.subsectionHeader}>
        <h3 className={styles.subsectionTitle}>{title}</h3>
        {description ? <p className={styles.subsectionDescription}>{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

function FieldShell({
  label,
  labelId,
  htmlFor,
  hint,
  hintId,
  error,
  errorId,
  children,
}: {
  label: string;
  labelId?: string;
  htmlFor?: string;
  hint?: string;
  hintId?: string;
  error?: string;
  errorId?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.fieldShell}>
      <label id={labelId} htmlFor={htmlFor} className={styles.fieldLabel}>
        {label}
      </label>
      {children}
      {error ? (
        <div id={errorId} className="error-box">
          {error}
        </div>
      ) : null}
      {hint ? (
        <div id={hintId} className={styles.fieldHint}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function VisualConfigEditor({
  values,
  validationErrors,
  hasPayloadValidationErrors = false,
  disabled = false,
  onChange,
}: VisualConfigEditorProps) {
  const { t } = useTranslation();
  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.isCurrentLayer : true;
  const isMobile = useMediaQuery('(max-width: 768px)');
  const routingStrategyLabelId = useId();
  const routingStrategyHintId = `${routingStrategyLabelId}-hint`;
  const disableImageGenerationLabelId = useId();
  const disableImageGenerationHintId = `${disableImageGenerationLabelId}-hint`;
  const keepaliveInputId = useId();
  const keepaliveHintId = `${keepaliveInputId}-hint`;
  const keepaliveErrorId = `${keepaliveInputId}-error`;
  const nonstreamKeepaliveInputId = useId();
  const nonstreamKeepaliveHintId = `${nonstreamKeepaliveInputId}-hint`;
  const nonstreamKeepaliveErrorId = `${nonstreamKeepaliveInputId}-error`;
  const [mode, setMode] = useState<EditorMode>(() => {
    const saved = localStorage.getItem(EDITOR_MODE_STORAGE_KEY);
    return saved === 'full' ? 'full' : 'simple';
  });
  const [activeSectionId, setActiveSectionId] = useState<VisualSectionId>('connectivity');
  const sectionRefs = useRef<Partial<Record<VisualSectionId, HTMLElement | null>>>({});
  const mobileNavScrollerRef = useRef<HTMLDivElement | null>(null);
  const mobileNavButtonRefs = useRef<Partial<Record<VisualSectionId, HTMLButtonElement | null>>>(
    {}
  );
  const [searchQuery, setSearchQuery] = useState('');
  // Dropdown visibility is tracked separately from the query text so a jump can close the
  // results while leaving the typed text in the box for further editing.
  const [searchOpen, setSearchOpen] = useState(false);
  // Highlighted option for keyboard navigation of the results listbox (-1 = none).
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const searchListboxId = useId();
  const searchResultsRef = useRef<HTMLDivElement | null>(null);
  // A fresh object per jump; the effect handles it once (guarded by handledJumpRef) so it
  // never needs to clear state from inside the effect.
  const [jumpRequest, setJumpRequest] = useState<{
    fieldId: string;
    sectionId: VisualSectionId;
  } | null>(null);
  const handledJumpRef = useRef<{ fieldId: string; sectionId: VisualSectionId } | null>(null);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const highlightedElRef = useRef<HTMLElement | null>(null);

  const handleModeChange = useCallback((next: EditorMode) => {
    setMode(next);
    localStorage.setItem(EDITOR_MODE_STORAGE_KEY, next);
  }, []);

  const searchResults = useMemo(() => searchConfigFields(searchQuery, t), [searchQuery, t]);
  // The results popup is visible only when the box is open AND there's a (trimmed) query.
  const isResultsOpen = searchOpen && Boolean(searchQuery.trim());
  // Clamp the highlighted index to the current result set so a stale index (e.g. after the
  // query narrows the list) never points past the end or at an option that no longer exists.
  const effectiveActiveIndex =
    searchResults.length > 0
      ? Math.min(Math.max(activeResultIndex, 0), searchResults.length - 1)
      : -1;

  const handleResultJump = useCallback(
    (entry: ConfigFieldSearchEntry) => {
      // Keep the query text so the user can tweak it; just close the results dropdown.
      setSearchOpen(false);
      handleModeChange('full');
      setActiveSectionId(entry.sectionId);
      // A new object instance defers scroll/highlight to the effect below, giving a
      // simple→full switch time to mount the DOM before we query for the field.
      setJumpRequest({ fieldId: entry.fieldId, sectionId: entry.sectionId });
    },
    [handleModeChange]
  );

  // Imperatively scroll to and pulse-highlight the jumped-to field once full mode is mounted.
  useEffect(() => {
    if (mode !== 'full' || !jumpRequest || handledJumpRef.current === jumpRequest) return;
    handledJumpRef.current = jumpRequest; // handle each request once, even if deps re-fire
    const { fieldId, sectionId } = jumpRequest;
    const targetFieldId =
      (fieldId === 'tlsCert' || fieldId === 'tlsKey') && !values.tlsEnable ? 'tlsEnable' : fieldId;

    const el = document.getElementById(configFieldDomId(targetFieldId));
    if (!el) {
      // Field not rendered right now (e.g. TLS cert while TLS is disabled) — fall back to
      // bringing its section into view horizontally.
      sectionRefs.current[sectionId]?.scrollIntoView({ block: 'nearest', inline: 'start' });
      return;
    }

    // Expand the collapsed <details> group this field belongs to: an ancestor when the
    // anchor sits inside the group (TLS / remote / advanced fields), or a descendant when
    // the anchor wraps the whole group (payload rule groups).
    const details = el.closest('details') ?? el.querySelector('details');
    if (details && !details.open) details.open = true;

    // Clear any in-flight highlight before starting a new one.
    if (highlightTimerRef.current !== null) {
      clearTimeout(highlightTimerRef.current);
      highlightedElRef.current?.classList.remove(styles.fieldHighlightActive);
    }

    // Full-mode sections live in a horizontal scroll-snap container (`scroll-snap-type: x
    // mandatory`). A single field-level scrollIntoView() tries to do the horizontal section
    // switch AND the vertical field scroll at once, which the snap pulls back / lands wrong.
    // So: (1) switch to the target section horizontally and instantly (no smooth → no snap
    // fight), then (2) next frame, scroll the field vertically with inline:'nearest' so it
    // can't re-trigger horizontal snapping.
    sectionRefs.current[sectionId]?.scrollIntoView({ block: 'nearest', inline: 'start' });
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      el.classList.add(styles.fieldHighlightActive);
    });
    highlightedElRef.current = el;
    highlightTimerRef.current = window.setTimeout(() => {
      el.classList.remove(styles.fieldHighlightActive);
      highlightTimerRef.current = null;
      highlightedElRef.current = null;
    }, 1800);
  }, [mode, jumpRequest, values.tlsEnable]);

  // Clear the highlight timer on unmount.
  useEffect(
    () => () => {
      if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
    },
    []
  );

  // Close the results dropdown (keeping the query) when clicking outside the search box.
  useEffect(() => {
    if (!searchOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [searchOpen]);

  // Keep the highlighted option scrolled into view during keyboard navigation.
  useEffect(() => {
    if (!isResultsOpen || effectiveActiveIndex < 0) return;
    const node = searchResultsRef.current?.querySelector<HTMLElement>(
      `[data-result-index="${effectiveActiveIndex}"]`
    );
    node?.scrollIntoView({ block: 'nearest' });
  }, [effectiveActiveIndex, isResultsOpen]);

  const isKeepaliveDisabled =
    values.streaming.keepaliveSeconds === '' || values.streaming.keepaliveSeconds === '0';
  const isNonstreamKeepaliveDisabled =
    values.streaming.nonstreamKeepaliveInterval === '' ||
    values.streaming.nonstreamKeepaliveInterval === '0';

  const portError = getValidationMessage(t, validationErrors?.port);
  const logsMaxSizeError = getValidationMessage(t, validationErrors?.logsMaxTotalSizeMb);
  const errorLogsMaxFilesError = getValidationMessage(t, validationErrors?.errorLogsMaxFiles);
  const redisUsageQueueRetentionError = getValidationMessage(
    t,
    validationErrors?.redisUsageQueueRetentionSeconds
  );
  const requestRetryError = getValidationMessage(t, validationErrors?.requestRetry);
  const maxRetryCredentialsError = getValidationMessage(t, validationErrors?.maxRetryCredentials);
  const maxRetryIntervalError = getValidationMessage(t, validationErrors?.maxRetryInterval);
  const authAutoRefreshWorkersError = getValidationMessage(
    t,
    validationErrors?.authAutoRefreshWorkers
  );
  const keepaliveError = getValidationMessage(t, validationErrors?.['streaming.keepaliveSeconds']);
  const bootstrapRetriesError = getValidationMessage(
    t,
    validationErrors?.['streaming.bootstrapRetries']
  );
  const nonstreamKeepaliveError = getValidationMessage(
    t,
    validationErrors?.['streaming.nonstreamKeepaliveInterval']
  );

  const handleApiKeysTextChange = useCallback(
    (apiKeysText: string) => onChange({ apiKeysText }),
    [onChange]
  );
  const handlePluginStoreSourcesChange = useCallback(
    (pluginStoreSources: string[]) => onChange({ pluginStoreSources }),
    [onChange]
  );
  const handlePluginStoreAuthChange = useCallback(
    (pluginStoreAuth: PluginStoreAuthRule[]) => onChange({ pluginStoreAuth }),
    [onChange]
  );
  const handlePayloadDefaultRulesChange = useCallback(
    (payloadDefaultRules: PayloadRule[]) => onChange({ payloadDefaultRules }),
    [onChange]
  );
  const handlePayloadDefaultRawRulesChange = useCallback(
    (payloadDefaultRawRules: PayloadRule[]) => onChange({ payloadDefaultRawRules }),
    [onChange]
  );
  const handlePayloadOverrideRulesChange = useCallback(
    (payloadOverrideRules: PayloadRule[]) => onChange({ payloadOverrideRules }),
    [onChange]
  );
  const handlePayloadOverrideRawRulesChange = useCallback(
    (payloadOverrideRawRules: PayloadRule[]) => onChange({ payloadOverrideRawRules }),
    [onChange]
  );
  const handlePayloadFilterRulesChange = useCallback(
    (payloadFilterRules: PayloadFilterRule[]) => onChange({ payloadFilterRules }),
    [onChange]
  );
  const disableImageGenerationOptions = useMemo(
    () => [
      {
        value: 'false',
        label: t('config_management.visual.sections.network.disable_image_generation_false'),
      },
      {
        value: 'true',
        label: t('config_management.visual.sections.network.disable_image_generation_true'),
      },
      {
        value: 'chat',
        label: t('config_management.visual.sections.network.disable_image_generation_chat'),
      },
    ],
    [t]
  );

  const countErrors = useCallback(
    (fields: VisualConfigFieldPath[]) =>
      fields.reduce((total, field) => total + (validationErrors?.[field] ? 1 : 0), 0),
    [validationErrors]
  );

  const sections = useMemo<VisualSection[]>(
    () => [
      {
        id: 'connectivity',
        title: t('config_management.visual.sections.connectivity.title'),
        icon: IconKey,
        errorCount: countErrors(['port']),
      },
      {
        id: 'network',
        title: t('config_management.visual.sections.network.title'),
        icon: IconNetwork,
        errorCount: countErrors([
          'requestRetry',
          'maxRetryCredentials',
          'maxRetryInterval',
          'authAutoRefreshWorkers',
        ]),
      },
      {
        id: 'logging',
        title: t('config_management.visual.sections.logging.title'),
        icon: IconScrollText,
        errorCount: countErrors([
          'errorLogsMaxFiles',
          'logsMaxTotalSizeMb',
          'redisUsageQueueRetentionSeconds',
        ]),
      },
      {
        id: 'quota',
        title: t('config_management.visual.sections.quota.title'),
        icon: IconTimer,
        errorCount: 0,
      },
      {
        id: 'streaming',
        title: t('config_management.visual.sections.streaming.title'),
        icon: IconSatellite,
        errorCount: countErrors([
          'streaming.keepaliveSeconds',
          'streaming.bootstrapRetries',
          'streaming.nonstreamKeepaliveInterval',
        ]),
      },
      {
        id: 'advanced',
        title: t('config_management.visual.sections.advanced.title'),
        icon: IconShield,
        errorCount: 0,
      },
      {
        id: 'payload',
        title: t('config_management.visual.sections.payload.title'),
        icon: IconCode,
        errorCount: hasPayloadValidationErrors ? 1 : 0,
      },
    ],
    [countErrors, hasPayloadValidationErrors, t]
  );

  const hasValidationIssues =
    sections.some((section) => section.errorCount > 0) || hasPayloadValidationErrors;
  // Validation errors that live in fields not surfaced by simple mode (everything except `port`).
  const hasHiddenValidationIssues =
    (Object.keys(validationErrors ?? {}) as VisualConfigFieldPath[]).some(
      (field) => field !== 'port' && Boolean(validationErrors?.[field])
    ) || hasPayloadValidationErrors;
  const payloadValidationKey = hasPayloadValidationErrors ? 'payload-errors' : 'payload-ok';
  const activeSection = sections.find((section) => section.id === activeSectionId) ?? sections[0];

  useEffect(() => {
    if (mode !== 'full') return undefined;
    if (!isCurrentLayer) return undefined;
    if (typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio);

        if (visibleEntries.length === 0) return;
        setActiveSectionId(visibleEntries[0].target.id as VisualSectionId);
      },
      {
        rootMargin: '-18% 0px -58% 0px',
        threshold: [0.12, 0.3, 0.55],
      }
    );

    for (const section of sections) {
      const element = sectionRefs.current[section.id];
      if (element) observer.observe(element);
    }

    return () => observer.disconnect();
  }, [isCurrentLayer, mode, sections]);

  useEffect(() => {
    if (mode !== 'full' || !isCurrentLayer || !isMobile) return;
    const scroller = mobileNavScrollerRef.current;
    const button = mobileNavButtonRefs.current[activeSectionId];
    if (!scroller || !button) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const centeredLeft =
      scroller.scrollLeft +
      (buttonRect.left - scrollerRect.left) -
      (scroller.clientWidth - buttonRect.width) / 2;
    const maxScrollLeft = Math.max(scroller.scrollWidth - scroller.clientWidth, 0);
    const targetLeft = Math.min(Math.max(centeredLeft, 0), maxScrollLeft);

    scroller.scrollTo({
      left: targetLeft,
      behavior: 'smooth',
    });
  }, [activeSectionId, isCurrentLayer, isMobile, mode]);

  const handleSectionJump = useCallback((sectionId: VisualSectionId) => {
    setActiveSectionId(sectionId);
    sectionRefs.current[sectionId]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'start',
    });
  }, []);

  // Shared high-frequency field blocks — reused verbatim by both the simple view and full mode
  // so the two layouts never drift apart.
  const hostField = (
    <FieldAnchor fieldId="host">
      <Input
        label={t('config_management.visual.sections.server.host')}
        placeholder="0.0.0.0"
        value={values.host}
        onChange={(e) => onChange({ host: e.target.value })}
        disabled={disabled}
      />
    </FieldAnchor>
  );

  const portField = (
    <FieldAnchor fieldId="port">
      <Input
        label={t('config_management.visual.sections.server.port')}
        type="number"
        placeholder="8317"
        value={values.port}
        onChange={(e) => onChange({ port: e.target.value })}
        disabled={disabled}
        error={portError}
      />
    </FieldAnchor>
  );

  const proxyUrlField = (
    <FieldAnchor fieldId="proxyUrl">
      <Input
        label={t('config_management.visual.sections.network.proxy_url')}
        placeholder="socks5://user:pass@127.0.0.1:1080/"
        value={values.proxyUrl}
        onChange={(e) => onChange({ proxyUrl: e.target.value })}
        disabled={disabled}
      />
    </FieldAnchor>
  );

  const apiKeysField = (
    <FieldAnchor fieldId="apiKeys">
      <div className={styles.subsection}>
        <ApiKeysCardEditor
          value={values.apiKeysText}
          disabled={disabled}
          onChange={handleApiKeysTextChange}
        />
      </div>
    </FieldAnchor>
  );

  const debugToggle = (
    <FieldAnchor fieldId="debug">
      <ToggleRow
        title={t('config_management.visual.sections.system.debug')}
        description={t('config_management.visual.sections.system.debug_desc')}
        checked={values.debug}
        disabled={disabled}
        onChange={(debug) => onChange({ debug })}
      />
    </FieldAnchor>
  );

  const loggingToFileToggle = (
    <FieldAnchor fieldId="loggingToFile">
      <ToggleRow
        title={t('config_management.visual.sections.system.logging_to_file')}
        description={t('config_management.visual.sections.system.logging_to_file_desc')}
        checked={values.loggingToFile}
        disabled={disabled}
        onChange={(loggingToFile) => onChange({ loggingToFile })}
      />
    </FieldAnchor>
  );

  const quotaSwitchProjectToggle = (
    <FieldAnchor fieldId="quotaSwitchProject">
      <ToggleRow
        title={t('config_management.visual.sections.quota.switch_project')}
        description={t('config_management.visual.sections.quota.switch_project_desc')}
        checked={values.quotaSwitchProject}
        disabled={disabled}
        onChange={(quotaSwitchProject) => onChange({ quotaSwitchProject })}
      />
    </FieldAnchor>
  );

  const quotaSwitchPreviewModelToggle = (
    <FieldAnchor fieldId="quotaSwitchPreviewModel">
      <ToggleRow
        title={t('config_management.visual.sections.quota.switch_preview_model')}
        description={t('config_management.visual.sections.quota.switch_preview_model_desc')}
        checked={values.quotaSwitchPreviewModel}
        disabled={disabled}
        onChange={(quotaSwitchPreviewModel) => onChange({ quotaSwitchPreviewModel })}
      />
    </FieldAnchor>
  );

  const navContent = (
    <div className={styles.navList}>
      {sections.map((section, index) => {
        const Icon = section.icon;

        return (
          <button
            key={section.id}
            type="button"
            className={`${styles.navButton} ${
              activeSectionId === section.id ? styles.navButtonActive : ''
            }`}
            onClick={() => handleSectionJump(section.id)}
          >
            <span className={styles.navIndex}>{String(index + 1).padStart(2, '0')}</span>
            <span className={styles.navMain}>
              <span className={styles.navHeadingRow}>
                <span className={styles.navLabelWrap}>
                  <span className={styles.navIcon}>
                    <Icon size={14} />
                  </span>
                  <span className={styles.navLabel}>{section.title}</span>
                </span>
                {section.errorCount > 0 ? (
                  <span className={styles.navBadge} aria-hidden="true">
                    {section.errorCount}
                  </span>
                ) : null}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className={styles.visualEditor}>
      <div className={styles.overview}>
        <div className={styles.overviewHeader}>
          <div
            className={styles.modeSwitch}
            role="group"
            aria-label={t('config_management.visual.mode.label')}
          >
            <button
              type="button"
              className={`${styles.modeButton} ${mode === 'simple' ? styles.modeButtonActive : ''}`}
              onClick={() => handleModeChange('simple')}
              aria-pressed={mode === 'simple'}
            >
              <IconSlidersHorizontal size={14} />
              {t('config_management.visual.mode.simple')}
            </button>
            <button
              type="button"
              className={`${styles.modeButton} ${mode === 'full' ? styles.modeButtonActive : ''}`}
              onClick={() => handleModeChange('full')}
              aria-pressed={mode === 'full'}
            >
              {t('config_management.visual.mode.full')}
            </button>
          </div>
          <div className={styles.overviewMeta}>
            {mode === 'full' && activeSection ? (
              <span className={styles.overviewPill}>{activeSection.title}</span>
            ) : null}
            {hasValidationIssues ? (
              <span className={`${styles.overviewPill} ${styles.overviewPillWarning}`}>
                {t('config_management.visual.validation.validation_blocked')}
              </span>
            ) : null}
          </div>
        </div>

        <div className={styles.searchBox} ref={searchBoxRef}>
          <Input
            className={styles.searchControl}
            placeholder={t('config_management.visual.search.placeholder')}
            aria-label={t('config_management.visual.search.placeholder')}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={isResultsOpen}
            aria-controls={isResultsOpen ? searchListboxId : undefined}
            aria-activedescendant={
              isResultsOpen && effectiveActiveIndex >= 0
                ? `${searchListboxId}-opt-${effectiveActiveIndex}`
                : undefined
            }
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchOpen(true);
              setActiveResultIndex(0);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => {
              // Ignore keys fired while an IME is composing (e.g. picking a Chinese
              // candidate) — otherwise candidate selection triggers navigation/jump.
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Escape') {
                setSearchOpen(false);
                return;
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!isResultsOpen) {
                  setSearchOpen(true);
                  return;
                }
                if (searchResults.length === 0) return;
                setActiveResultIndex((effectiveActiveIndex + 1) % searchResults.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (!isResultsOpen) {
                  setSearchOpen(true);
                  return;
                }
                if (searchResults.length === 0) return;
                setActiveResultIndex(
                  effectiveActiveIndex <= 0 ? searchResults.length - 1 : effectiveActiveIndex - 1
                );
                return;
              }
              if (e.key === 'Enter' && isResultsOpen && searchResults.length > 0) {
                e.preventDefault();
                handleResultJump(searchResults[effectiveActiveIndex] ?? searchResults[0]);
              }
            }}
            rightElement={
              <span className={styles.searchIcon} aria-hidden="true">
                <IconSearch size={16} />
              </span>
            }
          />
          {isResultsOpen ? (
            <div
              className={styles.searchResults}
              role="listbox"
              id={searchListboxId}
              aria-label={t('config_management.visual.search.placeholder')}
              ref={searchResultsRef}
            >
              {searchResults.length > 0 ? (
                searchResults.map((entry, index) => (
                  <button
                    key={entry.fieldId}
                    type="button"
                    role="option"
                    id={`${searchListboxId}-opt-${index}`}
                    data-result-index={index}
                    tabIndex={-1}
                    aria-selected={index === effectiveActiveIndex}
                    className={`${styles.searchResultItem} ${
                      index === effectiveActiveIndex ? styles.searchResultItemActive : ''
                    }`}
                    onMouseEnter={() => setActiveResultIndex(index)}
                    onClick={() => handleResultJump(entry)}
                  >
                    <span className={styles.searchResultLabel}>
                      {t(entry.labelKey)}
                      {entry.qualifierKey ? (
                        <span className={styles.searchResultQualifier}>
                          {t(entry.qualifierKey)}
                        </span>
                      ) : null}
                    </span>
                    <span className={styles.searchResultSection}>
                      {t(`config_management.visual.sections.${entry.sectionId}.title`)}
                    </span>
                  </button>
                ))
              ) : (
                <div className={styles.searchEmpty}>
                  {t('config_management.visual.search.no_results')}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {mode === 'simple' ? (
        <div className={styles.simpleView}>
          {hasHiddenValidationIssues ? (
            <div className={styles.simpleBanner} role="alert">
              <span>{t('config_management.visual.mode.validation_banner')}</span>
              <button
                type="button"
                className={styles.simpleBannerAction}
                onClick={() => handleModeChange('full')}
              >
                {t('config_management.visual.mode.switch_to_full')}
              </button>
            </div>
          ) : null}

          <div className={styles.simpleForm}>
            <div className={styles.simpleField}>{hostField}</div>
            <div className={styles.simpleField}>{portField}</div>
            {apiKeysField}
            <div className={styles.simpleField}>{proxyUrlField}</div>
            {debugToggle}
            {loggingToFileToggle}
            {quotaSwitchProjectToggle}
            {quotaSwitchPreviewModelToggle}
          </div>

          <button
            type="button"
            className={styles.simpleMore}
            onClick={() => handleModeChange('full')}
          >
            {t('config_management.visual.mode.more_settings', { total: sections.length })}
          </button>
        </div>
      ) : (
        <div className={styles.workspace}>
          {isMobile ? (
            <div className={styles.mobileSectionNav}>
              <div
                ref={mobileNavScrollerRef}
                className={styles.mobileSectionNavScroller}
                aria-label={t('config_management.visual.quick_jump', { defaultValue: '快速跳转' })}
              >
                {sections.map((section, index) => (
                  <button
                    key={section.id}
                    ref={(node) => {
                      mobileNavButtonRefs.current[section.id] = node;
                    }}
                    type="button"
                    className={`${styles.mobileSectionNavButton} ${
                      activeSectionId === section.id ? styles.mobileSectionNavButtonActive : ''
                    }`}
                    onClick={() => handleSectionJump(section.id)}
                  >
                    <span className={styles.mobileSectionNavIndex}>
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className={styles.mobileSectionNavLabel}>{section.title}</span>
                    {section.errorCount > 0 ? (
                      <span className={styles.mobileSectionNavBadge} aria-hidden="true">
                        {section.errorCount}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <aside className={styles.sidebar}>
            <div className={styles.sidebarRail}>{navContent}</div>
          </aside>

          <div className={styles.sections}>
            <ConfigSection
              id="connectivity"
              ref={(node) => {
                sectionRefs.current.connectivity = node;
              }}
              indexLabel="01"
              icon={<IconKey size={16} />}
              title={t('config_management.visual.sections.connectivity.title')}
              description={t('config_management.visual.sections.connectivity.description')}
            >
              <SectionStack>
                <SectionGrid>
                  {hostField}
                  {portField}
                </SectionGrid>

                <FieldAnchor fieldId="authDir">
                  <Input
                    label={t('config_management.visual.sections.auth.auth_dir')}
                    placeholder="~/.cli-proxy-api"
                    value={values.authDir}
                    onChange={(e) => onChange({ authDir: e.target.value })}
                    disabled={disabled}
                    hint={t('config_management.visual.sections.auth.auth_dir_hint')}
                  />
                </FieldAnchor>

                {apiKeysField}

                <Collapsible
                  label={t('config_management.visual.sections.tls.title')}
                  hint={t('config_management.visual.sections.tls.description')}
                  defaultOpen={false}
                >
                  <SectionStack>
                    <FieldAnchor fieldId="tlsEnable">
                      <ToggleRow
                        title={t('config_management.visual.sections.tls.enable')}
                        description={t('config_management.visual.sections.tls.enable_desc')}
                        checked={values.tlsEnable}
                        disabled={disabled}
                        onChange={(tlsEnable) => onChange({ tlsEnable })}
                      />
                    </FieldAnchor>

                    {values.tlsEnable ? (
                      <>
                        <Divider />
                        <SectionGrid>
                          <FieldAnchor fieldId="tlsCert">
                            <Input
                              label={t('config_management.visual.sections.tls.cert')}
                              placeholder="/path/to/cert.pem"
                              value={values.tlsCert}
                              onChange={(e) => onChange({ tlsCert: e.target.value })}
                              disabled={disabled}
                            />
                          </FieldAnchor>
                          <FieldAnchor fieldId="tlsKey">
                            <Input
                              label={t('config_management.visual.sections.tls.key')}
                              placeholder="/path/to/key.pem"
                              value={values.tlsKey}
                              onChange={(e) => onChange({ tlsKey: e.target.value })}
                              disabled={disabled}
                            />
                          </FieldAnchor>
                        </SectionGrid>
                      </>
                    ) : null}
                  </SectionStack>
                </Collapsible>

                <Collapsible
                  label={t('config_management.visual.sections.remote.title')}
                  hint={t('config_management.visual.sections.remote.description')}
                  defaultOpen={false}
                >
                  <SectionStack>
                    <SectionGrid>
                      <FieldAnchor fieldId="rmAllowRemote">
                        <ToggleRow
                          title={t('config_management.visual.sections.remote.allow_remote')}
                          description={t(
                            'config_management.visual.sections.remote.allow_remote_desc'
                          )}
                          checked={values.rmAllowRemote}
                          disabled={disabled}
                          onChange={(rmAllowRemote) => onChange({ rmAllowRemote })}
                        />
                      </FieldAnchor>
                      <FieldAnchor fieldId="rmDisableControlPanel">
                        <ToggleRow
                          title={t('config_management.visual.sections.remote.disable_panel')}
                          description={t(
                            'config_management.visual.sections.remote.disable_panel_desc'
                          )}
                          checked={values.rmDisableControlPanel}
                          disabled={disabled}
                          onChange={(rmDisableControlPanel) => onChange({ rmDisableControlPanel })}
                        />
                      </FieldAnchor>
                      <FieldAnchor fieldId="rmDisableAutoUpdatePanel">
                        <ToggleRow
                          title={t(
                            'config_management.visual.sections.remote.disable_auto_update_panel'
                          )}
                          description={t(
                            'config_management.visual.sections.remote.disable_auto_update_panel_desc'
                          )}
                          checked={values.rmDisableAutoUpdatePanel}
                          disabled={disabled}
                          onChange={(rmDisableAutoUpdatePanel) =>
                            onChange({ rmDisableAutoUpdatePanel })
                          }
                        />
                      </FieldAnchor>
                    </SectionGrid>
                    <SectionGrid>
                      <FieldAnchor fieldId="rmSecretKey">
                        <Input
                          label={t('config_management.visual.sections.remote.secret_key')}
                          type="password"
                          placeholder={t(
                            'config_management.visual.sections.remote.secret_key_placeholder'
                          )}
                          value={values.rmSecretKey}
                          onChange={(e) => onChange({ rmSecretKey: e.target.value })}
                          disabled={disabled}
                        />
                      </FieldAnchor>
                      <FieldAnchor fieldId="rmPanelRepo">
                        <Input
                          label={t('config_management.visual.sections.remote.panel_repo')}
                          placeholder="https://github.com/router-for-me/Cli-Proxy-API-Management-Center"
                          value={values.rmPanelRepo}
                          onChange={(e) => onChange({ rmPanelRepo: e.target.value })}
                          disabled={disabled}
                        />
                      </FieldAnchor>
                    </SectionGrid>
                  </SectionStack>
                </Collapsible>
              </SectionStack>
            </ConfigSection>

            <ConfigSection
              id="network"
              ref={(node) => {
                sectionRefs.current.network = node;
              }}
              indexLabel="02"
              icon={<IconNetwork size={16} />}
              title={t('config_management.visual.sections.network.title')}
              description={t('config_management.visual.sections.network.description')}
            >
              <SectionStack>
                <SectionGrid>
                  {proxyUrlField}
                  <FieldAnchor fieldId="requestRetry">
                    <Input
                      label={t('config_management.visual.sections.network.request_retry')}
                      type="number"
                      placeholder="3"
                      value={values.requestRetry}
                      onChange={(e) => onChange({ requestRetry: e.target.value })}
                      disabled={disabled}
                      error={requestRetryError}
                    />
                  </FieldAnchor>
                  <FieldAnchor fieldId="maxRetryCredentials">
                    <Input
                      label={t('config_management.visual.sections.network.max_retry_credentials')}
                      type="number"
                      placeholder="0"
                      value={values.maxRetryCredentials}
                      onChange={(e) => onChange({ maxRetryCredentials: e.target.value })}
                      disabled={disabled}
                      hint={t(
                        'config_management.visual.sections.network.max_retry_credentials_hint'
                      )}
                      error={maxRetryCredentialsError}
                    />
                  </FieldAnchor>
                  <FieldAnchor fieldId="maxRetryInterval">
                    <Input
                      label={t('config_management.visual.sections.network.max_retry_interval')}
                      type="number"
                      placeholder="30"
                      value={values.maxRetryInterval}
                      onChange={(e) => onChange({ maxRetryInterval: e.target.value })}
                      disabled={disabled}
                      error={maxRetryIntervalError}
                    />
                  </FieldAnchor>
                  <FieldAnchor fieldId="authAutoRefreshWorkers">
                    <Input
                      label={t(
                        'config_management.visual.sections.network.auth_auto_refresh_workers'
                      )}
                      type="number"
                      placeholder="16"
                      value={values.authAutoRefreshWorkers}
                      onChange={(e) => onChange({ authAutoRefreshWorkers: e.target.value })}
                      disabled={disabled}
                      hint={t(
                        'config_management.visual.sections.network.auth_auto_refresh_workers_hint'
                      )}
                      error={authAutoRefreshWorkersError}
                    />
                  </FieldAnchor>
                  <FieldAnchor fieldId="routingStrategy">
                    <FieldShell
                      label={t('config_management.visual.sections.network.routing_strategy')}
                      labelId={routingStrategyLabelId}
                      hint={t('config_management.visual.sections.network.routing_strategy_hint')}
                      hintId={routingStrategyHintId}
                    >
                      <Select
                        value={values.routingStrategy}
                        options={[
                          {
                            value: 'round-robin',
                            label: t(
                              'config_management.visual.sections.network.strategy_round_robin'
                            ),
                          },
                          {
                            value: 'fill-first',
                            label: t(
                              'config_management.visual.sections.network.strategy_fill_first'
                            ),
                          },
                        ]}
                        id={`${routingStrategyLabelId}-select`}
                        disabled={disabled}
                        ariaLabelledBy={routingStrategyLabelId}
                        ariaDescribedBy={routingStrategyHintId}
                        onChange={(nextValue) =>
                          onChange({
                            routingStrategy: nextValue as VisualConfigValues['routingStrategy'],
                          })
                        }
                      />
                    </FieldShell>
                  </FieldAnchor>
                  <FieldAnchor fieldId="disableImageGeneration">
                    <FieldShell
                      label={t(
                        'config_management.visual.sections.network.disable_image_generation'
                      )}
                      labelId={disableImageGenerationLabelId}
                      hint={t(
                        'config_management.visual.sections.network.disable_image_generation_hint'
                      )}
                      hintId={disableImageGenerationHintId}
                    >
                      <Select
                        value={values.disableImageGeneration}
                        options={disableImageGenerationOptions}
                        id={`${disableImageGenerationLabelId}-select`}
                        disabled={disabled}
                        ariaLabelledBy={disableImageGenerationLabelId}
                        ariaDescribedBy={disableImageGenerationHintId}
                        onChange={(nextValue) =>
                          onChange({
                            disableImageGeneration:
                              nextValue as VisualConfigValues['disableImageGeneration'],
                          })
                        }
                      />
                    </FieldShell>
                  </FieldAnchor>
                  <FieldAnchor fieldId="gptImage2BaseModel">
                    <Input
                      label={t('config_management.visual.sections.network.gpt_image_2_base_model')}
                      placeholder="gpt-5.4-mini"
                      value={values.gptImage2BaseModel}
                      onChange={(e) => onChange({ gptImage2BaseModel: e.target.value })}
                      disabled={disabled}
                      hint={t(
                        'config_management.visual.sections.network.gpt_image_2_base_model_hint'
                      )}
                    />
                  </FieldAnchor>
                  <FieldAnchor fieldId="routingSessionAffinityTTL">
                    <Input
                      label={t('config_management.visual.sections.network.session_affinity_ttl')}
                      placeholder="1h"
                      value={values.routingSessionAffinityTTL}
                      onChange={(e) => onChange({ routingSessionAffinityTTL: e.target.value })}
                      disabled={disabled}
                    />
                  </FieldAnchor>
                </SectionGrid>

                <SectionGrid>
                  <FieldAnchor fieldId="forceModelPrefix">
                    <ToggleRow
                      title={t('config_management.visual.sections.network.force_model_prefix')}
                      description={t(
                        'config_management.visual.sections.network.force_model_prefix_desc'
                      )}
                      checked={values.forceModelPrefix}
                      disabled={disabled}
                      onChange={(forceModelPrefix) => onChange({ forceModelPrefix })}
                    />
                  </FieldAnchor>
                  <FieldAnchor fieldId="passthroughHeaders">
                    <ToggleRow
                      title={t('config_management.visual.sections.network.passthrough_headers')}
                      description={t(
                        'config_management.visual.sections.network.passthrough_headers_desc'
                      )}
                      checked={values.passthroughHeaders}
                      disabled={disabled}
                      onChange={(passthroughHeaders) => onChange({ passthroughHeaders })}
                    />
                  </FieldAnchor>
                  <FieldAnchor fieldId="disableCooling">
                    <ToggleRow
                      title={t('config_management.visual.sections.network.disable_cooling')}
                      description={t(
                        'config_management.visual.sections.network.disable_cooling_desc'
                      )}
                      checked={values.disableCooling}
                      disabled={disabled}
                      onChange={(disableCooling) => onChange({ disableCooling })}
                    />
                  </FieldAnchor>
                  <FieldAnchor fieldId="routingSessionAffinity">
                    <ToggleRow
                      title={t('config_management.visual.sections.network.session_affinity')}
                      checked={values.routingSessionAffinity}
                      disabled={disabled}
                      onChange={(routingSessionAffinity) => onChange({ routingSessionAffinity })}
                    />
                  </FieldAnchor>
                  <FieldAnchor fieldId="wsAuth">
                    <ToggleRow
                      title={t('config_management.visual.sections.network.ws_auth')}
                      description={t('config_management.visual.sections.network.ws_auth_desc')}
                      checked={values.wsAuth}
                      disabled={disabled}
                      onChange={(wsAuth) => onChange({ wsAuth })}
                    />
                  </FieldAnchor>
                </SectionGrid>
              </SectionStack>
            </ConfigSection>

            <ConfigSection
              id="logging"
              ref={(node) => {
                sectionRefs.current.logging = node;
              }}
              indexLabel="03"
              icon={<IconScrollText size={16} />}
              title={t('config_management.visual.sections.logging.title')}
              description={t('config_management.visual.sections.logging.description')}
            >
              <SectionStack>
                <SectionGrid>
                  {debugToggle}
                  <FieldAnchor fieldId="commercialMode">
                    <ToggleRow
                      title={t('config_management.visual.sections.system.commercial_mode')}
                      description={t(
                        'config_management.visual.sections.system.commercial_mode_desc'
                      )}
                      checked={values.commercialMode}
                      disabled={disabled}
                      onChange={(commercialMode) => onChange({ commercialMode })}
                    />
                  </FieldAnchor>
                  {loggingToFileToggle}
                </SectionGrid>

                <SectionGrid>
                  <FieldAnchor fieldId="logsMaxTotalSizeMb">
                    <Input
                      label={t('config_management.visual.sections.system.logs_max_size')}
                      type="number"
                      placeholder="0"
                      value={values.logsMaxTotalSizeMb}
                      onChange={(e) => onChange({ logsMaxTotalSizeMb: e.target.value })}
                      disabled={disabled}
                      error={logsMaxSizeError}
                    />
                  </FieldAnchor>
                  <FieldAnchor fieldId="errorLogsMaxFiles">
                    <Input
                      label={t('config_management.visual.sections.system.error_logs_max_files')}
                      type="number"
                      placeholder="10"
                      value={values.errorLogsMaxFiles}
                      onChange={(e) => onChange({ errorLogsMaxFiles: e.target.value })}
                      disabled={disabled}
                      error={errorLogsMaxFilesError}
                    />
                  </FieldAnchor>
                  <FieldAnchor fieldId="redisUsageQueueRetentionSeconds">
                    <Input
                      label={t('config_management.visual.sections.system.redis_usage_retention')}
                      type="number"
                      placeholder="60"
                      value={values.redisUsageQueueRetentionSeconds}
                      onChange={(e) =>
                        onChange({ redisUsageQueueRetentionSeconds: e.target.value })
                      }
                      disabled={disabled}
                      hint={t(
                        'config_management.visual.sections.system.redis_usage_retention_hint'
                      )}
                      error={redisUsageQueueRetentionError}
                    />
                  </FieldAnchor>
                </SectionGrid>

                <SectionGrid>
                  <FieldAnchor fieldId="usageStatisticsEnabled">
                    <ToggleRow
                      title={t('config_management.visual.sections.system.usage_statistics_enabled')}
                      description={t(
                        'config_management.visual.sections.system.usage_statistics_enabled_desc'
                      )}
                      checked={values.usageStatisticsEnabled}
                      disabled={disabled}
                      onChange={(usageStatisticsEnabled) => onChange({ usageStatisticsEnabled })}
                    />
                  </FieldAnchor>
                </SectionGrid>
              </SectionStack>
            </ConfigSection>

            <ConfigSection
              id="quota"
              ref={(node) => {
                sectionRefs.current.quota = node;
              }}
              indexLabel="04"
              icon={<IconTimer size={16} />}
              title={t('config_management.visual.sections.quota.title')}
              description={t('config_management.visual.sections.quota.description')}
            >
              <SectionGrid>
                {quotaSwitchProjectToggle}
                {quotaSwitchPreviewModelToggle}
                <FieldAnchor fieldId="quotaAntigravityCredits">
                  <ToggleRow
                    title={t('config_management.visual.sections.quota.antigravity_credits')}
                    checked={values.quotaAntigravityCredits}
                    disabled={disabled}
                    onChange={(quotaAntigravityCredits) => onChange({ quotaAntigravityCredits })}
                  />
                </FieldAnchor>
              </SectionGrid>
            </ConfigSection>

            <ConfigSection
              id="streaming"
              ref={(node) => {
                sectionRefs.current.streaming = node;
              }}
              indexLabel="05"
              icon={<IconSatellite size={16} />}
              title={t('config_management.visual.sections.streaming.title')}
              description={t('config_management.visual.sections.streaming.description')}
            >
              <SectionStack>
                <SectionGrid>
                  <FieldAnchor fieldId="streamingKeepaliveSeconds">
                    <FieldShell
                      label={t('config_management.visual.sections.streaming.keepalive_seconds')}
                      htmlFor={keepaliveInputId}
                      hint={t('config_management.visual.sections.streaming.keepalive_hint')}
                      hintId={keepaliveHintId}
                      error={keepaliveError}
                      errorId={keepaliveErrorId}
                    >
                      <div className={styles.fieldControl}>
                        <input
                          id={keepaliveInputId}
                          className="input"
                          type="number"
                          placeholder="0"
                          value={values.streaming.keepaliveSeconds}
                          onChange={(e) =>
                            onChange({
                              streaming: {
                                ...values.streaming,
                                keepaliveSeconds: e.target.value,
                              },
                            })
                          }
                          disabled={disabled}
                        />
                        {isKeepaliveDisabled ? (
                          <span className={styles.inlinePill}>
                            {t('config_management.visual.sections.streaming.disabled')}
                          </span>
                        ) : null}
                      </div>
                    </FieldShell>
                  </FieldAnchor>

                  <FieldAnchor fieldId="streamingBootstrapRetries">
                    <Input
                      label={t('config_management.visual.sections.streaming.bootstrap_retries')}
                      type="number"
                      placeholder="1"
                      value={values.streaming.bootstrapRetries}
                      onChange={(e) =>
                        onChange({
                          streaming: {
                            ...values.streaming,
                            bootstrapRetries: e.target.value,
                          },
                        })
                      }
                      disabled={disabled}
                      hint={t('config_management.visual.sections.streaming.bootstrap_hint')}
                      error={bootstrapRetriesError}
                    />
                  </FieldAnchor>
                </SectionGrid>

                <SectionGrid>
                  <FieldAnchor fieldId="streamingNonstreamKeepalive">
                    <FieldShell
                      label={t('config_management.visual.sections.streaming.nonstream_keepalive')}
                      htmlFor={nonstreamKeepaliveInputId}
                      hint={t(
                        'config_management.visual.sections.streaming.nonstream_keepalive_hint'
                      )}
                      hintId={nonstreamKeepaliveHintId}
                      error={nonstreamKeepaliveError}
                      errorId={nonstreamKeepaliveErrorId}
                    >
                      <div className={styles.fieldControl}>
                        <input
                          id={nonstreamKeepaliveInputId}
                          className="input"
                          type="number"
                          placeholder="0"
                          value={values.streaming.nonstreamKeepaliveInterval}
                          onChange={(e) =>
                            onChange({
                              streaming: {
                                ...values.streaming,
                                nonstreamKeepaliveInterval: e.target.value,
                              },
                            })
                          }
                          disabled={disabled}
                        />
                        {isNonstreamKeepaliveDisabled ? (
                          <span className={styles.inlinePill}>
                            {t('config_management.visual.sections.streaming.disabled')}
                          </span>
                        ) : null}
                      </div>
                    </FieldShell>
                  </FieldAnchor>
                </SectionGrid>
              </SectionStack>
            </ConfigSection>

            <ConfigSection
              id="advanced"
              ref={(node) => {
                sectionRefs.current.advanced = node;
              }}
              indexLabel="06"
              icon={<IconShield size={16} />}
              title={t('config_management.visual.sections.advanced.title')}
              description={t('config_management.visual.sections.advanced.description')}
            >
              <SectionStack>
                <Collapsible
                  label={t('config_management.visual.sections.advanced.plugins_title')}
                  defaultOpen={false}
                >
                  <SectionStack>
                    <SectionGrid>
                      <FieldAnchor fieldId="pluginsEnabled">
                        <ToggleRow
                          title={t('config_management.visual.sections.system.plugins_enabled')}
                          description={t(
                            'config_management.visual.sections.system.plugins_enabled_desc'
                          )}
                          checked={values.pluginsEnabled}
                          disabled={disabled}
                          onChange={(pluginsEnabled) => onChange({ pluginsEnabled })}
                        />
                      </FieldAnchor>
                    </SectionGrid>

                    <FieldAnchor fieldId="pluginStoreSources">
                      <SectionSubsection
                        title={t('config_management.visual.sections.system.plugin_store_sources')}
                        description={t(
                          'config_management.visual.sections.system.plugin_store_sources_desc'
                        )}
                      >
                        <div className={styles.fieldShell}>
                          <label className={styles.fieldLabel}>
                            {t(
                              'config_management.visual.sections.system.plugin_store_sources_label'
                            )}
                          </label>
                          <StringListEditor
                            value={values.pluginStoreSources}
                            disabled={disabled}
                            placeholder={t(
                              'config_management.visual.sections.system.plugin_store_sources_placeholder'
                            )}
                            inputAriaLabel={t(
                              'config_management.visual.sections.system.plugin_store_sources_label'
                            )}
                            onChange={handlePluginStoreSourcesChange}
                          />
                          <div className={styles.fieldHint}>
                            {t(
                              'config_management.visual.sections.system.plugin_store_sources_hint'
                            )}
                          </div>
                        </div>
                      </SectionSubsection>
                    </FieldAnchor>

                    <FieldAnchor fieldId="pluginStoreAuth">
                      <SectionSubsection
                        title={t('config_management.visual.sections.system.plugin_store_auth')}
                        description={t(
                          'config_management.visual.sections.system.plugin_store_auth_desc'
                        )}
                      >
                        <div className={styles.fieldShell}>
                          <div className={styles.fieldHint}>
                            {t('config_management.visual.sections.system.plugin_store_auth_hint')}
                          </div>
                          <PluginStoreAuthEditor
                            value={values.pluginStoreAuth}
                            disabled={disabled}
                            onChange={handlePluginStoreAuthChange}
                          />
                        </div>
                      </SectionSubsection>
                    </FieldAnchor>
                  </SectionStack>
                </Collapsible>

                <Collapsible
                  label={t('config_management.visual.sections.advanced.signature_title')}
                  defaultOpen={false}
                >
                  <SectionGrid>
                    <FieldAnchor fieldId="antigravitySignatureCacheEnabled">
                      <ToggleRow
                        title={t(
                          'config_management.visual.sections.system.antigravity_signature_cache'
                        )}
                        description={t(
                          'config_management.visual.sections.system.antigravity_signature_cache_desc'
                        )}
                        checked={values.antigravitySignatureCacheEnabled}
                        disabled={disabled}
                        onChange={(antigravitySignatureCacheEnabled) =>
                          onChange({ antigravitySignatureCacheEnabled })
                        }
                      />
                    </FieldAnchor>
                    <FieldAnchor fieldId="antigravitySignatureBypassStrict">
                      <ToggleRow
                        title={t(
                          'config_management.visual.sections.system.antigravity_signature_strict'
                        )}
                        description={t(
                          'config_management.visual.sections.system.antigravity_signature_strict_desc'
                        )}
                        checked={values.antigravitySignatureBypassStrict}
                        disabled={disabled}
                        onChange={(antigravitySignatureBypassStrict) =>
                          onChange({ antigravitySignatureBypassStrict })
                        }
                      />
                    </FieldAnchor>
                  </SectionGrid>
                </Collapsible>

                <Collapsible
                  label={t('config_management.visual.sections.headers.title')}
                  hint={t('config_management.visual.sections.headers.description')}
                  defaultOpen={false}
                >
                  <SectionStack>
                    <div className={styles.subsectionHeader}>
                      <h3 className={styles.subsectionTitle}>
                        {t('config_management.visual.sections.headers.claude_title')}
                      </h3>
                    </div>
                    <SectionGrid>
                      <FieldAnchor fieldId="claudeHeaderUserAgent">
                        <Input
                          label={t('config_management.visual.sections.headers.user_agent')}
                          placeholder="claude-cli/2.1.44 (external, sdk-cli)"
                          value={values.claudeHeaderUserAgent}
                          onChange={(e) => onChange({ claudeHeaderUserAgent: e.target.value })}
                          disabled={disabled}
                        />
                      </FieldAnchor>
                      <FieldAnchor fieldId="claudeHeaderPackageVersion">
                        <Input
                          label={t('config_management.visual.sections.headers.package_version')}
                          placeholder="0.74.0"
                          value={values.claudeHeaderPackageVersion}
                          onChange={(e) => onChange({ claudeHeaderPackageVersion: e.target.value })}
                          disabled={disabled}
                        />
                      </FieldAnchor>
                      <FieldAnchor fieldId="claudeHeaderRuntimeVersion">
                        <Input
                          label={t('config_management.visual.sections.headers.runtime_version')}
                          placeholder="v24.3.0"
                          value={values.claudeHeaderRuntimeVersion}
                          onChange={(e) => onChange({ claudeHeaderRuntimeVersion: e.target.value })}
                          disabled={disabled}
                        />
                      </FieldAnchor>
                      <FieldAnchor fieldId="claudeHeaderOs">
                        <Input
                          label={t('config_management.visual.sections.headers.os')}
                          placeholder="MacOS"
                          value={values.claudeHeaderOs}
                          onChange={(e) => onChange({ claudeHeaderOs: e.target.value })}
                          disabled={disabled}
                        />
                      </FieldAnchor>
                      <FieldAnchor fieldId="claudeHeaderArch">
                        <Input
                          label={t('config_management.visual.sections.headers.arch')}
                          placeholder="arm64"
                          value={values.claudeHeaderArch}
                          onChange={(e) => onChange({ claudeHeaderArch: e.target.value })}
                          disabled={disabled}
                        />
                      </FieldAnchor>
                      <FieldAnchor fieldId="claudeHeaderTimeout">
                        <Input
                          label={t('config_management.visual.sections.headers.timeout')}
                          placeholder="600"
                          value={values.claudeHeaderTimeout}
                          onChange={(e) => onChange({ claudeHeaderTimeout: e.target.value })}
                          disabled={disabled}
                        />
                      </FieldAnchor>
                    </SectionGrid>
                    <SectionGrid>
                      <FieldAnchor fieldId="claudeHeaderStabilizeDeviceProfile">
                        <ToggleRow
                          title={t('config_management.visual.sections.headers.stabilize_device')}
                          description={t(
                            'config_management.visual.sections.headers.stabilize_device_desc'
                          )}
                          checked={values.claudeHeaderStabilizeDeviceProfile}
                          disabled={disabled}
                          onChange={(claudeHeaderStabilizeDeviceProfile) =>
                            onChange({ claudeHeaderStabilizeDeviceProfile })
                          }
                        />
                      </FieldAnchor>
                    </SectionGrid>
                    <Divider />
                    <div className={styles.subsectionHeader}>
                      <h3 className={styles.subsectionTitle}>
                        {t('config_management.visual.sections.headers.codex_title')}
                      </h3>
                    </div>
                    <SectionGrid>
                      <FieldAnchor fieldId="codexHeaderUserAgent">
                        <Input
                          label={t('config_management.visual.sections.headers.user_agent')}
                          placeholder="codex_cli_rs/0.114.0 (Mac OS 14.2.0; x86_64) vscode/1.111.0"
                          value={values.codexHeaderUserAgent}
                          onChange={(e) => onChange({ codexHeaderUserAgent: e.target.value })}
                          disabled={disabled}
                        />
                      </FieldAnchor>
                      <FieldAnchor fieldId="codexHeaderBetaFeatures">
                        <Input
                          label={t('config_management.visual.sections.headers.beta_features')}
                          placeholder="multi_agent"
                          value={values.codexHeaderBetaFeatures}
                          onChange={(e) => onChange({ codexHeaderBetaFeatures: e.target.value })}
                          disabled={disabled}
                        />
                      </FieldAnchor>
                    </SectionGrid>
                    <SectionGrid>
                      <FieldAnchor fieldId="codexIdentityConfuse">
                        <ToggleRow
                          title={t(
                            'config_management.visual.sections.headers.codex_identity_confuse'
                          )}
                          description={t(
                            'config_management.visual.sections.headers.codex_identity_confuse_desc'
                          )}
                          checked={values.codexIdentityConfuse}
                          disabled={disabled}
                          onChange={(codexIdentityConfuse) => onChange({ codexIdentityConfuse })}
                        />
                      </FieldAnchor>
                    </SectionGrid>
                  </SectionStack>
                </Collapsible>
              </SectionStack>
            </ConfigSection>

            <ConfigSection
              id="payload"
              ref={(node) => {
                sectionRefs.current.payload = node;
              }}
              indexLabel="07"
              icon={<IconCode size={16} />}
              title={t('config_management.visual.sections.payload.title')}
              description={t('config_management.visual.sections.payload.description')}
            >
              <SectionStack>
                <FieldAnchor fieldId="payloadDefaultRules">
                  <Collapsible
                    key={`payloadDefaultRules-${payloadValidationKey}`}
                    label={t('config_management.visual.sections.payload.default_rules')}
                    hint={t('config_management.visual.sections.payload.default_rules_desc')}
                    defaultOpen={hasPayloadValidationErrors}
                  >
                    <PayloadRulesEditor
                      value={values.payloadDefaultRules}
                      disabled={disabled}
                      onChange={handlePayloadDefaultRulesChange}
                    />
                  </Collapsible>
                </FieldAnchor>

                <FieldAnchor fieldId="payloadDefaultRawRules">
                  <Collapsible
                    key={`payloadDefaultRawRules-${payloadValidationKey}`}
                    label={t('config_management.visual.sections.payload.default_raw_rules')}
                    hint={t('config_management.visual.sections.payload.default_raw_rules_desc')}
                    defaultOpen={hasPayloadValidationErrors}
                  >
                    <PayloadRulesEditor
                      value={values.payloadDefaultRawRules}
                      disabled={disabled}
                      rawJsonValues
                      onChange={handlePayloadDefaultRawRulesChange}
                    />
                  </Collapsible>
                </FieldAnchor>

                <FieldAnchor fieldId="payloadOverrideRules">
                  <Collapsible
                    key={`payloadOverrideRules-${payloadValidationKey}`}
                    label={t('config_management.visual.sections.payload.override_rules')}
                    hint={t('config_management.visual.sections.payload.override_rules_desc')}
                    defaultOpen={hasPayloadValidationErrors}
                  >
                    <PayloadRulesEditor
                      value={values.payloadOverrideRules}
                      disabled={disabled}
                      protocolFirst
                      onChange={handlePayloadOverrideRulesChange}
                    />
                  </Collapsible>
                </FieldAnchor>

                <FieldAnchor fieldId="payloadOverrideRawRules">
                  <Collapsible
                    key={`payloadOverrideRawRules-${payloadValidationKey}`}
                    label={t('config_management.visual.sections.payload.override_raw_rules')}
                    hint={t('config_management.visual.sections.payload.override_raw_rules_desc')}
                    defaultOpen={hasPayloadValidationErrors}
                  >
                    <PayloadRulesEditor
                      value={values.payloadOverrideRawRules}
                      disabled={disabled}
                      protocolFirst
                      rawJsonValues
                      onChange={handlePayloadOverrideRawRulesChange}
                    />
                  </Collapsible>
                </FieldAnchor>

                <FieldAnchor fieldId="payloadFilterRules">
                  <Collapsible
                    key={`payloadFilterRules-${payloadValidationKey}`}
                    label={t('config_management.visual.sections.payload.filter_rules')}
                    hint={t('config_management.visual.sections.payload.filter_rules_desc')}
                    defaultOpen={hasPayloadValidationErrors}
                  >
                    <PayloadFilterRulesEditor
                      value={values.payloadFilterRules}
                      disabled={disabled}
                      onChange={handlePayloadFilterRulesChange}
                    />
                  </Collapsible>
                </FieldAnchor>
              </SectionStack>
            </ConfigSection>
          </div>
        </div>
      )}
    </div>
  );
}
