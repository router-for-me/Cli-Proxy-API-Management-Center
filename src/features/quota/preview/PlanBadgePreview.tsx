/**
 * DEV-ONLY preview: plan badge direction A vs. the current badges.
 *
 * Registered in App.tsx only when `import.meta.env.DEV` is true, outside the
 * auth guard, so it can be opened without a backend or real accounts:
 *   http://localhost:5173/#/__preview/plan-badge
 * All data is mocked. Copy is intentionally not localized — this page never
 * ships and is deleted once a direction is chosen.
 */

import { useState, type CSSProperties } from 'react';
import { useThemeStore } from '@/stores';
import type { Theme } from '@/types';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import {
  PLAN_BADGE_PALETTES,
  PlanBadge,
  type PlanBadgePalette,
  type PlanBadgeTier,
} from '../components/PlanBadge';
import bodyStyles from '../components/QuotaBody.module.scss';
import cardStyles from '../components/QuotaCard.module.scss';
import pageStyles from '../QuotaPage.module.scss';
import styles from './PlanBadgePreview.module.scss';

type LegacyTier = 'elite' | 'premium' | 'plain';

interface MockWindow {
  label: string;
  remaining: number;
  reset: string;
  relative: string;
}

interface MockAccount {
  provider: string;
  file: string;
  label: string;
  tier: PlanBadgeTier;
  legacy: LegacyTier;
  /** Tier assignment is a proposal, not current behavior. */
  proposed?: boolean;
  windows: MockWindow[];
}

const ACCOUNTS: MockAccount[] = [
  {
    provider: 'codex',
    file: 'codex-pro200-main.json',
    label: 'Pro 200',
    tier: 'flagship',
    legacy: 'elite',
    windows: [
      { label: '5 小时', remaining: 82, reset: '10-26 14:20', relative: '2 小时后' },
      { label: '每周', remaining: 46, reset: '10-30 09:00', relative: '4 天后' },
    ],
  },
  {
    provider: 'claude',
    file: 'claude-max20-team.json',
    label: 'Max 20x',
    tier: 'flagship',
    legacy: 'plain',
    proposed: true,
    windows: [
      { label: '5 小时', remaining: 64, reset: '10-26 15:05', relative: '3 小时后' },
      { label: '每周 · 全部模型', remaining: 28, reset: '10-29 08:00', relative: '3 天后' },
    ],
  },
  {
    provider: 'antigravity',
    file: 'antigravity-ultra.json',
    label: 'Ultra',
    tier: 'flagship',
    legacy: 'premium',
    proposed: true,
    windows: [
      { label: 'Gemini 3 Pro', remaining: 91, reset: '10-26 18:00', relative: '6 小时后' },
      { label: 'Claude Sonnet', remaining: 73, reset: '10-26 18:00', relative: '6 小时后' },
    ],
  },
  {
    provider: 'xai',
    file: 'grok-heavy.json',
    label: 'SuperGrok Heavy',
    tier: 'flagship',
    legacy: 'elite',
    windows: [{ label: '本月额度', remaining: 57, reset: '11-01 00:00', relative: '6 天后' }],
  },
  {
    provider: 'codex',
    file: 'codex-pro100.json',
    label: 'Pro 100',
    tier: 'premium',
    legacy: 'premium',
    windows: [
      { label: '5 小时', remaining: 18, reset: '10-26 12:40', relative: '28 分钟后' },
      { label: '每周', remaining: 52, reset: '10-31 09:00', relative: '5 天后' },
    ],
  },
  {
    provider: 'xai',
    file: 'grok-supergrok.json',
    label: 'SuperGrok',
    tier: 'premium',
    legacy: 'premium',
    windows: [{ label: '本月额度', remaining: 34, reset: '11-01 00:00', relative: '6 天后' }],
  },
  {
    provider: 'codex',
    file: 'codex-plus.json',
    label: 'Plus',
    tier: 'standard',
    legacy: 'plain',
    windows: [
      { label: '5 小时', remaining: 100, reset: '10-26 16:00', relative: '4 小时后' },
      { label: '每周', remaining: 71, reset: '11-01 09:00', relative: '6 天后' },
    ],
  },
  {
    provider: 'claude',
    file: 'claude-pro.json',
    label: 'Pro',
    tier: 'standard',
    legacy: 'plain',
    windows: [{ label: '5 小时', remaining: 9, reset: '10-26 12:30', relative: '18 分钟后' }],
  },
];

