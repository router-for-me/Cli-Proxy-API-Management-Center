import { forwardRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { SecondaryScreenShell } from '@/components/common/SecondaryScreenShell';
import layoutStyles from './AiProvidersEditLayout.module.scss';

export type ProviderEditorShellProps = {
  title: ReactNode;
  onBack: () => void;
  onSave: () => void | Promise<void>;
  canSave: boolean;
  loading?: boolean;
  saving?: boolean;
  children?: ReactNode;
};

// ProviderEditorShell wraps the SecondaryScreenShell + footer Back/Save
// buttons identical across the four provider edit pages
// (Claude/OpenAI/Codex/Gemini). The body — Card layout, invalid-index
// hint, and provider-specific form fields — stays in each page so the
// shell does not have to model per-provider UX differences.
export const ProviderEditorShell = forwardRef<HTMLDivElement, ProviderEditorShellProps>(
  function ProviderEditorShell(
    { title, onBack, onSave, canSave, loading = false, saving = false, children },
    ref,
  ) {
    const { t } = useTranslation();
    return (
      <SecondaryScreenShell
        ref={ref}
        contentClassName={layoutStyles.content}
        title={title}
        onBack={onBack}
        backLabel={t('common.back')}
        backAriaLabel={t('common.back')}
        hideTopBarBackButton
        hideTopBarRightAction
        floatingAction={
          <div className={layoutStyles.floatingActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={onBack}
              className={layoutStyles.floatingBackButton}
            >
              {t('common.back')}
            </Button>
            <Button
              size="sm"
              onClick={() => void onSave()}
              loading={saving}
              disabled={!canSave}
              className={layoutStyles.floatingSaveButton}
            >
              {t('common.save')}
            </Button>
          </div>
        }
        isLoading={loading}
        loadingLabel={t('common.loading')}
      >
        {children}
      </SecondaryScreenShell>
    );
  },
);
