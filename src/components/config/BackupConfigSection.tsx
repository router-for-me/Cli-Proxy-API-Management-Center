import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { backupApi, type BackupConfig } from '@/services/api';
import styles from './BackupConfigSection.module.scss';

interface BackupConfigSectionProps {
  disabled?: boolean;
}

export function BackupConfigSection({ disabled }: BackupConfigSectionProps) {
  const [config, setConfig] = useState<BackupConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const data = await backupApi.getConfig();
      setConfig(data);
      setError(null);
    } catch (err: any) {
      console.error('Failed to load backup config:', err);
      if (err?.response?.status === 404 || err?.status === 404) {
        setError('备份功能尚未在后端启用');
      } else {
        setError('加载配置失败');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await backupApi.testConnection();
      alert(result.message || '连接成功');
    } catch (error: any) {
      alert(error?.response?.data?.message || error?.message || '连接失败');
    } finally {
      setTesting(false);
    }
  };

  const handleDownloadBackup = async () => {
    setDownloading(true);
    try {
      const blob = await backupApi.downloadNewBackup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      alert('备份已下载');
    } catch (error) {
      alert('下载备份失败');
      console.error('Failed to download backup:', error);
    } finally {
      setDownloading(false);
    }
  };

  const handleRestoreFromFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!confirm(`确定要使用文件 "${file.name}" 恢复配置吗？当前配置将被覆盖。\n\n恢复后需要重启服务器才能生效。`)) {
      event.target.value = '';
      return;
    }

    setRestoring(true);
    try {
      const result = await backupApi.restoreFromFile(file);
      alert(result.message || '恢复成功！请重启服务器以应用更改。');
      event.target.value = '';
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || '恢复配置失败';
      alert(message);
      event.target.value = '';
      console.error('Failed to restore from file:', error);
    } finally {
      setRestoring(false);
    }
  };

  if (loading) {
    return <div className={styles.loading}>加载中...</div>;
  }

  if (error) {
    return (
      <div className={styles.error}>
        <p>{error}</p>
        <p className={styles.errorHint}>
          请确保后端服务器已启用备份功能。需要在后端实现以下 API：
        </p>
        <ul className={styles.apiList}>
          <li>GET /v0/management/backup/config</li>
          <li>PUT /v0/management/backup/config</li>
          <li>POST /v0/management/backup/test</li>
          <li>POST /v0/management/backup/create</li>
          <li>GET /v0/management/backup/list</li>
        </ul>
      </div>
    );
  }

  if (!config) {
    return <div className={styles.error}>配置不可用</div>;
  }

  return (
    <div className={styles.backupConfig}>
      {/* 基础配置 */}
      <Card title="基础配置" className={styles.card}>
        <div className={styles.formGroup}>
          <div className={styles.row}>
            <label>启用自动备份</label>
            <ToggleSwitch
              checked={config.enabled}
              onChange={(checked) => setConfig({ ...config, enabled: checked })}
              disabled={disabled}
            />
          </div>
          <div className={styles.row}>
            <label>备份计划</label>
            <select
              value={config.schedule}
              onChange={(e) => setConfig({ ...config, schedule: e.target.value })}
              className={styles.select}
              disabled={disabled}
            >
              <option value="">仅手动</option>
              <option value="@hourly">每小时</option>
              <option value="@daily">每天</option>
              <option value="@weekly">每周</option>
              <option value="@monthly">每月</option>
            </select>
          </div>
          <div className={styles.row}>
            <label>最大备份数</label>
            <Input
              type="number"
              min="0"
              value={config['max-backups'].toString()}
              onChange={(e) =>
                setConfig({ ...config, 'max-backups': parseInt(e.target.value) || 0 })
              }
              placeholder="0 = 无限制"
              disabled={disabled}
            />
          </div>
        </div>
      </Card>

      {/* 本地存储 */}
      <Card title="本地存储" className={styles.card}>
        <div className={styles.formGroup}>
          <div className={styles.row}>
            <label>启用本地存储</label>
            <ToggleSwitch
              checked={config.storage === 'local'}
              onChange={(checked) => setConfig({ ...config, storage: checked ? 'local' : '' })}
              disabled={disabled}
            />
          </div>
          {config.storage === 'local' && (
            <div className={styles.row}>
              <label>本地目录</label>
              <Input
                value={config['local-dir']}
                onChange={(e) => setConfig({ ...config, 'local-dir': e.target.value })}
                placeholder="./backups"
                disabled={disabled}
              />
            </div>
          )}
        </div>
        <div className={styles.actions}>
          <Button onClick={handleDownloadBackup} disabled={downloading || disabled}>
            {downloading ? '下载中...' : '下载备份'}
          </Button>
        </div>
      </Card>

      {/* S3 存储 */}
      <Card title="S3 对象存储" className={styles.card}>
        <div className={styles.formGroup}>
          <div className={styles.row}>
            <label>启用 S3 存储</label>
            <ToggleSwitch
              checked={config.storage === 's3'}
              onChange={(checked) => setConfig({ ...config, storage: checked ? 's3' : '' })}
              disabled={disabled}
            />
          </div>
          {config.storage === 's3' && (
            <>
              <div className={styles.row}>
                <label>端点地址</label>
                <Input
                  value={config.s3.endpoint}
                  onChange={(e) =>
                    setConfig({ ...config, s3: { ...config.s3, endpoint: e.target.value } })
                  }
                  placeholder="s3.amazonaws.com"
                  disabled={disabled}
                />
              </div>
              <div className={styles.row}>
                <label>区域</label>
                <Input
                  value={config.s3.region}
                  onChange={(e) =>
                    setConfig({ ...config, s3: { ...config.s3, region: e.target.value } })
                  }
                  placeholder="us-east-1"
                  disabled={disabled}
                />
              </div>
              <div className={styles.row}>
                <label>存储桶</label>
                <Input
                  value={config.s3.bucket}
                  onChange={(e) =>
                    setConfig({ ...config, s3: { ...config.s3, bucket: e.target.value } })
                  }
                  placeholder="my-backups"
                  disabled={disabled}
                />
              </div>
              <div className={styles.row}>
                <label>路径前缀</label>
                <Input
                  value={config.s3.path}
                  onChange={(e) =>
                    setConfig({ ...config, s3: { ...config.s3, path: e.target.value } })
                  }
                  placeholder="backups/"
                  disabled={disabled}
                />
              </div>
              <div className={styles.row}>
                <label>访问密钥</label>
                <Input
                  value={config.s3['access-key']}
                  onChange={(e) =>
                    setConfig({ ...config, s3: { ...config.s3, 'access-key': e.target.value } })
                  }
                  placeholder="Access Key ID"
                  disabled={disabled}
                />
              </div>
              <div className={styles.row}>
                <label>密钥</label>
                <Input
                  type="password"
                  value={config.s3['secret-key']}
                  onChange={(e) =>
                    setConfig({ ...config, s3: { ...config.s3, 'secret-key': e.target.value } })
                  }
                  placeholder="Secret Access Key"
                  disabled={disabled}
                />
              </div>
              <div className={styles.row}>
                <label>使用 SSL</label>
                <ToggleSwitch
                  checked={config.s3['use-ssl']}
                  onChange={(checked) =>
                    setConfig({ ...config, s3: { ...config.s3, 'use-ssl': checked } })
                  }
                  disabled={disabled}
                />
              </div>
            </>
          )}
        </div>
        <div className={styles.actions}>
          {config.storage === 's3' && (
            <Button onClick={handleTest} disabled={testing || disabled}>
              {testing ? '测试中...' : '测试连接'}
            </Button>
          )}
        </div>
      </Card>

      {/* WebDAV 存储 */}
      <Card title="WebDAV 存储" className={styles.card}>
        <div className={styles.formGroup}>
          <div className={styles.row}>
            <label>启用 WebDAV 存储</label>
            <ToggleSwitch
              checked={config.storage === 'webdav'}
              onChange={(checked) => setConfig({ ...config, storage: checked ? 'webdav' : '' })}
              disabled={disabled}
            />
          </div>
          {config.storage === 'webdav' && (
            <>
              <div className={styles.row}>
                <label>服务器地址</label>
                <Input
                  value={config.webdav.url}
                  onChange={(e) =>
                    setConfig({ ...config, webdav: { ...config.webdav, url: e.target.value } })
                  }
                  placeholder="https://webdav.example.com"
                  disabled={disabled}
                />
              </div>
              <div className={styles.row}>
                <label>用户名</label>
                <Input
                  value={config.webdav.username}
                  onChange={(e) =>
                    setConfig({ ...config, webdav: { ...config.webdav, username: e.target.value } })
                  }
                  placeholder="Username"
                  disabled={disabled}
                />
              </div>
              <div className={styles.row}>
                <label>密码</label>
                <Input
                  type="password"
                  value={config.webdav.password}
                  onChange={(e) =>
                    setConfig({ ...config, webdav: { ...config.webdav, password: e.target.value } })
                  }
                  placeholder="Password"
                  disabled={disabled}
                />
              </div>
              <div className={styles.row}>
                <label>远程路径</label>
                <Input
                  value={config.webdav.path}
                  onChange={(e) =>
                    setConfig({ ...config, webdav: { ...config.webdav, path: e.target.value } })
                  }
                  placeholder="backups/"
                  disabled={disabled}
                />
              </div>
            </>
          )}
        </div>
        <div className={styles.actions}>
          {config.storage === 'webdav' && (
            <Button onClick={handleTest} disabled={testing || disabled}>
              {testing ? '测试中...' : '测试连接'}
            </Button>
          )}
        </div>
      </Card>

      {/* 恢复配置 */}
      <Card title="恢复配置" className={styles.card}>
        <div className={styles.formGroup}>
          <div className={styles.row}>
            <label>从文件恢复</label>
            <div className={styles.fileInput}>
              <input
                type="file"
                accept=".zip"
                onChange={handleRestoreFromFile}
                disabled={disabled || restoring}
                id="restore-file-input"
              />
              <label htmlFor="restore-file-input" className={styles.fileLabel}>
                {restoring ? '恢复中...' : '选择备份文件'}
              </label>
            </div>
          </div>
          <div className={styles.hint}>
            支持从本地上传的备份文件恢复配置。上传 .zip 格式的备份文件，恢复后需要重启服务器。
          </div>
        </div>
      </Card>
    </div>
  );
}
