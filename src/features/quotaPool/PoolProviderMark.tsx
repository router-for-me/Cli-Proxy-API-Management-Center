import type { PoolProviderId } from '@/domain/quotaPool/types';
import { PROVIDER_LOGOS } from '@/features/providers/brandLogos';
import styles from './QuotaPoolPage.module.scss';

export function PoolProviderMark({ provider }: { provider: PoolProviderId }) {
  // The Antigravity pool is named Gemini, so it carries the Gemini mark.
  const logo = PROVIDER_LOGOS[provider === 'antigravity' ? 'gemini' : provider];
  return <img className={styles.providerMark} src={logo.src} alt="" />;
}
