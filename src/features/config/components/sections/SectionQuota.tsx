import { useTranslation } from 'react-i18next';
import { CONFIG_TAB_ICONS, SECTION_INDEX_LABELS } from '../../constants';
import type { ConfigSectionProps } from '../../types';
import { SectionCard } from '../SectionCard';
import { SettingList, ToggleSetting } from '../fields/FieldPrimitives';
import { QuotaSwitchPreviewModelToggle, QuotaSwitchProjectToggle } from '../fields/sharedFields';

const Icon = CONFIG_TAB_ICONS.quota;

/** 04 配额回退：配额耗尽时的回退策略（两个开关默认 true）。 */
export function SectionQuota({ values, disabled, animateIn, onChange }: ConfigSectionProps) {
  const { t } = useTranslation();
  const fieldProps = { values, disabled, onChange };

  return (
    <SectionCard
      indexLabel={SECTION_INDEX_LABELS.quota}
      icon={<Icon size={16} />}
      title={t('config_management.visual.sections.quota.title')}
      description={t('config_management.visual.sections.quota.description')}
      animateIn={animateIn}
    >
      <SettingList>
        <QuotaSwitchProjectToggle {...fieldProps} />
        <QuotaSwitchPreviewModelToggle {...fieldProps} />
        <ToggleSetting
          fieldId="quotaAntigravityCredits"
          label={t('config_management.visual.sections.quota.antigravity_credits')}
          checked={values.quotaAntigravityCredits}
          disabled={disabled}
          onChange={(quotaAntigravityCredits) => onChange({ quotaAntigravityCredits })}
        />
      </SettingList>
    </SectionCard>
  );
}
