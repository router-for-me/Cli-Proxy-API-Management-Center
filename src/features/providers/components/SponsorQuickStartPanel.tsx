import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useNotificationStore } from '@/stores';
import {
  IconCheckCircle2,
  IconExternalLink,
  IconLoader2,
  IconPlus,
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

  const mode = resource ? 'edit' : 'create';
  const formMutating = submitting || mutationDisabled || workbench.mutating;
  const submitDisabled = formMutating || (mode === 'edit' && !isDirty);
  const logo = PROVIDER_LOGOS.apikeyFun;
  const actionHref = resource ? APIKEY_FUN_DASHBOARD_URL : APIKEY_FUN_AFFILIATE_URL;
  const actionLabel = resource
    ? t('providersPage.sponsor.dashboardLink')
    : t('providersPage.sponsor.registerLink');

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
    if (mutationDisabled) return;
    setSubmitting(true);
    try {
      if (resource) {
        await workbench.updateProvider(resource, input);
        showNotification(t('providersPage.toast.updated'), 'success');
      } else {
        await workbench.createProvider('apikeyFun', input);
        showNotification(t('providersPage.toast.created'), 'success');
      }
      setIsDirty(false);
      setFormVersion((current) => current + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotification(
        `${t(resource ? 'notification.update_failed' : 'notification.add_failed')}: ${msg}`,
        'error'
      );
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <img src={logo.src} alt="" aria-hidden="true" className={styles.logo} />
          <div className={styles.titleText}>
            <h2 className={styles.title}>{t('providersPage.providerNames.apikeyFun')}</h2>
          </div>
        </div>

        <a
          className={`${styles.topLink} ${resource ? '' : styles.topLinkEmphasis}`.trim()}
          href={actionHref}
          target="_blank"
          rel="noreferrer"
        >
          <IconExternalLink size={14} />
          <span>{actionLabel}</span>
        </a>
      </div>

      <SponsorProviderForm
        key={`${mode}:${resource?.id ?? 'new'}:${formVersion}`}
        resource={resource}
        mode={mode}
        mutating={formMutating}
        formId={formId}
        onSubmit={handleSubmit}
        onDirtyChange={setIsDirty}
      />

      <div className={styles.footer}>
        <button
          type="submit"
          form={formId}
          className={`${formStyles.footerBtn} ${formStyles.footerBtnPrimary}`}
          disabled={submitDisabled}
        >
          {submitting ? (
            <IconLoader2 className={styles.spin} size={14} />
          ) : mode === 'create' ? (
            <IconPlus size={14} />
          ) : (
            <IconCheckCircle2 size={14} />
          )}
          <span>
            {mode === 'create'
              ? t('providersPage.actions.create')
              : t('providersPage.actions.save')}
          </span>
        </button>
      </div>
    </section>
  );
}
