import { useCallback, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { VisualConfigValues } from '@/types/visualConfig';
import { CONFIG_TAB_ICONS, SECTION_INDEX_LABELS } from '../../constants';
import type { ConfigSectionProps } from '../../types';
import { SectionCard } from '../SectionCard';
import {
  FieldAnchor,
  FieldGrid,
  FieldShell,
  FieldStack,
  ToggleRow,
} from '../fields/FieldPrimitives';
import { ProxyUrlField, SponsorHintSpacer } from '../fields/sharedFields';
import { apiClient } from '@/services/api';
import { getValidationMessage } from '../blocks/shared';

const Icon = CONFIG_TAB_ICONS.network;

/** 02 网络配置：代理、重试、路由策略、图像生成开关与网络行为开关。 */
export function SectionNetwork({
  values,
  validationErrors,
  disabled,
  animateIn,
  onChange,
}: ConfigSectionProps) {
  const { t } = useTranslation();
  const routingStrategyLabelId = useId();
  const routingStrategyHintId = `${routingStrategyLabelId}-hint`;
  const disableImageGenerationLabelId = useId();
  const disableImageGenerationHintId = `${disableImageGenerationLabelId}-hint`;
  const proxyModeLabelId = useId();
  const isTorMode = values.proxyMode === 'tor';

  const [testing, setTesting] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [ipResult, setIpResult] = useState<{ success?: boolean; ip?: string; country?: string; error?: string } | null>(null);
  const [rotateResult, setRotateResult] = useState<{ success?: boolean; message?: string; old_ip?: string; new_ip?: string; error?: string } | null>(null);

  const handleTestIp = useCallback(async () => {
    setTesting(true);
    setIpResult(null);
    try {
      const data = await apiClient.post<{ success?: boolean; ip?: string; country?: string; error?: string }>('/test-proxy');
      setIpResult(data);
    } catch (err: unknown) {
      setIpResult({ success: false, error: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setTesting(false);
    }
  }, []);

  const handleRotateIp = useCallback(async () => {
    setRotating(true);
    setRotateResult(null);
    try {
      const data = await apiClient.post<{ success?: boolean; message?: string; old_ip?: string; new_ip?: string; error?: string }>('/tor-rotate');
      setRotateResult(data);
    } catch (err: unknown) {
      setRotateResult({ success: false, error: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setRotating(false);
    }
  }, []);

  const requestRetryError = getValidationMessage(t, validationErrors?.requestRetry);
  const maxRetryCredentialsError = getValidationMessage(t, validationErrors?.maxRetryCredentials);
  const maxRetryIntervalError = getValidationMessage(t, validationErrors?.maxRetryInterval);
  const authAutoRefreshWorkersError = getValidationMessage(
    t,
    validationErrors?.authAutoRefreshWorkers
  );

  const disableImageGenerationOptions = [
    {
      value: 'false',
      label: t('config_management.visual.sections.network.disable_image_generation_false'),
    },
    {
      value: 'true',
      label: t('config_management.visual.sections.network.disable_image_generation_true'),
    },
    {
      value: 'chat',
      label: t('config_management.visual.sections.network.disable_image_generation_chat'),
    },
    {
      value: 'passthrough',
      label: t('config_management.visual.sections.network.disable_image_generation_passthrough'),
    },
  ];

  return (
    <SectionCard
      indexLabel={SECTION_INDEX_LABELS.network}
      icon={<Icon size={16} />}
      title={t('config_management.visual.sections.network.title')}
      description={t('config_management.visual.sections.network.description')}
      animateIn={animateIn}
    >
      <FieldStack>
        <FieldGrid>
          <FieldAnchor fieldId="proxyMode">
            <FieldShell
              label={t('config_management.visual.sections.network.proxy_mode')}
              labelId={proxyModeLabelId}
              hint={t('config_management.visual.sections.network.proxy_mode_hint')}
            >
              <Select
                value={values.proxyMode}
                options={[
                  { value: 'proxy', label: t('config_management.visual.sections.network.proxy_mode_proxy') },
                  { value: 'tor', label: t('config_management.visual.sections.network.proxy_mode_tor') },
                ]}
                id={`${proxyModeLabelId}-select`}
                disabled={disabled}
                ariaLabelledBy={proxyModeLabelId}
                onChange={(nextValue) => {
                  const proxyMode = nextValue as string;
                  const patch: Partial<VisualConfigValues> = { proxyMode };
                  if (proxyMode === 'tor') {
                    if (!values.torProxyAddr) patch.torProxyAddr = '127.0.0.1:9050';
                    if (!values.torControlAddr) patch.torControlAddr = '127.0.0.1:9051';
                  }
                  onChange(patch);
                }}
              />
            </FieldShell>
          </FieldAnchor>
          {isTorMode ? (
            <>
              <FieldAnchor fieldId="torProxyAddr">
                <Input
                  label={t('config_management.visual.sections.network.tor_proxy_addr')}
                  placeholder="127.0.0.1:9050"
                  value={values.torProxyAddr}
                  onChange={(e) => onChange({ torProxyAddr: e.target.value })}
                  disabled={disabled}
                />
              </FieldAnchor>
              <FieldAnchor fieldId="torControlAddr">
                <Input
                  label={t('config_management.visual.sections.network.tor_control_addr')}
                  placeholder="127.0.0.1:9051"
                  value={values.torControlAddr}
                  onChange={(e) => onChange({ torControlAddr: e.target.value })}
                  disabled={disabled}
                />
              </FieldAnchor>
              <FieldAnchor fieldId="torControlPassword">
                <Input
                  label={t('config_management.visual.sections.network.tor_control_password')}
                  placeholder={t('config_management.visual.sections.network.tor_control_password_placeholder')}
                  type="password"
                  value={values.torControlPassword}
                  onChange={(e) => onChange({ torControlPassword: e.target.value })}
                  disabled={disabled}
                  hint={t('config_management.visual.sections.network.tor_control_password_hint')}
                />
              </FieldAnchor>
              <FieldAnchor fieldId="torRetryAttempts">
                <Input
                  label={t('config_management.visual.sections.network.tor_retry_attempts')}
                  type="number"
                  placeholder="3"
                  value={values.torRetryAttempts}
                  onChange={(e) => onChange({ torRetryAttempts: e.target.value })}
                  disabled={disabled}
                  hint={t('config_management.visual.sections.network.tor_retry_attempts_hint')}
                />
              </FieldAnchor>
              <FieldAnchor fieldId="torRetryOnCodesText">
                <Input
                  label={t('config_management.visual.sections.network.tor_retry_on_codes')}
                  placeholder="429, 403, 500, 502, 503"
                  value={values.torRetryOnCodesText}
                  onChange={(e) => onChange({ torRetryOnCodesText: e.target.value })}
                  disabled={disabled}
                  hint={t('config_management.visual.sections.network.tor_retry_on_codes_hint')}
                />
              </FieldAnchor>
              {/* Tor IP Actions */}
              <div style={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={handleTestIp}
                  disabled={disabled || testing}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color, #333)',
                    background: 'var(--surface-secondary, #1a1a2e)',
                    color: 'var(--text-primary, #e0e0e0)',
                    cursor: testing ? 'wait' : 'pointer',
                    fontSize: '12px',
                    fontWeight: 500,
                  }}
                >
                  {testing ? 'Checking...' : 'Check Current IP'}
                </button>
                {ipResult && (
                  <span style={{ fontSize: '12px', color: ipResult.success ? '#4caf50' : '#f44336' }}>
                    {ipResult.success ? `IP: ${ipResult.ip}${ipResult.country ? ` (${ipResult.country})` : ''}` : `Error: ${ipResult.error}`}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleRotateIp}
                  disabled={disabled || rotating}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color, #333)',
                    background: 'var(--surface-secondary, #1a1a2e)',
                    color: 'var(--text-primary, #e0e0e0)',
                    cursor: rotating ? 'wait' : 'pointer',
                    fontSize: '12px',
                    fontWeight: 500,
                  }}
                >
                  {rotating ? 'Rotating...' : 'Rotate IP'}
                </button>
                {rotateResult && (
                  <span style={{ fontSize: '12px', color: rotateResult.success ? '#4caf50' : '#f44336' }}>
                    {rotateResult.success
                      ? `${rotateResult.message}${rotateResult.old_ip && rotateResult.new_ip ? ` (${rotateResult.old_ip} → ${rotateResult.new_ip})` : ''}`
                      : `Error: ${rotateResult.error}`}
                  </span>
                )}
              </div>
            </>
          ) : (
            <ProxyUrlField values={values} disabled={disabled} onChange={onChange} />
          )}
          <FieldAnchor fieldId="requestRetry">
            <Input
              label={t('config_management.visual.sections.network.request_retry')}
              topExtra={<SponsorHintSpacer />}
              type="number"
              placeholder="3"
              value={values.requestRetry}
              onChange={(e) => onChange({ requestRetry: e.target.value })}
              disabled={disabled}
              error={requestRetryError}
            />
          </FieldAnchor>
          <FieldAnchor fieldId="maxRetryCredentials">
            <Input
              label={t('config_management.visual.sections.network.max_retry_credentials')}
              topExtra={<SponsorHintSpacer />}
              type="number"
              placeholder="0"
              value={values.maxRetryCredentials}
              onChange={(e) => onChange({ maxRetryCredentials: e.target.value })}
              disabled={disabled}
              hint={t('config_management.visual.sections.network.max_retry_credentials_hint')}
              error={maxRetryCredentialsError}
            />
          </FieldAnchor>
          <FieldAnchor fieldId="maxRetryInterval">
            <Input
              label={t('config_management.visual.sections.network.max_retry_interval')}
              type="number"
              placeholder="30"
              value={values.maxRetryInterval}
              onChange={(e) => onChange({ maxRetryInterval: e.target.value })}
              disabled={disabled}
              error={maxRetryIntervalError}
            />
          </FieldAnchor>
          <FieldAnchor fieldId="authAutoRefreshWorkers">
            <Input
              label={t('config_management.visual.sections.network.auth_auto_refresh_workers')}
              type="number"
              placeholder="16"
              value={values.authAutoRefreshWorkers}
              onChange={(e) => onChange({ authAutoRefreshWorkers: e.target.value })}
              disabled={disabled}
              hint={t('config_management.visual.sections.network.auth_auto_refresh_workers_hint')}
              error={authAutoRefreshWorkersError}
            />
          </FieldAnchor>
          <FieldAnchor fieldId="routingStrategy">
            <FieldShell
              label={t('config_management.visual.sections.network.routing_strategy')}
              labelId={routingStrategyLabelId}
              hint={t('config_management.visual.sections.network.routing_strategy_hint')}
              hintId={routingStrategyHintId}
            >
              <Select
                value={values.routingStrategy}
                options={[
                  {
                    value: 'round-robin',
                    label: t('config_management.visual.sections.network.strategy_round_robin'),
                  },
                  {
                    value: 'weighted-round-robin',
                    label: t(
                      'config_management.visual.sections.network.strategy_weighted_round_robin'
                    ),
                  },
                  {
                    value: 'fill-first',
                    label: t('config_management.visual.sections.network.strategy_fill_first'),
                  },
                ]}
                id={`${routingStrategyLabelId}-select`}
                disabled={disabled}
                ariaLabelledBy={routingStrategyLabelId}
                ariaDescribedBy={routingStrategyHintId}
                onChange={(nextValue) =>
                  onChange({
                    routingStrategy: nextValue as VisualConfigValues['routingStrategy'],
                  })
                }
              />
            </FieldShell>
          </FieldAnchor>
          <FieldAnchor fieldId="disableImageGeneration">
            <FieldShell
              label={t('config_management.visual.sections.network.disable_image_generation')}
              labelId={disableImageGenerationLabelId}
              hint={t('config_management.visual.sections.network.disable_image_generation_hint')}
              hintId={disableImageGenerationHintId}
            >
              <Select
                value={values.disableImageGeneration}
                options={disableImageGenerationOptions}
                id={`${disableImageGenerationLabelId}-select`}
                disabled={disabled}
                ariaLabelledBy={disableImageGenerationLabelId}
                ariaDescribedBy={disableImageGenerationHintId}
                onChange={(nextValue) =>
                  onChange({
                    disableImageGeneration:
                      nextValue as VisualConfigValues['disableImageGeneration'],
                  })
                }
              />
            </FieldShell>
          </FieldAnchor>
          <FieldAnchor fieldId="gptImage2BaseModel">
            <Input
              label={t('config_management.visual.sections.network.gpt_image_2_base_model')}
              placeholder="gpt-5.4-mini"
              value={values.gptImage2BaseModel}
              onChange={(e) => onChange({ gptImage2BaseModel: e.target.value })}
              disabled={disabled}
              hint={t('config_management.visual.sections.network.gpt_image_2_base_model_hint')}
            />
          </FieldAnchor>
          <FieldAnchor fieldId="routingSessionAffinityTTL">
            <Input
              label={t('config_management.visual.sections.network.session_affinity_ttl')}
              placeholder="1h"
              value={values.routingSessionAffinityTTL}
              onChange={(e) => onChange({ routingSessionAffinityTTL: e.target.value })}
              disabled={disabled}
            />
          </FieldAnchor>
        </FieldGrid>

        <FieldGrid>
          <FieldAnchor fieldId="forceModelPrefix">
            <ToggleRow
              title={t('config_management.visual.sections.network.force_model_prefix')}
              description={t('config_management.visual.sections.network.force_model_prefix_desc')}
              checked={values.forceModelPrefix}
              disabled={disabled}
              onChange={(forceModelPrefix) => onChange({ forceModelPrefix })}
            />
          </FieldAnchor>
          <FieldAnchor fieldId="passthroughHeaders">
            <ToggleRow
              title={t('config_management.visual.sections.network.passthrough_headers')}
              description={t('config_management.visual.sections.network.passthrough_headers_desc')}
              checked={values.passthroughHeaders}
              disabled={disabled}
              onChange={(passthroughHeaders) => onChange({ passthroughHeaders })}
            />
          </FieldAnchor>
          <FieldAnchor fieldId="disableCooling">
            <ToggleRow
              title={t('config_management.visual.sections.network.disable_cooling')}
              description={t('config_management.visual.sections.network.disable_cooling_desc')}
              checked={values.disableCooling}
              disabled={disabled}
              onChange={(disableCooling) => onChange({ disableCooling })}
            />
          </FieldAnchor>
          <FieldAnchor fieldId="routingSessionAffinity">
            <ToggleRow
              title={t('config_management.visual.sections.network.session_affinity')}
              checked={values.routingSessionAffinity}
              disabled={disabled}
              onChange={(routingSessionAffinity) => onChange({ routingSessionAffinity })}
            />
          </FieldAnchor>
          <FieldAnchor fieldId="wsAuth">
            <ToggleRow
              title={t('config_management.visual.sections.network.ws_auth')}
              description={t('config_management.visual.sections.network.ws_auth_desc')}
              checked={values.wsAuth}
              disabled={disabled}
              onChange={(wsAuth) => onChange({ wsAuth })}
            />
          </FieldAnchor>
        </FieldGrid>
      </FieldStack>
    </SectionCard>
  );
}
