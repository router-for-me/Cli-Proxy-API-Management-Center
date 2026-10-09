import { useId, useState, type CSSProperties } from 'react';
import { IconExternalLink, IconPlus } from '@/components/ui/icons';
import type { ProviderFlowState } from '../hooks/useOAuthFlows';
import { BrandGlyph } from './BrandGlyph';
import styles from './ProviderTile.module.scss';

/** 首屏磁贴级联：起点让位给头部（140ms），级差 30ms，整组封顶 360ms。 */
const TILE_BASE_DELAY_MS = 140;
const TILE_STAGGER_MS = 30;
const TILE_MAX_DELAY_MS = 360;

export interface ProviderTileProps {
  label: string;
  caption: string;
  icon: string;
  index: number;
  status?: ProviderFlowState['status'];
  statusLabel?: string;
  /** 赞助商变体：更大的卡、品牌蓝强调、常驻「立即注册」药丸。 */
  sponsor?: { url: string; label: string };
  onOpen: () => void;
}

/**
 * 提供商磁贴：整块可点（stretched button），点击即开始登录并打开授权对话框。
 * 副行平时说明登录方式，登录进行中改为实时状态 —— 对话框关着也能看到后台进度。
 * 赞助商变体的注册药丸是独立的第二个可聚焦目标，浮在 stretched 层之上。
 */
export function ProviderTile({
  label,
  caption,
  icon,
  index,
  status,
  statusLabel,
  sponsor,
  onOpen,
}: ProviderTileProps) {
  const captionId = useId();
  // 挂载时捕获延迟：之后的重渲染（状态轮询）不重播入场
  const [enterDelay] = useState(
    () => `${Math.min(TILE_BASE_DELAY_MS + index * TILE_STAGGER_MS, TILE_MAX_DELAY_MS)}ms`
  );

  return (
    <div
      className={sponsor ? `${styles.tile} ${styles.sponsor}` : styles.tile}
      data-status={status ?? 'idle'}
      style={{ '--tile-delay': enterDelay } as CSSProperties}
    >
      <span className={styles.glyph}>
        <BrandGlyph src={icon} size={sponsor ? 40 : 20} className={styles.glyphImage} />
      </span>
      <span className={styles.text}>
        <button
          type="button"
          className={styles.main}
          onClick={onOpen}
          aria-haspopup="dialog"
          aria-describedby={captionId}
        >
          {label}
        </button>
        <span className={styles.caption} id={captionId}>
          {status && statusLabel ? (
            <span className={styles.status}>
              <span className={styles.statusDot} aria-hidden="true" />
              {statusLabel}
            </span>
          ) : (
            <span className={styles.captionText}>{caption}</span>
          )}
        </span>
      </span>
      {sponsor && (
        <a
          className={styles.sponsorLink}
          href={sponsor.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {sponsor.label}
          <IconExternalLink size={12} aria-hidden="true" />
        </a>
      )}
      <span className={styles.trail} aria-hidden="true">
        <IconPlus size={15} />
      </span>
    </div>
  );
}
