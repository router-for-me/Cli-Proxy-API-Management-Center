import { useCallback, useState } from 'react';
import type { VisualConfigValues } from '@/hooks/useVisualConfig';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconShield, IconEye, IconEyeOff, IconRefreshCw } from '@/components/ui/icons';
import { apiClient } from '@/services/api';
import styles from './VisualConfigEditor.module.scss';

interface TorConfigPanelProps {
  values: VisualConfigValues;
  onChange: (patch: Partial<VisualConfigValues>) => void;
  disabled?: boolean;
}

export function TorConfigPanel({ values, onChange, disabled }: TorConfigPanelProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [testResult, setTestResult] = useState<{
    success?: boolean;
    ip?: string;
    country?: string;
    error?: string;
  } | null>(null);
  const [rotateResult, setRotateResult] = useState<{
    success?: boolean;
    message?: string;
    old_ip?: string;
    new_ip?: string;
    error?: string;
  } | null>(null);

  const isTorMode = values.proxyMode === 'tor';

  const handleToggleTor = useCallback(
    (checked: boolean) => {
      const patch: Partial<VisualConfigValues> = {
        proxyMode: checked ? 'tor' : 'proxy',
      };
      if (checked) {
        patch.torControlAddr = values.torControlAddr || '127.0.0.1:9051';
        patch.torProxyAddr = values.torProxyAddr || '127.0.0.1:9050';
        patch.torRetryAttempts = values.torRetryAttempts || '3';
        patch.torRetryOnCodesText =
          values.torRetryOnCodesText || '429, 403, 500, 502, 503';
      }
      onChange(patch);
    },
    [values, onChange],
  );

  const handleTestIp = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const data = await apiClient.post<{
        success?: boolean;
        ip?: string;
        country?: string;
        error?: string;
      }>('/test-proxy');
      setTestResult(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      setTestResult({ success: false, error: msg });
    } finally {
      setTesting(false);
    }
  }, []);

  const handleRotateIp = useCallback(async () => {
    setRotating(true);
    setRotateResult(null);
    try {
      const data = await apiClient.post<{
        success?: boolean;
        message?: string;
        new_ip?: string;
        error?: string;
      }>('/tor-rotate');
      setRotateResult(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      setRotateResult({ success: false, error: msg });
    } finally {
      setRotating(false);
    }
  }, []);

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.indexBadge}>TOR</span>
          <span className={styles.iconBadge}>
            <IconShield size={16} />
          </span>
        </div>
        <div className={styles.headingGroup}>
          <h2 className={styles.title}>Tor Proxy</h2>
          <p className={styles.description}>
            Route all traffic through Tor network with automatic IP rotation
          </p>
        </div>
      </header>
      <div className={styles.content}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Enable/Disable Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <ToggleSwitch
              checked={isTorMode}
              disabled={disabled}
              onChange={handleToggleTor}
            />
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600 }}>
                Enable Tor Proxy
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Route all API requests through Tor SOCKS5 proxy
              </div>
            </div>
          </div>

          {isTorMode && (
            <>
              {/* Status Card */}
              <div className={styles.torStatusCard}>
                <div className={styles.torStatusHeader}>
                  <IconShield size={14} />
                  <span>Tor Network Active</span>
                </div>
                <div className={styles.torStatusBody}>
                  <div className={styles.torStatusRow}>
                    <span className={styles.torStatusLabel}>Proxy Address</span>
                    <span className={styles.torStatusValue}>
                      {values.torProxyAddr || '127.0.0.1:9050'}
                    </span>
                  </div>
                  <div className={styles.torStatusRow}>
                    <span className={styles.torStatusLabel}>Control Port</span>
                    <span className={styles.torStatusValue}>
                      {values.torControlAddr || '127.0.0.1:9051'}
                    </span>
                  </div>
                  <div className={styles.torStatusRow}>
                    <span className={styles.torStatusLabel}>Retry Attempts</span>
                    <span className={styles.torStatusValue}>
                      {values.torRetryAttempts || '3'}
                    </span>
                  </div>
                </div>
              </div>

              {/* IP Check & Rotate */}
              <div className={styles.torActions}>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={testing}
                  disabled={disabled || testing}
                  onClick={handleTestIp}
                >
                  Check Current IP
                </Button>
                {testResult && (
                  <div
                    className={
                      testResult.success
                        ? styles.torResultSuccess
                        : styles.torResultError
                    }
                  >
                    {testResult.success ? (
                      <>
                        IP: {testResult.ip}
                        {testResult.country
                          ? ` (${testResult.country})`
                          : ''}
                      </>
                    ) : (
                      <>Error: {testResult.error || 'Failed'}</>
                    )}
                  </div>
                )}

                <Button
                  variant="secondary"
                  size="sm"
                  loading={rotating}
                  disabled={disabled || rotating}
                  onClick={handleRotateIp}
                >
                  <IconRefreshCw size={14} style={{ marginRight: 4 }} />
                  Rotate IP
                </Button>
                {rotateResult && (
                  <div
                    className={
                      rotateResult.success
                        ? styles.torResultSuccess
                        : styles.torResultError
                    }
                  >
                    {rotateResult.success ? (
                      <>
                        {rotateResult.message || 'IP rotated'}
                        {rotateResult.old_ip && rotateResult.new_ip && (
                          <>
                            {' '}
                            ({rotateResult.old_ip} → {rotateResult.new_ip})
                          </>
                        )}
                      </>
                    ) : (
                      <>Error: {rotateResult.error || 'Failed'}</>
                    )}
                  </div>
                )}
              </div>

              {/* Configuration Fields */}
              <div className={styles.torConfigGrid}>
                <div className="form-group">
                  <label>SOCKS5 Proxy Address</label>
                  <Input
                    placeholder="127.0.0.1:9050"
                    value={values.torProxyAddr}
                    onChange={(e) => onChange({ torProxyAddr: e.target.value })}
                    disabled={disabled}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    Tor SOCKS5 proxy endpoint
                  </span>
                </div>

                <div className="form-group">
                  <label>Control Port Address</label>
                  <Input
                    placeholder="127.0.0.1:9051"
                    value={values.torControlAddr}
                    onChange={(e) => onChange({ torControlAddr: e.target.value })}
                    disabled={disabled}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    For NEWNYM signal (IP rotation)
                  </span>
                </div>

                <div className="form-group">
                  <label>Control Port Password</label>
                  <div style={{ position: 'relative' }}>
                    <Input
                      placeholder="Optional"
                      type={showPassword ? 'text' : 'password'}
                      value={values.torControlPassword}
                      onChange={(e) =>
                        onChange({ torControlPassword: e.target.value })
                      }
                      disabled={disabled}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className={styles.torPasswordToggle}
                      style={{
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                      }}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                    </button>
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    Password for Tor control port authentication
                  </span>
                </div>

                <div className="form-group">
                  <label>Max Retry Attempts</label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="3"
                    value={values.torRetryAttempts}
                    onChange={(e) =>
                      onChange({ torRetryAttempts: e.target.value })
                    }
                    disabled={disabled}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    0 = unlimited retries
                  </span>
                </div>

                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Retry on HTTP Codes</label>
                  <Input
                    placeholder="429, 403, 500, 502, 503"
                    value={values.torRetryOnCodesText}
                    onChange={(e) =>
                      onChange({ torRetryOnCodesText: e.target.value })
                    }
                    disabled={disabled}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    Comma-separated status codes that trigger IP rotation
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