const PALETTE_INFO: Record<PlanBadgePalette, { name: string; note: string }> = {
  jilan: { name: '霁蓝 · 嵌松石', note: '祭祀用的深钴蓝釉，最端庄；不与任何额度语义色相撞' },
  songshi: { name: '松石 · 嵌珊瑚', note: '景泰蓝的招牌色，清透；色相离额度条绿色较近' },
  yanzhi: { name: '胭脂 · 嵌松石', note: '珐琅彩最名贵的胭脂红地，偏洋红，与警告红可区分' },
  qiepi: { name: '茄皮紫 · 嵌柠檬黄', note: '传统低温釉，沉静华贵；嵌黄与「中等剩余」黄同系' },
};

const OVERVIEW_SAMPLES: { tier: PlanBadgeTier; label: string }[] = [
  { tier: 'standard', label: 'Plus' },
  { tier: 'premium', label: 'Pro 100' },
  { tier: 'flagship', label: 'Pro 200' },
];

/** Semantic meter colors the badge palette must not collide with. */
const SEMANTIC_METERS = [86, 48, 14];

const THEMES: { value: Theme; label: string }[] = [
  { value: 'light', label: '纸感' },
  { value: 'white', label: '纯白' },
  { value: 'dark', label: '暗色' },
];

type Variant = 'new' | 'legacy';

const CARD_STAGGER_MS = 60;
/** Sheen starts once the card's 450ms entrance has mostly settled. */
const SHEEN_AFTER_CARD_MS = 320;

function LegacyBadge({ tier, label }: { tier: LegacyTier; label: string }) {
  const className =
    tier === 'elite'
      ? bodyStyles.elitePlanValue
      : tier === 'premium'
        ? bodyStyles.premiumPlanValue
        : bodyStyles.codexPlanValue;
  return <span className={className}>{label}</span>;
}

function meterClass(remaining: number): string {
  if (remaining >= 70) return bodyStyles.quotaBarFillHigh;
  if (remaining >= 30) return bodyStyles.quotaBarFillMedium;
  return bodyStyles.quotaBarFillLow;
}

