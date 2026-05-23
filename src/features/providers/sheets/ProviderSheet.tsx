import { useCallback, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui/Sheet';
import { IconLoader2, IconPencil } from '@/components/ui/icons';
import { PROVIDER_DESCRIPTORS } from '../descriptors';
import type {
  ProviderBrand,
  ProviderEntryFormInput,
  ProviderResource,
} from '../types';
import type { UseProviderWorkbenchResult } from '../useProviderWorkbench';
import { AmpcodeForm } from './forms/AmpcodeForm';
import { BaseProviderForm } from './forms/BaseProviderForm';
import { ResourceDetailView } from './ResourceDetailView';
import styles from './forms/sharedForm.module.scss';

type SheetMode = 'detail' | 'create' | 'edit';

export interface ProviderSheetState {
  open: boolean;
  brand: ProviderBrand;
  mode: SheetMode;
  resource: ProviderResource | null;
}

interface ProviderSheetProps {
  state: ProviderSheetState;
  onClose: () => void;
  onSwitchToEdit: () => void;
  workbench: UseProviderWorkbenchResult;
  onCreated: () => void;
  onUpdated: () => void;
}

export function ProviderSheet({
  state,
  onClose,
  onSwitchToEdit,
  workbench,
  onCreated,
  onUpdated,
}: ProviderSheetProps) {
  const { t } = useTranslation();
  const formId = useId();
  const [submitting, setSubmitting] = useState(false);

  const descriptor = PROVIDER_DESCRIPTORS[state.brand];
  const isAmpcode = state.brand === 'ampcode';

  const titleText =
    state.mode === 'create'
      ? `${t('providersPage.form.createEyebrow')} · ${t(
          `providersPage.providerNames.${state.brand}`
        )}`
      : state.mode === 'edit'
        ? `${t('providersPage.form.editEyebrow')} · ${t(
            `providersPage.providerNames.${state.brand}`
          )}`
        : `${t('providersPage.detail.title')} · ${t(
            `providersPage.providerNames.${state.brand}`
          )}`;

  const handleCreate = useCallback(
    async (input: ProviderEntryFormInput) => {
      setSubmitting(true);
      try {
        await workbench.createProvider(state.brand, input);
        onCreated();
      } finally {
        setSubmitting(false);
      }
    },
    [onCreated, state.brand, workbench]
  );

  const handleUpdate = useCallback(
    async (input: ProviderEntryFormInput) => {
      if (!state.resource) return;
      setSubmitting(true);
      try {
        await workbench.updateProvider(state.resource, input);
        onUpdated();
      } finally {
        setSubmitting(false);
      }
    },
    [onUpdated, state.resource, workbench]
  );

  const handleAmpcodeSubmit = useCallback(
    async (config: Parameters<UseProviderWorkbenchResult['saveAmpcode']>[0]) => {
      setSubmitting(true);
      try {
        await workbench.saveAmpcode(config);
        onUpdated();
      } finally {
        setSubmitting(false);
      }
    },
    [onUpdated, workbench]
  );

  const renderBody = () => {
    if (state.mode === 'detail') {
      if (!state.resource) {
        return null;
      }
      return <ResourceDetailView resource={state.resource} />;
    }
    const formKey = `${state.brand}:${state.resource?.id ?? 'new'}:${state.mode}`;
    if (isAmpcode) {
      return (
        <AmpcodeForm
          key={formKey}
          resource={state.resource}
          mutating={submitting || workbench.mutating}
          formId={formId}
          onSubmit={handleAmpcodeSubmit}
        />
      );
    }
    return (
      <BaseProviderForm
        key={formKey}
        brand={state.brand as Exclude<ProviderBrand, 'ampcode'>}
        resource={state.resource}
        mode={state.mode}
        mutating={submitting || workbench.mutating}
        formId={formId}
        onSubmit={state.mode === 'create' ? handleCreate : handleUpdate}
      />
    );
  };

  const footer =
    state.mode === 'detail' ? (
      state.resource && !state.resource.flags.isPlaceholder ? (
        <>
          <button
            type="button"
            className={`${styles.footerBtn} ${styles.footerBtnGhost}`}
            onClick={onClose}
          >
            {t('providersPage.actions.cancel')}
          </button>
          <button
            type="button"
            className={`${styles.footerBtn} ${styles.footerBtnPrimary}`}
            onClick={onSwitchToEdit}
          >
            <IconPencil size={14} />
            {t('providersPage.actions.edit')}
          </button>
        </>
      ) : (
        <button
          type="button"
          className={`${styles.footerBtn} ${styles.footerBtnPrimary}`}
          onClick={onClose}
        >
          {t('providersPage.actions.cancel')}
        </button>
      )
    ) : (
      <>
        <button
          type="button"
          className={`${styles.footerBtn} ${styles.footerBtnGhost}`}
          onClick={onClose}
          disabled={submitting}
        >
          {t('providersPage.actions.cancel')}
        </button>
        <button
          type="submit"
          form={formId}
          className={`${styles.footerBtn} ${styles.footerBtnPrimary}`}
          disabled={submitting}
        >
          {submitting ? (
            <IconLoader2 size={14} />
          ) : null}
          {state.mode === 'create'
            ? t('providersPage.actions.create')
            : t('providersPage.actions.save')}
        </button>
      </>
    );

  return (
    <Sheet
      open={state.open}
      onClose={onClose}
      size={descriptor.sheetSize}
      eyebrow={
        state.mode === 'detail'
          ? t('providersPage.detail.title')
          : state.mode === 'create'
            ? t('providersPage.form.createEyebrow')
            : t('providersPage.form.editEyebrow')
      }
      title={titleText}
      description={t('providersPage.table.description', {
        route: `/ai-providers/${state.brand === 'openaiCompatibility' ? 'openai' : state.brand}`,
      })}
      footer={footer}
      closeDisabled={submitting}
    >
      {renderBody()}
    </Sheet>
  );
}
