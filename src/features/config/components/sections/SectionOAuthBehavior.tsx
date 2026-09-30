import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/Collapsible';
import { Input } from '@/components/ui/Input';
import type { ConfigSectionProps } from '../../types';
import { CodexLiveICEServersEditor } from '../blocks/CodexLiveICEServersEditor';
import { getValidationMessage } from '../blocks/shared';
import {
  FieldAnchor,
  FieldGrid,
  FieldGroup,
  FieldStack,
  ToggleRow,
} from '../fields/FieldPrimitives';

/** OAuth/file-backed provider behavior, independent of API-key provider configuration. */
export function SectionOAuthBehavior({
  values,
  validationErrors,
  disabled,
  onChange,
}: ConfigSectionProps) {
  const { t } = useTranslation();
  return (
    <Collapsible
      label={t('config_management.visual.additions.oauthTitle')}
      hint={t('config_management.visual.additions.oauthHint')}
    >
      <FieldStack>
        <FieldGroup title={t('config_management.visual.additions.claudeTitle')}>
          <FieldGrid>
            <FieldAnchor fieldId="claudeModelLevelCooling">
              <ToggleRow
                title={t('config_management.visual.additions.claudeModelLevelCooling.label')}
                description={t('config_management.visual.additions.claudeModelLevelCooling.hint')}
                checked={values.claudeModelLevelCooling}
                disabled={disabled}
                onChange={(claudeModelLevelCooling) => onChange({ claudeModelLevelCooling })}
              />
            </FieldAnchor>
            <FieldAnchor fieldId="claudeDisableCloakMode">
              <ToggleRow
                title={t('config_management.visual.additions.claudeDisableCloakMode.label')}
                description={t('config_management.visual.additions.claudeDisableCloakMode.hint')}
                checked={values.claudeDisableCloakMode}
                disabled={disabled}
                onChange={(claudeDisableCloakMode) => onChange({ claudeDisableCloakMode })}
              />
            </FieldAnchor>
            <FieldAnchor fieldId="claudeCodeDisableCloakingModelList">
              <ToggleRow
                title={t(
                  'config_management.visual.additions.claudeCodeDisableCloakingModelList.label'
                )}
                description={t(
                  'config_management.visual.additions.claudeCodeDisableCloakingModelList.hint'
                )}
                checked={values.claudeCodeDisableCloakingModelList}
                disabled={disabled}
                onChange={(claudeCodeDisableCloakingModelList) =>
                  onChange({ claudeCodeDisableCloakingModelList })
                }
              />
            </FieldAnchor>
          </FieldGrid>
        </FieldGroup>
        <FieldGroup title={t('config_management.visual.additions.codexTitle')}>
          <FieldGrid>
            <FieldAnchor fieldId="codexDisableCloaking">
              <ToggleRow
                title={t('config_management.visual.additions.codexDisableCloaking.label')}
                description={t('config_management.visual.additions.codexDisableCloaking.hint')}
                checked={values.codexDisableCloaking}
                disabled={disabled}
                onChange={(codexDisableCloaking) => onChange({ codexDisableCloaking })}
              />
            </FieldAnchor>
            <FieldAnchor fieldId="codexModelLevelCooling">
              <ToggleRow
                title={t('config_management.visual.additions.codexModelLevelCooling.label')}
                description={t('config_management.visual.additions.codexModelLevelCooling.hint')}
                checked={values.codexModelLevelCooling}
                disabled={disabled}
                onChange={(codexModelLevelCooling) => onChange({ codexModelLevelCooling })}
              />
            </FieldAnchor>
            <FieldAnchor fieldId="codexStreamBootstrapBuffering">
              <ToggleRow
                title={t('config_management.visual.additions.codexStreamBootstrapBuffering.label')}
                description={t(
                  'config_management.visual.additions.codexStreamBootstrapBuffering.hint'
                )}
                checked={values.codexStreamBootstrapBuffering}
                disabled={disabled}
                onChange={(codexStreamBootstrapBuffering) =>
                  onChange({ codexStreamBootstrapBuffering })
                }
              />
            </FieldAnchor>
            <FieldAnchor fieldId="codexStreamBootstrapTimeout">
              <Input
                label={t('config_management.visual.additions.codexStreamBootstrapTimeout.label')}
                hint={t('config_management.visual.additions.codexStreamBootstrapTimeout.hint')}
                type="text"
                value={values.codexStreamBootstrapTimeout}
                onChange={(e) => onChange({ codexStreamBootstrapTimeout: e.target.value })}
                disabled={disabled}
                error={getValidationMessage(t, validationErrors?.codexStreamBootstrapTimeout)}
              />
            </FieldAnchor>
            <FieldAnchor fieldId="codexOptimizeMultiAgentV2">
              <ToggleRow
                title={t('config_management.visual.additions.codexOptimizeMultiAgentV2.label')}
                description={t('config_management.visual.additions.codexOptimizeMultiAgentV2.hint')}
                checked={values.codexOptimizeMultiAgentV2}
                disabled={disabled}
                onChange={(codexOptimizeMultiAgentV2) => onChange({ codexOptimizeMultiAgentV2 })}
              />
            </FieldAnchor>
            <FieldAnchor fieldId="codexOrphanDelegationCompatibility">
              <ToggleRow
                title={t(
                  'config_management.visual.additions.codexOrphanDelegationCompatibility.label'
                )}
                description={t(
                  'config_management.visual.additions.codexOrphanDelegationCompatibility.hint'
                )}
                checked={values.codexOrphanDelegationCompatibility}
                disabled={disabled}
                onChange={(codexOrphanDelegationCompatibility) =>
                  onChange({ codexOrphanDelegationCompatibility })
                }
              />
            </FieldAnchor>
            <FieldAnchor fieldId="codexResponseSteering">
              <ToggleRow
                title={t('config_management.visual.additions.codexResponseSteering.label')}
                description={t('config_management.visual.additions.codexResponseSteering.hint')}
                checked={values.codexResponseSteering}
                disabled={disabled}
                onChange={(codexResponseSteering) => onChange({ codexResponseSteering })}
              />
            </FieldAnchor>
          </FieldGrid>
        </FieldGroup>
        <FieldGroup title={t('config_management.visual.additions.antigravityTitle')}>
          <FieldGrid>
            <FieldAnchor fieldId="antigravityConnectionPoolEnabled">
              <ToggleRow
                title={t(
                  'config_management.visual.additions.antigravityConnectionPoolEnabled.label'
                )}
                description={t(
                  'config_management.visual.additions.antigravityConnectionPoolEnabled.hint'
                )}
                checked={values.antigravityConnectionPoolEnabled}
                disabled={disabled}
                onChange={(antigravityConnectionPoolEnabled) =>
                  onChange({ antigravityConnectionPoolEnabled })
                }
              />
            </FieldAnchor>
            <FieldAnchor fieldId="antigravityConnectionPoolIdleTimeout">
              <Input
                label={t(
                  'config_management.visual.additions.antigravityConnectionPoolIdleTimeout.label'
                )}
                hint={t(
                  'config_management.visual.additions.antigravityConnectionPoolIdleTimeout.hint'
                )}
                type="text"
                value={values.antigravityConnectionPoolIdleTimeout}
                onChange={(e) => onChange({ antigravityConnectionPoolIdleTimeout: e.target.value })}
                disabled={disabled}
                error={getValidationMessage(
                  t,
                  validationErrors?.antigravityConnectionPoolIdleTimeout
                )}
              />
            </FieldAnchor>
            <FieldAnchor fieldId="antigravityConnectionPoolMaxIdleConnsPerHost">
              <Input
                label={t(
                  'config_management.visual.additions.antigravityConnectionPoolMaxIdleConnsPerHost.label'
                )}
                hint={t(
                  'config_management.visual.additions.antigravityConnectionPoolMaxIdleConnsPerHost.hint'
                )}
                type="number"
                value={values.antigravityConnectionPoolMaxIdleConnsPerHost}
                onChange={(e) =>
                  onChange({ antigravityConnectionPoolMaxIdleConnsPerHost: e.target.value })
                }
                disabled={disabled}
                error={getValidationMessage(
                  t,
                  validationErrors?.antigravityConnectionPoolMaxIdleConnsPerHost
                )}
              />
            </FieldAnchor>
          </FieldGrid>
        </FieldGroup>
        <FieldGroup title={t('config_management.visual.additions.xaiTitle')}>
          <FieldGrid>
            <FieldAnchor fieldId="xaiInjectXSearch">
              <ToggleRow
                title={t('config_management.visual.additions.xaiInjectXSearch.label')}
                description={t('config_management.visual.additions.xaiInjectXSearch.hint')}
                checked={values.xaiInjectXSearch}
                disabled={disabled}
                onChange={(xaiInjectXSearch) => onChange({ xaiInjectXSearch })}
              />
            </FieldAnchor>
          </FieldGrid>
        </FieldGroup>
        <FieldGroup
          title={t('config_management.visual.additions.liveRelayTitle')}
          description={t('config_management.visual.additions.liveRelayHint')}
        >
          <FieldGrid>
            <FieldAnchor fieldId="codexLiveMediaRelayEnabled">
              <ToggleRow
                title={t('config_management.visual.additions.codexLiveMediaRelayEnabled.label')}
                description={t(
                  'config_management.visual.additions.codexLiveMediaRelayEnabled.hint'
                )}
                checked={values.codexLiveMediaRelayEnabled}
                disabled={disabled}
                onChange={(codexLiveMediaRelayEnabled) => onChange({ codexLiveMediaRelayEnabled })}
              />
            </FieldAnchor>
            <FieldAnchor fieldId="codexLiveMediaRelayMaxSessions">
              <Input
                label={t('config_management.visual.additions.codexLiveMediaRelayMaxSessions.label')}
                hint={t('config_management.visual.additions.codexLiveMediaRelayMaxSessions.hint')}
                type="number"
                value={values.codexLiveMediaRelayMaxSessions}
                onChange={(e) => onChange({ codexLiveMediaRelayMaxSessions: e.target.value })}
                disabled={disabled}
                error={getValidationMessage(t, validationErrors?.codexLiveMediaRelayMaxSessions)}
              />
            </FieldAnchor>
            <FieldAnchor fieldId="codexLiveMediaRelayDisablePrivateRemoteIPs">
              <ToggleRow
                title={t(
                  'config_management.visual.additions.codexLiveMediaRelayDisablePrivateRemoteIPs.label'
                )}
                description={t(
                  'config_management.visual.additions.codexLiveMediaRelayDisablePrivateRemoteIPs.hint'
                )}
                checked={values.codexLiveMediaRelayDisablePrivateRemoteIPs}
                disabled={disabled}
                onChange={(codexLiveMediaRelayDisablePrivateRemoteIPs) =>
                  onChange({ codexLiveMediaRelayDisablePrivateRemoteIPs })
                }
              />
            </FieldAnchor>
            <FieldAnchor fieldId="codexLiveMediaRelayPublicIP">
              <Input
                label={t('config_management.visual.additions.codexLiveMediaRelayPublicIP.label')}
                hint={t('config_management.visual.additions.codexLiveMediaRelayPublicIP.hint')}
                type="text"
                value={values.codexLiveMediaRelayPublicIP}
                onChange={(e) => onChange({ codexLiveMediaRelayPublicIP: e.target.value })}
                disabled={disabled}
                error={getValidationMessage(t, validationErrors?.codexLiveMediaRelayPublicIP)}
              />
            </FieldAnchor>
            <FieldAnchor fieldId="codexLiveMediaRelayUDPPortMin">
              <Input
                label={t('config_management.visual.additions.codexLiveMediaRelayUDPPortMin.label')}
                hint={t('config_management.visual.additions.codexLiveMediaRelayUDPPortMin.hint')}
                type="number"
                value={values.codexLiveMediaRelayUDPPortMin}
                onChange={(e) => onChange({ codexLiveMediaRelayUDPPortMin: e.target.value })}
                disabled={disabled}
                error={getValidationMessage(t, validationErrors?.codexLiveMediaRelayUDPPortMin)}
              />
            </FieldAnchor>
            <FieldAnchor fieldId="codexLiveMediaRelayUDPPortMax">
              <Input
                label={t('config_management.visual.additions.codexLiveMediaRelayUDPPortMax.label')}
                hint={t('config_management.visual.additions.codexLiveMediaRelayUDPPortMax.hint')}
                type="number"
                value={values.codexLiveMediaRelayUDPPortMax}
                onChange={(e) => onChange({ codexLiveMediaRelayUDPPortMax: e.target.value })}
                disabled={disabled}
                error={getValidationMessage(t, validationErrors?.codexLiveMediaRelayUDPPortMax)}
              />
            </FieldAnchor>
            <FieldAnchor fieldId="codexLiveMediaRelayICEServers" wide>
              <CodexLiveICEServersEditor
                value={values.codexLiveMediaRelayICEServers}
                disabled={disabled}
                error={getValidationMessage(t, validationErrors?.codexLiveMediaRelayICEServers)}
                onChange={(codexLiveMediaRelayICEServers) =>
                  onChange({ codexLiveMediaRelayICEServers })
                }
              />
            </FieldAnchor>
          </FieldGrid>
        </FieldGroup>
      </FieldStack>
    </Collapsible>
  );
}
