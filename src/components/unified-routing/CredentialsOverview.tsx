/**
 * Credentials Overview Component
 * Shows available credentials in a table format
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import type { CredentialInfo } from '@/types';
import styles from './CredentialsOverview.module.scss';

interface CredentialsOverviewProps {
  credentials: CredentialInfo[];
  loading?: boolean;
}

export function CredentialsOverview({ credentials, loading }: CredentialsOverviewProps) {
  const { t } = useTranslation();

  // Group credentials by provider
  const groupedCredentials = useMemo(() => {
    const groups: Record<string, CredentialInfo[]> = {};
    for (const cred of credentials) {
      const key = cred.provider;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(cred);
    }
    return groups;
  }, [credentials]);

  if (loading) {
    return (
      <Card title={t('unified_routing.credentials_overview')} className={styles.card}>
        <div className={styles.loading}>{t('common.loading')}</div>
      </Card>
    );
  }

  if (credentials.length === 0) {
    return (
      <Card title={t('unified_routing.credentials_overview')} className={styles.card}>
        <div className={styles.empty}>{t('unified_routing.no_credentials')}</div>
      </Card>
    );
  }

  return (
    <Card title={t('unified_routing.credentials_overview')} className={styles.card}>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('unified_routing.provider')}</th>
              <th>{t('unified_routing.credential')}</th>
              <th>{t('unified_routing.available_models')}</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(groupedCredentials).map(([provider, creds]) =>
              creds.map((cred, idx) => (
                <tr key={cred.id}>
                  {idx === 0 && (
                    <td rowSpan={creds.length} className={styles.providerCell}>
                      <span className={styles.providerName}>{provider}</span>
                      <span className={styles.providerType}>{cred.type}</span>
                    </td>
                  )}
                  <td className={styles.credentialCell}>
                    <span className={styles.credentialId}>{cred.label || cred.id}</span>
                    {cred.prefix && (
                      <span className={styles.credentialPrefix}>{cred.prefix}</span>
                    )}
                  </td>
                  <td className={styles.modelsCell}>
                    <div className={styles.modelsList}>
                      {cred.models.slice(0, 5).map((model) => (
                        <span
                          key={model.id}
                          className={`${styles.modelTag} ${model.available ? styles.available : styles.unavailable}`}
                          title={model.name}
                        >
                          {model.name.length > 20 ? `${model.name.slice(0, 18)}...` : model.name}
                        </span>
                      ))}
                      {cred.models.length > 5 && (
                        <span className={styles.moreModels}>
                          +{cred.models.length - 5}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
