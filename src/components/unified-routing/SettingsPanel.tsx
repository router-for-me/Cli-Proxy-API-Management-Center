/**
 * Settings Panel Component
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { UnifiedRoutingSettings, HealthCheckConfig } from '@/types';

interface SettingsPanelProps {
  settings: UnifiedRoutingSettings | null;
  healthCheckConfig: HealthCheckConfig | null;
  saving: boolean;
  disabled: boolean;
  onSaveSettings: (settings: UnifiedRoutingSettings) => void;
  onSaveHealthCheckConfig: (config: HealthCheckConfig) => void;
}

export function SettingsPanel({
  settings,
  healthCheckConfig,
  saving,
  disabled,
  onSaveSettings,
  onSaveHealthCheckConfig,
}: SettingsPanelProps) {
  const { t } = useTranslation();

  // Local state for settings
  const [enabled, setEnabled] = useState(false);
  const [hideOriginalModels, setHideOriginalModels] = useState(false);

  // Local state for health check config
  const [defaultCooldown, setDefaultCooldown] = useState(60);
  const [checkInterval, setCheckInterval] = useState(30);
  const [checkTimeout, setCheckTimeout] = useState(10);
  const [maxFailures, setMaxFailures] = useState(3);

  // Sync with props
  useEffect(() => {
    if (settings) {
      setEnabled(settings.enabled);
      setHideOriginalModels(settings.hide_original_models);
    }
  }, [settings]);

  useEffect(() => {
    if (healthCheckConfig) {
      setDefaultCooldown(healthCheckConfig.default_cooldown_seconds);
      setCheckInterval(healthCheckConfig.check_interval_seconds);
      setCheckTimeout(healthCheckConfig.check_timeout_seconds);
      setMaxFailures(healthCheckConfig.max_consecutive_failures);
    }
  }, [healthCheckConfig]);

  const hasSettingsChanges =
    settings &&
    (enabled !== settings.enabled || hideOriginalModels !== settings.hide_original_models);

  const hasHealthConfigChanges =
    healthCheckConfig &&
    (defaultCooldown !== healthCheckConfig.default_cooldown_seconds ||
      checkInterval !== healthCheckConfig.check_interval_seconds ||
      checkTimeout !== healthCheckConfig.check_timeout_seconds ||
      maxFailures !== healthCheckConfig.max_consecutive_failures);

  const handleSaveSettings = () => {
    onSaveSettings({
      enabled,
      hide_original_models: hideOriginalModels,
    });
  };

  const handleSaveHealthConfig = () => {
    onSaveHealthCheckConfig({
      default_cooldown_seconds: defaultCooldown,
      check_interval_seconds: checkInterval,
      check_timeout_seconds: checkTimeout,
      max_consecutive_failures: maxFailures,
    });
  };

  return (
    <div className="settings-panels">
      {/* General Settings */}
      <Card title={t('unified_routing.general_settings')}>
        <div className="settings-form">
          <div className="form-group form-group-inline">
            <div className="form-label-wrapper">
              <label className="form-label">{t('unified_routing.enable_unified_routing')}</label>
              <div className="form-hint">{t('unified_routing.enable_unified_routing_hint')}</div>
            </div>
            <ToggleSwitch
              checked={enabled}
              onChange={setEnabled}
              disabled={disabled || saving}
            />
          </div>

          <div className="form-group form-group-inline">
            <div className="form-label-wrapper">
              <label className="form-label">{t('unified_routing.hide_original_models')}</label>
              <div className="form-hint">{t('unified_routing.hide_original_models_hint')}</div>
            </div>
            <ToggleSwitch
              checked={hideOriginalModels}
              onChange={setHideOriginalModels}
              disabled={disabled || saving || !enabled}
            />
          </div>

          <div className="form-actions">
            <Button
              variant="primary"
              onClick={handleSaveSettings}
              disabled={disabled || saving || !hasSettingsChanges}
              loading={saving}
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      </Card>

      {/* Health Check Settings */}
      <Card title={t('unified_routing.health_check_settings')}>
        <div className="settings-form">
          <div className="form-group">
            <label className="form-label">{t('unified_routing.default_cooldown_seconds')}</label>
            <Input
              type="number"
              value={defaultCooldown}
              onChange={(e) => setDefaultCooldown(parseInt(e.target.value) || 60)}
              min={0}
              disabled={disabled || saving}
            />
            <div className="form-hint">{t('unified_routing.default_cooldown_hint')}</div>
          </div>

          <div className="form-group">
            <label className="form-label">{t('unified_routing.check_interval_seconds')}</label>
            <Input
              type="number"
              value={checkInterval}
              onChange={(e) => setCheckInterval(parseInt(e.target.value) || 30)}
              min={5}
              disabled={disabled || saving}
            />
            <div className="form-hint">{t('unified_routing.check_interval_hint')}</div>
          </div>

          <div className="form-group">
            <label className="form-label">{t('unified_routing.check_timeout_seconds')}</label>
            <Input
              type="number"
              value={checkTimeout}
              onChange={(e) => setCheckTimeout(parseInt(e.target.value) || 10)}
              min={1}
              max={60}
              disabled={disabled || saving}
            />
            <div className="form-hint">{t('unified_routing.check_timeout_hint')}</div>
          </div>

          <div className="form-group">
            <label className="form-label">{t('unified_routing.max_consecutive_failures')}</label>
            <Input
              type="number"
              value={maxFailures}
              onChange={(e) => setMaxFailures(parseInt(e.target.value) || 3)}
              min={1}
              max={10}
              disabled={disabled || saving}
            />
            <div className="form-hint">{t('unified_routing.max_consecutive_failures_hint')}</div>
          </div>

          <div className="form-actions">
            <Button
              variant="primary"
              onClick={handleSaveHealthConfig}
              disabled={disabled || saving || !hasHealthConfigChanges}
              loading={saving}
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
