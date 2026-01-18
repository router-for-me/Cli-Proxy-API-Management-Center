/**
 * 不支持自动禁用提示弹窗组件
 * 显示手动操作指南
 */

import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import type { UnsupportedDisableState } from '@/hooks/useDisableModel';

interface UnsupportedDisableModalProps {
  /** 不支持禁用的状态 */
  state: UnsupportedDisableState | null;
  /** 关闭回调 */
  onClose: () => void;
}

export function UnsupportedDisableModal({
  state,
  onClose,
}: UnsupportedDisableModalProps) {
  const { t } = useTranslation();

  if (!state) return null;

  return (
    <Modal
      open={!!state}
      onClose={onClose}
      title={t('monitor.logs.disable_unsupported_title')}
      width={450}
    >
      <div style={{ padding: '16px 0' }}>
        {/* 提示信息 */}
        <p style={{
          marginBottom: 16,
          lineHeight: 1.6,
          color: 'var(--warning-color, #f59e0b)',
          fontWeight: 500,
        }}>
          ⚠️ {t('monitor.logs.disable_unsupported_desc', { providerType: state.providerType })}
        </p>

        {/* 手动操作指南 */}
        <div style={{
          padding: '12px 16px',
          background: 'var(--bg-tertiary)',
          borderRadius: '8px',
          marginBottom: 16,
        }}>
          <p style={{
            fontWeight: 600,
            marginBottom: 8,
            color: 'var(--text-primary)',
          }}>
            {t('monitor.logs.disable_unsupported_guide_title')}
          </p>
          <ul style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
            fontSize: 13,
            lineHeight: 1.8,
            color: 'var(--text-secondary)',
          }}>
            <li>{t('monitor.logs.disable_unsupported_guide_step1')}</li>
            <li>{t('monitor.logs.disable_unsupported_guide_step2', { providerType: state.providerType })}</li>
            <li>{t('monitor.logs.disable_unsupported_guide_step3', { model: state.model })}</li>
            <li>{t('monitor.logs.disable_unsupported_guide_step4')}</li>
          </ul>
        </div>

        {/* 关闭按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="primary" onClick={onClose}>
            {t('monitor.logs.disable_unsupported_close')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
