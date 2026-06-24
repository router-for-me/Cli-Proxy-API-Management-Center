import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useNotificationStore } from '@/stores';
import {
  IconCheckCircle2,
  IconExternalLink,
  IconLoader2,
} from '@/components/ui/icons';
import { PROVIDER_LOGOS } from '../brandLogos';
import {
  APIKEY_FUN_AFFILIATE_URL,
  APIKEY_FUN_DASHBOARD_URL,
} from '../sponsor';
import type { ProviderEntryFormInput, ProviderResource } from '../types';
import type { UseProviderWorkbenchResult } from '../useProviderWorkbench';
import { SponsorProviderForm } from '../sheets/forms/SponsorProviderForm';
import formStyles from '../sheets/forms/sharedForm.module.scss';
import styles from './SponsorQuickStartPanel.module.scss';

interface SponsorQuickStartPanelProps {
  resource: ProviderResource | null;
  workbench: UseProviderWorkbenchResult;
  mutationDisabled?: boolean;
}

export function SponsorQuickStartPanel({
  resource,
  workbench,
  mutationDisabled = false,
}: SponsorQuickStartPanelProps) {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const formId = useId();
  const [submitting, setSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [formVersion, setFormVersion] = useState(0);

  const formMutating = submitting || mutationDisabled || workbench.mutating;
  const submitDisabled = formMutating || !isDirty;
  const logo = PROVIDER_LOGOS.apikeyFun;

  useUnsavedChangesGuard({
    shouldBlock: isDirty && !submitting,
    dialog: {
      title: t('providersPage.unsavedChanges.title'),
      message: t('providersPage.unsavedChanges.message'),
      confirmText: t('providersPage.unsavedChanges.discard'),
      cancelText: t('providersPage.unsavedChanges.keepEditing'),
      variant: 'danger',
    },
  });

  const handleSubmit = async (input: ProviderEntryFormInput) => {
    if (!resource || mutationDisabled) return;
    setSubmitting(true);
    try {
      await workbench.updateProvider(resource, input);
      showNotification(t('providersPage.toast.updated'), 'success');
      setIsDirty(false);
      setFormVersion((current) => current + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotification(
        `${t('notification.update_failed')}: ${msg}`,
        'error'
      );
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  if (!resource) {
    return (
      <section className={styles.panel}>
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <img src={logo.src} alt="" aria-hidden="true" className={styles.logo} />
            <div className={styles.titleText}>
              <h2 className={styles.title}>{t('providersPage.providerNames.apikeyFun')}</h2>
            </div>
          </div>
        </div>

        <div className={styles.empty}>
          <div>{t('providersPage.sponsor.emptyRegisterHint')}</div>
          <div className={styles.emptyAction}>
            <a
              className={styles.emptyActionButton}
              href={APIKEY_FUN_AFFILIATE_URL}
              target="_blank"
              rel="noreferrer"
            >
              <IconExternalLink size={16} />
              <span>{t('nav.quick_start')}</span>
            </a>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <img src={logo.src} alt="" aria-hidden="true" className={styles.logo} />
          <div className={styles.titleText}>
            <h2 className={styles.title}>{t('providersPage.providerNames.apikeyFun')}</h2>
          </div>
          <a
            className={styles.topLink}
            href={APIKEY_FUN_DASHBOARD_URL}
            target="_blank"
            rel="noreferrer"
          >
            <IconExternalLink size={14} />
            <span>{t('providersPage.sponsor.dashboardLink')}</span>
          </a>
        </div>
      </div>

      <SponsorProviderForm
        key={`edit:${resource.id}:${formVersion}`}
        resource={resource}
        mode="edit"
        mutating={formMutating}
        formId={formId}
        variant="quickStart"
        onSubmit={handleSubmit}
        onDirtyChange={setIsDirty}
      />

      <div className={styles.footer}>
        <button
          type="submit"
          form={formId}
          className={`${formStyles.footerBtn} ${formStyles.footerBtnPrimary} ${
            styles.primaryAction
          }`}
          disabled={submitDisabled}
        >
          {submitting ? (
            <IconLoader2 className={styles.spin} size={14} />
          ) : (
            <IconCheckCircle2 size={14} />
          )}
          <span>{t('providersPage.actions.save')}</span>
        </button>
      </div>
    </section>
  );
}
