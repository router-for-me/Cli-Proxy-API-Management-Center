import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/Collapsible';
import { Input } from '@/components/ui/Input';
import type { ConfigSectionProps } from '../../types';
import { FieldAnchor, FieldShell, FieldStack, ToggleRow } from '../fields/FieldPrimitives';
import { StringListEditor } from '../blocks/StringListEditor';
import { getValidationMessage } from '../blocks/shared';

/** Kept mounted inside native details so search can reveal every discovery field. */
export function SectionDiscovery({
  values,
  validationErrors,
  disabled,
  onChange,
}: ConfigSectionProps) {
  const { t } = useTranslation();
  const id = useId();
  const serviceTypeError = getValidationMessage(t, validationErrors?.discoveryServiceType);

  return (
    <Collapsible
      label={t('config_management.visual.serverExtras.discoveryTitle')}
      hint={t('config_management.visual.serverExtras.discoveryHint')}
      defaultOpen={false}
    >
      <FieldStack>
        <FieldAnchor fieldId="discoveryEnabled">
          <ToggleRow
            title={t('config_management.visual.serverExtras.discoveryEnabled.label')}
            description={t('config_management.visual.serverExtras.discoveryEnabled.hint')}
            checked={values.discoveryEnabled}
            disabled={disabled}
            onChange={(discoveryEnabled) => onChange({ discoveryEnabled })}
          />
        </FieldAnchor>
        <FieldAnchor fieldId="discoveryServiceName">
          <Input
            type="text"
            label={t('config_management.visual.serverExtras.discoveryServiceName.label')}
            hint={t('config_management.visual.serverExtras.discoveryServiceName.hint')}
            value={values.discoveryServiceName}
            disabled={disabled}
            onChange={(event) => onChange({ discoveryServiceName: event.target.value })}
          />
        </FieldAnchor>
        <FieldAnchor fieldId="discoveryServiceType">
          <Input
            type="text"
            label={t('config_management.visual.serverExtras.discoveryServiceType.label')}
            hint={t('config_management.visual.serverExtras.discoveryServiceType.hint')}
            placeholder="_ai-gateway._tcp"
            error={serviceTypeError}
            value={values.discoveryServiceType}
            disabled={disabled}
            onChange={(event) => onChange({ discoveryServiceType: event.target.value })}
          />
        </FieldAnchor>
        <FieldAnchor fieldId="discoverySubtypes">
          <FieldShell
            label={t('config_management.visual.serverExtras.discoverySubtypes.label')}
            labelId={`${id}-discoverySubtypes-label`}
            hint={t('config_management.visual.serverExtras.discoverySubtypes.hint')}
            hintId={`${id}-discoverySubtypes-hint`}
          >
            <div
              role="group"
              aria-labelledby={`${id}-discoverySubtypes-label`}
              aria-describedby={`${id}-discoverySubtypes-hint`}
            >
              <StringListEditor
                value={values.discoverySubtypes}
                disabled={disabled}
                placeholder="_responses"
                inputAriaLabel={t('config_management.visual.serverExtras.discoverySubtypes.label')}
                onChange={(discoverySubtypes) => onChange({ discoverySubtypes })}
              />
            </div>
          </FieldShell>
        </FieldAnchor>
        <FieldAnchor fieldId="discoveryInterfacesInclude">
          <FieldShell
            label={t('config_management.visual.serverExtras.discoveryInterfacesInclude.label')}
            labelId={`${id}-discoveryInterfacesInclude-label`}
            hint={t('config_management.visual.serverExtras.discoveryInterfacesInclude.hint')}
            hintId={`${id}-discoveryInterfacesInclude-hint`}
          >
            <div
              role="group"
              aria-labelledby={`${id}-discoveryInterfacesInclude-label`}
              aria-describedby={`${id}-discoveryInterfacesInclude-hint`}
            >
              <StringListEditor
                value={values.discoveryInterfacesInclude}
                disabled={disabled}
                placeholder="en*"
                inputAriaLabel={t(
                  'config_management.visual.serverExtras.discoveryInterfacesInclude.label'
                )}
                onChange={(discoveryInterfacesInclude) => onChange({ discoveryInterfacesInclude })}
              />
            </div>
          </FieldShell>
        </FieldAnchor>
        <FieldAnchor fieldId="discoveryInterfacesExclude">
          <FieldShell
            label={t('config_management.visual.serverExtras.discoveryInterfacesExclude.label')}
            labelId={`${id}-discoveryInterfacesExclude-label`}
            hint={t('config_management.visual.serverExtras.discoveryInterfacesExclude.hint')}
            hintId={`${id}-discoveryInterfacesExclude-hint`}
          >
            <div
              role="group"
              aria-labelledby={`${id}-discoveryInterfacesExclude-label`}
              aria-describedby={`${id}-discoveryInterfacesExclude-hint`}
            >
              <StringListEditor
                value={values.discoveryInterfacesExclude}
                disabled={disabled}
                placeholder="en*"
                inputAriaLabel={t(
                  'config_management.visual.serverExtras.discoveryInterfacesExclude.label'
                )}
                onChange={(discoveryInterfacesExclude) => onChange({ discoveryInterfacesExclude })}
              />
            </div>
          </FieldShell>
        </FieldAnchor>
        <FieldAnchor fieldId="discoveryAuthRequired">
          <ToggleRow
            title={t('config_management.visual.serverExtras.discoveryAuthRequired.label')}
            description={t('config_management.visual.serverExtras.discoveryAuthRequired.hint')}
            checked={values.discoveryAuthRequired}
            disabled={disabled}
            onChange={(discoveryAuthRequired) => onChange({ discoveryAuthRequired })}
          />
        </FieldAnchor>
        <FieldAnchor fieldId="discoveryAdvertiseManagement">
          <ToggleRow
            title={t('config_management.visual.serverExtras.discoveryAdvertiseManagement.label')}
            description={t(
              'config_management.visual.serverExtras.discoveryAdvertiseManagement.hint'
            )}
            checked={values.discoveryAdvertiseManagement}
            disabled={disabled}
            onChange={(discoveryAdvertiseManagement) => onChange({ discoveryAdvertiseManagement })}
          />
        </FieldAnchor>
      </FieldStack>
    </Collapsible>
  );
}
