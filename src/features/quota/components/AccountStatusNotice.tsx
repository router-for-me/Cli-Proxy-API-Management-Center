import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthFileItem } from '@/types';
import { getAuthFileStatusMessage, hasAuthFileStatusWarning } from '@/features/authFiles/constants';
import {
  describeAccountStatus,
  formatRawStatusMessage,
  type AccountStatus,
} from '../accountStatus';
import styles from './AccountStatusNotice.module.scss';

export type AccountStatusNoticeProps = {
  file: AuthFileItem;
  status: AccountStatus;
  now: number;
  /** Technical detail shown inside the disclosure, after the raw upstream message. */
  details?: ReactNode;
};

export function AccountStatusNotice({ file, status, now, details }: AccountStatusNoticeProps) {
  const { t, i18n } = useTranslation();
  if (status.kind === 'available' || status.kind === 'disabled') return null;

  const { tone, headline, when } = describeAccountStatus(status, t, now, i18n.resolvedLanguage);
  const rawMessage = hasAuthFileStatusWarning(file) ? getAuthFileStatusMessage(file) : '';

  return (
    <div className={styles.notice} data-tone={tone}>
      <p className={styles.line} role="status">
        <span className={styles.dot} aria-hidden="true" />
        <span>
          <strong className={styles.headline}>{headline}</strong>
          {when && <span className={styles.when}> · {when}</span>}
        </span>
      </p>
      {(rawMessage || details) && (
        <details className={styles.details}>
          <summary className={styles.summary}>{t('account_status.details')}</summary>
          {rawMessage && (
            <>
              <span className={styles.rawLabel}>{t('account_status.raw_message')}</span>
              <pre className={styles.raw}>{formatRawStatusMessage(rawMessage)}</pre>
            </>
          )}
          {details}
        </details>
      )}
    </div>
  );
}
