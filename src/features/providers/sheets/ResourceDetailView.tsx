import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/Collapsible';
import { IconCheck, IconX } from '@/components/ui/icons';
import {
  getProviderTotalStats,
  type ProviderRecentUsageMap,
} from '@/components/providers/utils';
import type { OpenAIProviderConfig } from '@/types';
import { maskApiKey } from '@/utils/format';
import {
  getApiKeyFunProtocolUrls,
  resolveApiKeyFunBaseUrl,
} from '../sponsor';
import type { ProviderResource, SponsorProviderRaw } from '../types';
import styles from './forms/sharedForm.module.scss';

interface ResourceDetailViewProps {
  resource: ProviderResource;
  usageByProvider?: ProviderRecentUsageMap;
}

export function ResourceDetailView({ resource, usageByProvider }: ResourceDetailViewProps) {
  const { t } = useTranslation();

  if (resource.brand === 'apikeyFun') {
    const raw = resource.raw as SponsorProviderRaw;
    const openaiKeyCount = raw.openai.reduce(
      (count, item) => count + (item.config.apiKeyEntries?.length ?? 0),
      0
    );
    const codexKeyCount = raw.codex.length;
    const firstKey =
      raw.openai
        .flatMap((item) => item.config.apiKeyEntries ?? [])
        .find((entry) => entry.apiKey?.trim())?.apiKey ??
      raw.codex.find((item) => item.config.apiKey?.trim())?.config.apiKey ??
      raw.claude.find((item) => item.config.apiKey?.trim())?.config.apiKey;
    const baseUrl = resolveApiKeyFunBaseUrl(
      raw.openai[0]?.config.baseUrl ??
        raw.codex[0]?.config.baseUrl ??
        raw.claude[0]?.config.baseUrl
    );
    const protocolUrls = getApiKeyFunProtocolUrls(baseUrl);

    return (
      <div>
        <div className={styles.detailHeader}>
          <div className={styles.sectionTitle}>{resource.name ?? resource.identifier}</div>
          <p className={styles.sectionDesc}>{t('providersPage.sponsor.detailHint')}</p>
        </div>

        <div className={styles.sponsorProtocolGrid}>
          <div className={styles.sponsorProtocolCard}>
            <span className={styles.sponsorProtocolName}>
              {t('providersPage.sponsor.protocols.anthropic')}
            </span>
            <span className={styles.sponsorProtocolUrl}>{protocolUrls.anthropic}</span>
          </div>
          <div className={styles.sponsorProtocolCard}>
            <span className={styles.sponsorProtocolName}>
              {t('providersPage.sponsor.protocols.openai')}
            </span>
            <span className={styles.sponsorProtocolUrl}>{protocolUrls.openai}</span>
          </div>
          <div className={styles.sponsorProtocolCard}>
            <span className={styles.sponsorProtocolName}>
              {t('providersPage.sponsor.protocols.codexResponses')}
            </span>
            <span className={styles.sponsorProtocolUrl}>{protocolUrls.codex}</span>
          </div>
        </div>

        <dl className={styles.dl} style={{ marginTop: 16 }}>
          <div>
            <dt className={styles.dt}>{t('providersPage.detail.fields.identifier')}</dt>
            <dd className={styles.dd}>{firstKey ? maskApiKey(firstKey) : resource.identifier}</dd>
          </div>
          <div>
            <dt className={styles.dt}>{t('providersPage.detail.fields.prefix')}</dt>
            <dd className={styles.dd}>{resource.prefix ?? t('providersPage.status.none')}</dd>
          </div>
          <div>
            <dt className={styles.dt}>{t('providersPage.sponsor.openaiEntries')}</dt>
            <dd className={styles.dd}>{openaiKeyCount}</dd>
          </div>
          <div>
            <dt className={styles.dt}>{t('providersPage.sponsor.codexEntries')}</dt>
            <dd className={styles.dd}>{codexKeyCount}</dd>
          </div>
          <div>
            <dt className={styles.dt}>{t('providersPage.sponsor.anthropicEntries')}</dt>
            <dd className={styles.dd}>{raw.claude.length}</dd>
          </div>
        </dl>
      </div>
    );
  }

  const primary: Array<[string, string]> = [
    ['identifier', resource.identifier],
    ['baseUrl', resource.baseUrl ?? t('providersPage.status.notSet')],
    ['proxyUrl', resource.proxyUrl ?? t('providersPage.status.notSet')],
    ['prefix', resource.prefix ?? t('providersPage.status.none')],
    ['models', String(resource.modelCount)],
    ['headers', String(resource.headerCount)],
  ];

  const metadata: Array<[string, string]> = [
    ['authIndex', resource.authIndex ?? t('providersPage.status.notSet')],
    ['excludedModels', String(resource.excludedModelCount)],
    ['apiKeyEntries', String(resource.apiKeyEntryCount)],
  ];

  const openaiConfig =
    resource.brand === 'openaiCompatibility'
      ? (resource.raw as OpenAIProviderConfig)
      : null;
  const apiKeyEntries = openaiConfig?.apiKeyEntries ?? [];

  return (
    <div>
      <div className={styles.detailHeader}>
        <div className={styles.sectionTitle}>
          {resource.name ?? resource.identifier}
        </div>
      </div>

      <dl className={styles.dl}>
        {primary.map(([key, value]) => (
          <div key={key}>
            <dt className={styles.dt}>{t(`providersPage.detail.fields.${key}`)}</dt>
            <dd className={styles.dd}>{value}</dd>
          </div>
        ))}
      </dl>

      {openaiConfig && apiKeyEntries.length > 0 ? (
        <div className={styles.apiKeyEntriesSection}>
          <div className={styles.apiKeyEntriesLabel}>
            {t('providersPage.form.apiKeyEntriesSection')}: {apiKeyEntries.length}
          </div>
          <div className={styles.apiKeyEntryList}>
            {apiKeyEntries.map((entry, entryIndex) => {
              const entryStats = usageByProvider
                ? getProviderTotalStats(
                    usageByProvider,
                    openaiConfig.name,
                    entry.apiKey,
                    openaiConfig.baseUrl
                  )
                : { success: 0, failure: 0 };
              return (
                <div
                  key={`${entry.apiKey}-${entryIndex}`}
                  className={styles.apiKeyEntryCard}
                >
                  <span className={styles.apiKeyEntryIndex}>{entryIndex + 1}</span>
                  <span className={styles.apiKeyEntryKey}>{maskApiKey(entry.apiKey)}</span>
                  {entry.proxyUrl ? (
                    <span className={styles.apiKeyEntryProxy}>{entry.proxyUrl}</span>
                  ) : null}
                  <div className={styles.apiKeyEntryStats}>
                    <span
                      className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatSuccess}`}
                    >
                      <IconCheck size={12} /> {entryStats.success}
                    </span>
                    <span
                      className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatFailure}`}
                    >
                      <IconX size={12} /> {entryStats.failure}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <Collapsible label={t('providersPage.detail.metadataTitle')}>
          <dl className={styles.dl}>
            {metadata.map(([key, value]) => (
              <div key={key}>
                <dt className={styles.dt}>{t(`providersPage.detail.fields.${key}`)}</dt>
                <dd className={styles.dd}>{value}</dd>
              </div>
            ))}
          </dl>
        </Collapsible>
      </div>
    </div>
  );
}
