import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { backupApi } from '@/services/api';
import { useNotificationStore } from '@/stores';
import type { BackupConfig } from '@/types/visualConfig';
import styles from './BackupConfigSection.module.scss';

interface BackupConfigSectionProps {
  disabled?: boolean;
  config: BackupConfig;
  onChange: (config: Partial<BackupConfig>) => void;
}

export function BackupConfigSection({ disabled, config, onChange }: BackupConfigSectionProps) {
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [testing, setTesting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await backupApi.testConnection();
      showNotification(result.message || '连接成功', 'success');
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || '连接失败';
      showNotification(message, 'error');
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
      showNotification('备份已下载', 'success');
    } catch (error) {
      showNotification('下载备份失败', 'error');
      console.error('Failed to download backup:', error);
    } finally {
      setDownloading(false);
    }
  };

  const handleCreateBackup = async () => {
    setCreating(true);
    try {
      await backupApi.createBackup();
      showNotification('备份已创建', 'success');
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || '创建备份失败';
      showNotification(message, 'error');
      console.error('Failed to create backup:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleRestoreFromFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    showConfirmation({
      title: '确认恢复',
      message: `确定要使用文件 "${file.name}" 恢复配置吗？当前配置将被覆盖。`,
      confirmText: '确认恢复',
      cancelText: '取消',
      variant: 'danger',
      onConfirm: async () => {
        setRestoring(true);
        try {
          const result = await backupApi.restoreFromFile(file);
          showNotification(result.message || '恢复成功！配置已自动重新加载。', 'success');
          event.target.value = '';

          // Trigger config reload
          window.location.reload();
        } catch (error: any) {
          const message = error?.response?.data?.message || error?.message || '恢复配置失败';
          showNotification(message, 'error');
          event.target.value = '';
          console.error('Failed to restore from file:', error);
        } finally {
          setRestoring(false);
        }
      },
      onCancel: () => {
        event.target.value = '';
      },
    });
  };

  return (
    <div className={styles.backupConfig}>
      {/* 基础配置 */}
      <Card title="基础配置" className={styles.card}>
        <div className={styles.formGroup}>
          <div className={styles.row}>
            <label>启用自动备份</label>
            <ToggleSwitch
              checked={config.enabled}
              onChange={(checked) => onChange({ enabled: checked })}
              disabled={disabled}
            />
          </div>
          <div className={styles.row}>
            <label>备份计划</label>
            <select
              value={config.schedule}
              onChange={(e) => onChange({ schedule: e.target.value })}
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
              value={config.maxBackups.toString()}
              onChange={(e) =>
                onChange({ maxBackups: String(parseInt(e.target.value) || 0) })
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
              checked={config.enableLocal}
              onChange={(checked) => onChange({ enableLocal: checked })}
              disabled={disabled}
            />
          </div>
          {config.enableLocal && (
            <div className={styles.row}>
              <label>本地目录</label>
              <Input
                value={config.localDir}
                onChange={(e) => onChange({ localDir: e.target.value })}
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
          {config.enableLocal && (
            <Button onClick={handleCreateBackup} disabled={creating || disabled} variant="secondary">
              {creating ? '创建中...' : '创建备份'}
            </Button>
          )}
        </div>
      </Card>

      {/* S3 存储 */}
      <Card title="S3 对象存储" className={styles.card}>
        <div className={styles.formGroup}>
          <div className={styles.row}>
            <label>启用 S3 存储</label>
            <ToggleSwitch
              checked={config.enableS3}
              onChange={(checked) => onChange({ enableS3: checked })}
              disabled={disabled}
            />
          </div>
          {config.enableS3 && (
            <>
              <div className={styles.row}>
                <label>端点地址</label>
                <Input
                  value={config.s3.endpoint}
                  onChange={(e) =>
                    onChange({ s3: { ...config.s3, endpoint: e.target.value } })
                  }
                  placeholder="https://s3.amazonaws.com"
                  disabled={disabled}
                />
              </div>
              <div className={styles.hint}>
                端点地址应包含协议前缀（如 https://），且不能包含路径。
              </div>
              <div className={styles.row}>
                <label>区域</label>
                <Input
                  value={config.s3.region}
                  onChange={(e) =>
                    onChange({ s3: { ...config.s3, region: e.target.value } })
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
                    onChange({ s3: { ...config.s3, bucket: e.target.value } })
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
                    onChange({ s3: { ...config.s3, path: e.target.value } })
                  }
                  placeholder="backups/"
                  disabled={disabled}
                />
              </div>
              <div className={styles.row}>
                <label>访问密钥</label>
                <Input
                  value={config.s3.accessKey}
                  onChange={(e) =>
                    onChange({ s3: { ...config.s3, accessKey: e.target.value } })
                  }
                  placeholder="Access Key ID"
                  disabled={disabled}
                />
              </div>
              <div className={styles.row}>
                <label>密钥</label>
                <Input
                  type="password"
                  value={config.s3.secretKey}
                  onChange={(e) =>
                    onChange({ s3: { ...config.s3, secretKey: e.target.value } })
                  }
                  placeholder="Secret Access Key"
                  disabled={disabled}
                />
              </div>
              <div className={styles.row}>
                <label>使用 SSL</label>
                <ToggleSwitch
                  checked={config.s3.useSSL}
                  onChange={(checked) =>
                    onChange({ s3: { ...config.s3, useSSL: checked } })
                  }
                  disabled={disabled}
                />
              </div>
            </>
          )}
        </div>
        <div className={styles.actions}>
          {config.enableS3 && (
            <>
              <Button onClick={handleTest} disabled={testing || disabled}>
                {testing ? '测试中...' : '测试连接'}
              </Button>
              <Button onClick={handleCreateBackup} disabled={creating || disabled} variant="secondary">
                {creating ? '创建中...' : '创建备份'}
              </Button>
            </>
          )}
        </div>
      </Card>

      {/* WebDAV 存储 */}
      <Card title="WebDAV 存储" className={styles.card}>
        <div className={styles.formGroup}>
          <div className={styles.row}>
            <label>启用 WebDAV 存储</label>
            <ToggleSwitch
              checked={config.enableWebDAV}
              onChange={(checked) => onChange({ enableWebDAV: checked })}
              disabled={disabled}
            />
          </div>
          {config.enableWebDAV && (
            <>
              <div className={styles.row}>
                <label>服务器地址</label>
                <Input
                  value={config.webdav.url}
                  onChange={(e) =>
                    onChange({ webdav: { ...config.webdav, url: e.target.value } })
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
                    onChange({ webdav: { ...config.webdav, username: e.target.value } })
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
                    onChange({ webdav: { ...config.webdav, password: e.target.value } })
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
                    onChange({ webdav: { ...config.webdav, path: e.target.value } })
                  }
                  placeholder="backups/"
                  disabled={disabled}
                />
              </div>
            </>
          )}
        </div>
        <div className={styles.actions}>
          {config.enableWebDAV && (
            <>
              <Button onClick={handleTest} disabled={testing || disabled}>
                {testing ? '测试中...' : '测试连接'}
              </Button>
              <Button onClick={handleCreateBackup} disabled={creating || disabled} variant="secondary">
                {creating ? '创建中...' : '创建备份'}
              </Button>
            </>
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
