/**
 * Route Create/Edit Modal
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { Route } from '@/types';

interface RouteModalProps {
  open: boolean;
  route: Route | null;
  saving: boolean;
  onClose: () => void;
  onSave: (data: { name: string; description?: string; enabled: boolean }) => void;
}

export function RouteModal({ open, route, saving, onClose, onSave }: RouteModalProps) {
  const { t } = useTranslation();
  const isEdit = !!route;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [errors, setErrors] = useState<{ name?: string }>({});

  useEffect(() => {
    if (open) {
      if (route) {
        setName(route.name);
        setDescription(route.description || '');
        setEnabled(route.enabled);
      } else {
        setName('');
        setDescription('');
        setEnabled(true);
      }
      setErrors({});
    }
  }, [open, route]);

  const validate = () => {
    const newErrors: { name?: string } = {};
    
    if (!name.trim()) {
      newErrors.name = t('unified_routing.route_name_required');
    } else if (!/^[a-zA-Z0-9._-]+$/.test(name.trim())) {
      newErrors.name = t('unified_routing.route_name_invalid');
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      enabled,
    });
  };

  return (
    <Modal
      open={open}
      title={isEdit ? t('unified_routing.edit_route') : t('unified_routing.create_route')}
      onClose={onClose}
      closeDisabled={saving}
      footer={
        <div className="modal-footer-buttons">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={handleSubmit} loading={saving}>
            {isEdit ? t('common.save') : t('common.create')}
          </Button>
        </div>
      }
    >
      <div className="form-group">
        <label className="form-label">
          {t('unified_routing.route_name')}
          <span className="required">*</span>
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('unified_routing.route_name_placeholder')}
          disabled={saving}
          error={errors.name}
        />
        <div className="form-hint">{t('unified_routing.route_name_hint')}</div>
      </div>

      <div className="form-group">
        <label className="form-label">{t('unified_routing.route_description')}</label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('unified_routing.route_description_placeholder')}
          disabled={saving}
        />
      </div>

      <div className="form-group form-group-inline">
        <label className="form-label">{t('unified_routing.route_enabled')}</label>
        <ToggleSwitch
          checked={enabled}
          onChange={setEnabled}
          disabled={saving}
        />
      </div>
    </Modal>
  );
}