function MockCard({
  account,
  variant,
  index,
  resolvedTheme,
}: {
  account: MockAccount;
  variant: Variant;
  index: number;
  resolvedTheme: 'light' | 'dark';
}) {
  const icon = getAuthFileIcon(account.provider, resolvedTheme);
  const cardDelay = index * CARD_STAGGER_MS;
  const urgentIndex = account.windows.findIndex((w) => w.relative.includes('分钟'));

  return (
    <article
      className={`${cardStyles.card} ${cardStyles.cardEnter}`}
      style={{ '--card-delay': `${cardDelay}ms` } as CSSProperties}
    >
      <header className={cardStyles.head}>
        <span
          className={cardStyles.iconWrap}
          style={
            isThemeSurfaceIconProvider(account.provider)
              ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
              : undefined
          }
        >
          {icon && <img src={icon} alt="" className={cardStyles.icon} />}
        </span>
        <span className={cardStyles.fileName}>{account.file}</span>
      </header>
      <div className={cardStyles.body}>
        <div className={bodyStyles.codexPlan}>
          <span className={bodyStyles.codexPlanItem}>
            <span className={bodyStyles.codexPlanLabel}>套餐</span>
            {variant === 'new' ? (
              <PlanBadge
                tier={account.tier}
                label={account.label}
                arrive
                arriveDelayMs={cardDelay + SHEEN_AFTER_CARD_MS}
              />
            ) : (
              <LegacyBadge tier={account.legacy} label={account.label} />
            )}
          </span>
          <span className={bodyStyles.codexPlanItem}>
            <span className={bodyStyles.codexPlanLabel}>到期</span>
            <span className={bodyStyles.codexPlanValue}>11-24 08:00</span>
          </span>
        </div>
        {account.windows.map((w, i) => (
          <div key={w.label} className={bodyStyles.quotaRow}>
            <div className={bodyStyles.quotaRowHeader}>
              <span className={bodyStyles.quotaModel}>{w.label}</span>
              <div className={bodyStyles.quotaMeta}>
                <span className={bodyStyles.quotaPercent}>{w.remaining}%</span>
                <span className={bodyStyles.quotaReset}>{w.reset}</span>
                <span
                  className={
                    i === urgentIndex
                      ? `${bodyStyles.quotaResetRelative} ${bodyStyles.quotaResetRelativeSoon}`
                      : bodyStyles.quotaResetRelative
                  }
                >
                  {w.relative}
                </span>
              </div>
            </div>
            <div className={bodyStyles.quotaBar}>
              <div
                className={`${bodyStyles.quotaBarFill} ${meterClass(w.remaining)}`}
                style={{ width: `${w.remaining}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

export function PlanBadgePreview() {
  const theme = useThemeStore((state) => state.theme);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const [variant, setVariant] = useState<Variant>('new');
  const [palette, setPalette] = useState<PlanBadgePalette>('jilan');
  const [replayKey, setReplayKey] = useState(0);
  const replay = () => setReplayKey((key) => key + 1);

  return (
    <div className={styles.page} data-plan-palette={palette}>
      <header className={styles.toolbar}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>套餐徽章 · 珐琅</h1>
          <p className={styles.subtitle}>
            开发环境预览，全部为模拟数据。高级 = 单色釉；旗舰 = 掐丝珐琅（深宝石釉 + 金丝 +
            嵌填菱形）。玻璃釉反光、边深中浅、底部透光。徽章本体不循环。
          </p>
        </div>
        <div className={styles.controls}>
          <div className={styles.segmented} role="group" aria-label="主题">
            {THEMES.map((option) => (
              <button
                key={option.value}
                type="button"
                className={styles.segment}
                aria-pressed={theme === option.value}
                onClick={() => setTheme(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button type="button" className={styles.replay} onClick={replay}>
            重播到达动画
          </button>
        </div>
      </header>

      <section key={`overview-${replayKey}`} className={styles.section}>
        <h2 className={styles.sectionTitle}>色板总览（点一行应用到下方卡片）</h2>
        <div className={styles.paletteList} role="radiogroup" aria-label="色板">
          {PLAN_BADGE_PALETTES.map((key, row) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={palette === key}
              className={styles.paletteRow}
              data-plan-palette={key}
              onClick={() => {
                setPalette(key);
                setVariant('new');
                replay();
              }}
            >
              <span className={styles.paletteName}>
                <span className={styles.paletteTitle}>{PALETTE_INFO[key].name}</span>
                <span className={styles.paletteNote}>{PALETTE_INFO[key].note}</span>
              </span>
              <span className={styles.paletteSamples}>
                {OVERVIEW_SAMPLES.map((sample) => (
                  <PlanBadge
                    key={sample.label}
                    tier={sample.tier}
                    label={sample.label}
                    arrive={sample.tier !== 'standard'}
                    arriveDelayMs={row * CARD_STAGGER_MS}
                  />
                ))}
              </span>
              <span className={styles.paletteMeters} aria-hidden="true">
                {SEMANTIC_METERS.map((value) => (
                  <span key={value} className={bodyStyles.quotaBar}>
                    <span
                      className={`${bodyStyles.quotaBarFill} ${meterClass(value)}`}
                      style={{ width: `${value}%`, display: 'block' }}
                    />
                  </span>
                ))}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>
            卡片中的效果（4 张旗舰同屏）· 当前色板：{PALETTE_INFO[palette].name}
          </h2>
          <div className={styles.segmented} role="group" aria-label="版本">
            <button
              type="button"
              className={styles.segment}
              aria-pressed={variant === 'new'}
              onClick={() => {
                setVariant('new');
                replay();
              }}
            >
              新配色
            </button>
            <button
              type="button"
              className={styles.segment}
              aria-pressed={variant === 'legacy'}
              onClick={() => {
                setVariant('legacy');
                replay();
              }}
            >
              旧版
            </button>
          </div>
        </div>
        <div key={`grid-${replayKey}`} className={pageStyles.grid}>
          {ACCOUNTS.map((account, index) => (
            <MockCard
              key={account.file}
              account={account}
              variant={variant}
              index={index}
              resolvedTheme={resolvedTheme}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
