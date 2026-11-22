import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { scrollProviderTabs } from '@/features/authFiles/components/providerTabsWheel';
import { partitionProviderGroups } from '../resourceView';
import type { ProviderBrand, ProviderGroup } from '../types';
import { BrandLogo } from './BrandLogo';
import styles from './BrandTabs.module.scss';

interface BrandTabsProps {
  groups: ProviderGroup[];
  activeBrand: ProviderBrand;
  onSelect: (brand: ProviderBrand) => void;
  /** Builds the id shared by a tab and the panel it controls. */
  tabId: (brand: ProviderBrand) => string;
  panelId: string;
}

/**
 * Brand strip: quiet underline tabs, brand colour only in the mark. Partner
 * "quick fill" brands sit after a hairline so the regular providers read first.
 * Arrow keys move selection (automatic activation; switching is cheap).
 */
export function BrandTabs({ groups, activeBrand, onSelect, tabId, panelId }: BrandTabsProps) {
  const { t } = useTranslation();
  const stripRef = useRef<HTMLDivElement>(null);
  const { providers, quickFill } = partitionProviderGroups(groups);
  const ordered = [...providers, ...quickFill];

  const [overflow, setOverflow] = useState({ start: false, end: false });

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => scrollProviderTabs(strip, event);
    // Fade only the edges that actually hide tabs, so the strip never looks cut off for nothing.
    const measure = () => {
      const max = strip.scrollWidth - strip.clientWidth;
      const next = { start: strip.scrollLeft > 1, end: strip.scrollLeft < max - 1 };
      setOverflow((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
    };
    measure();
    strip.addEventListener('wheel', onWheel, { passive: false });
    strip.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(strip);
    return () => {
      strip.removeEventListener('wheel', onWheel);
      strip.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [groups.length]);

  // Keep the active tab visible when it changes (narrow screens scroll the strip).
  useEffect(() => {
    const active = stripRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeBrand]);

  const focusBrand = (brand: ProviderBrand) => {
    onSelect(brand);
    // Focus after React commits the new roving tabindex.
    requestAnimationFrame(() => document.getElementById(tabId(brand))?.focus());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = ordered.findIndex((group) => group.id === activeBrand);
    if (index < 0 || ordered.length === 0) return;
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % ordered.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + ordered.length) % ordered.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ordered.length - 1;
    if (next < 0) return;
    event.preventDefault();
    focusBrand(ordered[next].id);
  };

  const renderTab = (group: ProviderGroup) => {
    const active = group.id === activeBrand;
    const total = group.resources.length;
    const disabledCount = group.resources.filter((resource) => resource.disabled).length;
    return (
      <button
        key={group.id}
        id={tabId(group.id)}
        type="button"
        role="tab"
        aria-selected={active}
        aria-controls={panelId}
        tabIndex={active ? 0 : -1}
        className={`${styles.tab} ${active ? styles.tabActive : ''}`}
        onClick={() => onSelect(group.id)}
        onKeyDown={handleKeyDown}
      >
        <BrandLogo brand={group.id} size={18} />
        <span className={styles.label}>{t(`providersPage.providerNames.${group.id}`)}</span>
        {total > 0 ? (
          <span
            className={styles.count}
            title={t('providersPage.categories.activeCount', {
              active: total - disabledCount,
              total,
            })}
          >
            {total}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <div
      ref={stripRef}
      className={styles.strip}
      data-overflow-start={overflow.start || undefined}
      data-overflow-end={overflow.end || undefined}
      role="tablist"
      aria-label={t('providersPage.categories.title')}
    >
      {providers.map(renderTab)}
      {quickFill.length > 0 ? (
        <>
          <span className={styles.divider} aria-hidden="true">
            <span className={styles.dividerLabel}>{t('providersPage.categories.quickFill')}</span>
          </span>
          {quickFill.map(renderTab)}
        </>
      ) : null}
    </div>
  );
}
