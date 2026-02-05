import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconChevronDown } from '@/components/ui/icons';
import { ConfigSection } from '@/components/config/ConfigSection';
import type {
  PayloadFilterRule,
  PayloadModelEntry,
  PayloadParamEntry,
  PayloadParamValueType,
  PayloadRule,
  VisualConfigValues,
} from '@/types/visualConfig';
import { makeClientId } from '@/types/visualConfig';
import {
  VISUAL_CONFIG_PAYLOAD_VALUE_TYPE_OPTIONS,
  VISUAL_CONFIG_PROTOCOL_OPTIONS,
} from '@/hooks/useVisualConfig';
import { maskApiKey } from '@/utils/format';
import { isValidApiKeyCharset } from '@/utils/validation';

interface VisualConfigEditorProps {
  values: VisualConfigValues;
  disabled?: boolean;
  onChange: (values: Partial<VisualConfigValues>) => void;
}

type ToggleRowProps = {
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
};

function ToggleRow({ title, description, checked, disabled, onChange }: ToggleRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 220 }}>
        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
        {description && (
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
            {description}
          </div>
        )}
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} ariaLabel={title} />
    </div>
  );
}

function SectionGrid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 16,
      }}
    >
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--border-color)', margin: '16px 0' }} />;
}

type ToastSelectOption = { value: string; label: string };

function ToastSelect({
  value,
  options,
  disabled,
  ariaLabel,
  onChange,
}: {
  value: string;
  options: ReadonlyArray<ToastSelectOption>;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const selectedOption = options.find((opt) => opt.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="input"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          cursor: disabled ? 'not-allowed' : 'pointer',
          textAlign: 'left',
          width: '100%',
          appearance: 'none',
        }}
      >
        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
          {selectedOption?.label ?? ''}
        </span>
        <IconChevronDown size={16} style={{ opacity: 0.6, flex: '0 0 auto' }} />
      </button>

      {open && !disabled && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 1000,
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: 12,
            padding: 6,
            boxShadow: 'var(--shadow)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            maxHeight: 260,
            overflowY: 'auto',
          }}
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: active ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid var(--border-color)',
                  background: active ? 'rgba(59, 130, 246, 0.10)' : 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontWeight: 600,
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ApiKeysCardEditor({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (nextValue: string) => void;
}) {
  const apiKeys = useMemo(
    () =>
      value
        .split('\n')
        .map((key) => key.trim())
        .filter(Boolean),
    [value]
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [formError, setFormError] = useState('');

  const openAddModal = () => {
    setEditingIndex(null);
    setInputValue('');
    setFormError('');
    setModalOpen(true);
  };

  const openEditModal = (index: number) => {
    setEditingIndex(index);
    setInputValue(apiKeys[index] ?? '');
    setFormError('');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setInputValue('');
    setEditingIndex(null);
    setFormError('');
  };

  const updateApiKeys = (nextKeys: string[]) => {
    onChange(nextKeys.join('\n'));
  };

  const handleDelete = (index: number) => {
    updateApiKeys(apiKeys.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      setFormError('请输入 API 密钥');
      return;
    }
    if (!isValidApiKeyCharset(trimmed)) {
      setFormError('API 密钥包含无效字符');
      return;
    }

    const nextKeys =
      editingIndex === null
        ? [...apiKeys, trimmed]
        : apiKeys.map((key, idx) => (idx === editingIndex ? trimmed : key));
    updateApiKeys(nextKeys);
    closeModal();
  };

  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <label style={{ margin: 0 }}>API 密钥列表 (api-keys)</label>
        <Button size="sm" onClick={openAddModal} disabled={disabled}>
          添加 API 密钥
        </Button>
      </div>

      {apiKeys.length === 0 ? (
        <div
          style={{
            border: '1px dashed var(--border-color)',
            borderRadius: 12,
            padding: 16,
            color: 'var(--text-secondary)',
            textAlign: 'center',
          }}
        >
          暂无 API 密钥
        </div>
      ) : (
        <div className="item-list" style={{ marginTop: 4 }}>
          {apiKeys.map((key, index) => (
            <div key={`${key}-${index}`} className="item-row">
              <div className="item-meta">
                <div className="pill">#{index + 1}</div>
                <div className="item-title">API Key</div>
                <div className="item-subtitle">{maskApiKey(String(key || ''))}</div>
              </div>
              <div className="item-actions">
                <Button variant="secondary" size="sm" onClick={() => openEditModal(index)} disabled={disabled}>
                  编辑
                </Button>
                <Button variant="danger" size="sm" onClick={() => handleDelete(index)} disabled={disabled}>
                  删除
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="hint">每个条目代表一个 API 密钥（与 “API 密钥管理” 页面样式一致）</div>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editingIndex !== null ? '编辑 API 密钥' : '添加 API 密钥'}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={disabled}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={disabled}>
              {editingIndex !== null ? '更新' : '添加'}
            </Button>
          </>
        }
      >
        <Input
          label="API 密钥"
          placeholder="粘贴你的 API 密钥"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={disabled}
          error={formError || undefined}
          hint="此处仅修改本地配置文件内容，不会自动同步到 API 密钥管理接口"
        />
      </Modal>
    </div>
  );
}

function StringListEditor({
  value,
  disabled,
  placeholder,
  onChange,
}: {
  value: string[];
  disabled?: boolean;
  placeholder?: string;
  onChange: (next: string[]) => void;
}) {
  const items = value.length ? value : [];

  const updateItem = (index: number, nextValue: string) =>
    onChange(items.map((item, i) => (i === index ? nextValue : item)));
  const addItem = () => onChange([...items, '']);
  const removeItem = (index: number) => onChange(items.filter((_, i) => i !== index));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item, index) => (
        <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="input"
            placeholder={placeholder}
            value={item}
            onChange={(e) => updateItem(index, e.target.value)}
            disabled={disabled}
            style={{ flex: 1 }}
          />
          <Button variant="ghost" size="sm" onClick={() => removeItem(index)} disabled={disabled}>
            删除
          </Button>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="secondary" size="sm" onClick={addItem} disabled={disabled}>
          添加
        </Button>
      </div>
    </div>
  );
}

function PayloadRulesEditor({
  value,
  disabled,
  protocolFirst = false,
  onChange,
}: {
  value: PayloadRule[];
  disabled?: boolean;
  protocolFirst?: boolean;
  onChange: (next: PayloadRule[]) => void;
}) {
  const rules = value.length ? value : [];

  const addRule = () => onChange([...rules, { id: makeClientId(), models: [], params: [] }]);
  const removeRule = (ruleIndex: number) => onChange(rules.filter((_, i) => i !== ruleIndex));

  const updateRule = (ruleIndex: number, patch: Partial<PayloadRule>) =>
    onChange(rules.map((rule, i) => (i === ruleIndex ? { ...rule, ...patch } : rule)));

  const addModel = (ruleIndex: number) => {
    const rule = rules[ruleIndex];
    const nextModel: PayloadModelEntry = { id: makeClientId(), name: '', protocol: undefined };
    updateRule(ruleIndex, { models: [...rule.models, nextModel] });
  };

  const removeModel = (ruleIndex: number, modelIndex: number) => {
    const rule = rules[ruleIndex];
    updateRule(ruleIndex, { models: rule.models.filter((_, i) => i !== modelIndex) });
  };

  const updateModel = (ruleIndex: number, modelIndex: number, patch: Partial<PayloadModelEntry>) => {
    const rule = rules[ruleIndex];
    updateRule(ruleIndex, {
      models: rule.models.map((m, i) => (i === modelIndex ? { ...m, ...patch } : m)),
    });
  };

  const addParam = (ruleIndex: number) => {
    const rule = rules[ruleIndex];
    const nextParam: PayloadParamEntry = {
      id: makeClientId(),
      path: '',
      valueType: 'string',
      value: '',
    };
    updateRule(ruleIndex, { params: [...rule.params, nextParam] });
  };

  const removeParam = (ruleIndex: number, paramIndex: number) => {
    const rule = rules[ruleIndex];
    updateRule(ruleIndex, { params: rule.params.filter((_, i) => i !== paramIndex) });
  };

  const updateParam = (ruleIndex: number, paramIndex: number, patch: Partial<PayloadParamEntry>) => {
    const rule = rules[ruleIndex];
    updateRule(ruleIndex, {
      params: rule.params.map((p, i) => (i === paramIndex ? { ...p, ...patch } : p)),
    });
  };

  const getValuePlaceholder = (valueType: PayloadParamValueType) => {
    switch (valueType) {
      case 'string':
        return '字符串值';
      case 'number':
        return '数字值 (如 0.7)';
      case 'boolean':
        return 'true 或 false';
      case 'json':
        return 'JSON 值';
      default:
        return '值';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rules.map((rule, ruleIndex) => (
        <div
          key={rule.id}
          style={{
            border: '1px solid var(--border-color)',
            borderRadius: 12,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>规则 {ruleIndex + 1}</div>
            <Button variant="ghost" size="sm" onClick={() => removeRule(ruleIndex)} disabled={disabled}>
              删除
            </Button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>适用模型</div>
            {(rule.models.length ? rule.models : []).map((model, modelIndex) => (
              <div
                key={model.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: protocolFirst ? '160px 1fr auto' : '1fr 160px auto',
                  gap: 8,
                }}
              >
                {protocolFirst ? (
                  <>
                    <ToastSelect
                      value={model.protocol ?? ''}
                      options={VISUAL_CONFIG_PROTOCOL_OPTIONS}
                      disabled={disabled}
                      ariaLabel="供应商类型"
                      onChange={(nextValue) =>
                        updateModel(ruleIndex, modelIndex, {
                          protocol: (nextValue || undefined) as PayloadModelEntry['protocol'],
                        })
                      }
                    />
                    <input
                      className="input"
                      placeholder="模型名称"
                      value={model.name}
                      onChange={(e) => updateModel(ruleIndex, modelIndex, { name: e.target.value })}
                      disabled={disabled}
                    />
                  </>
                ) : (
                  <>
                    <input
                      className="input"
                      placeholder="模型名称"
                      value={model.name}
                      onChange={(e) => updateModel(ruleIndex, modelIndex, { name: e.target.value })}
                      disabled={disabled}
                    />
                    <ToastSelect
                      value={model.protocol ?? ''}
                      options={VISUAL_CONFIG_PROTOCOL_OPTIONS}
                      disabled={disabled}
                      ariaLabel="供应商类型"
                      onChange={(nextValue) =>
                        updateModel(ruleIndex, modelIndex, {
                          protocol: (nextValue || undefined) as PayloadModelEntry['protocol'],
                        })
                      }
                    />
                  </>
                )}
                <Button variant="ghost" size="sm" onClick={() => removeModel(ruleIndex, modelIndex)} disabled={disabled}>
                  删除
                </Button>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="secondary" size="sm" onClick={() => addModel(ruleIndex)} disabled={disabled}>
                添加模型
              </Button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>参数设置</div>
            {(rule.params.length ? rule.params : []).map((param, paramIndex) => (
              <div key={param.id} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 1fr auto', gap: 8 }}>
                <input
                  className="input"
                  placeholder="JSON 路径 (如 temperature)"
                  value={param.path}
                  onChange={(e) => updateParam(ruleIndex, paramIndex, { path: e.target.value })}
                  disabled={disabled}
                />
                <ToastSelect
                  value={param.valueType}
                  options={VISUAL_CONFIG_PAYLOAD_VALUE_TYPE_OPTIONS}
                  disabled={disabled}
                  ariaLabel="参数类型"
                  onChange={(nextValue) =>
                    updateParam(ruleIndex, paramIndex, { valueType: nextValue as PayloadParamValueType })
                  }
                />
                <input
                  className="input"
                  placeholder={getValuePlaceholder(param.valueType)}
                  value={param.value}
                  onChange={(e) => updateParam(ruleIndex, paramIndex, { value: e.target.value })}
                  disabled={disabled}
                />
                <Button variant="ghost" size="sm" onClick={() => removeParam(ruleIndex, paramIndex)} disabled={disabled}>
                  删除
                </Button>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="secondary" size="sm" onClick={() => addParam(ruleIndex)} disabled={disabled}>
                添加参数
              </Button>
            </div>
          </div>
        </div>
      ))}

      {rules.length === 0 && (
        <div
          style={{
            border: '1px dashed var(--border-color)',
            borderRadius: 12,
            padding: 16,
            color: 'var(--text-secondary)',
            textAlign: 'center',
          }}
        >
          暂无规则
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="secondary" size="sm" onClick={addRule} disabled={disabled}>
          添加规则
        </Button>
      </div>
    </div>
  );
}

function PayloadFilterRulesEditor({
  value,
  disabled,
  onChange,
}: {
  value: PayloadFilterRule[];
  disabled?: boolean;
  onChange: (next: PayloadFilterRule[]) => void;
}) {
  const rules = value.length ? value : [];

  const addRule = () => onChange([...rules, { id: makeClientId(), models: [], params: [] }]);
  const removeRule = (ruleIndex: number) => onChange(rules.filter((_, i) => i !== ruleIndex));

  const updateRule = (ruleIndex: number, patch: Partial<PayloadFilterRule>) =>
    onChange(rules.map((rule, i) => (i === ruleIndex ? { ...rule, ...patch } : rule)));

  const addModel = (ruleIndex: number) => {
    const rule = rules[ruleIndex];
    const nextModel: PayloadModelEntry = { id: makeClientId(), name: '', protocol: undefined };
    updateRule(ruleIndex, { models: [...rule.models, nextModel] });
  };

  const removeModel = (ruleIndex: number, modelIndex: number) => {
    const rule = rules[ruleIndex];
    updateRule(ruleIndex, { models: rule.models.filter((_, i) => i !== modelIndex) });
  };

  const updateModel = (ruleIndex: number, modelIndex: number, patch: Partial<PayloadModelEntry>) => {
    const rule = rules[ruleIndex];
    updateRule(ruleIndex, {
      models: rule.models.map((m, i) => (i === modelIndex ? { ...m, ...patch } : m)),
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rules.map((rule, ruleIndex) => (
        <div
          key={rule.id}
          style={{
            border: '1px solid var(--border-color)',
            borderRadius: 12,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>规则 {ruleIndex + 1}</div>
            <Button variant="ghost" size="sm" onClick={() => removeRule(ruleIndex)} disabled={disabled}>
              删除
            </Button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>适用模型</div>
            {rule.models.map((model, modelIndex) => (
              <div key={model.id} style={{ display: 'grid', gridTemplateColumns: '1fr 160px auto', gap: 8 }}>
                <input
                  className="input"
                  placeholder="模型名称"
                  value={model.name}
                  onChange={(e) => updateModel(ruleIndex, modelIndex, { name: e.target.value })}
                  disabled={disabled}
                />
                <ToastSelect
                  value={model.protocol ?? ''}
                  options={VISUAL_CONFIG_PROTOCOL_OPTIONS}
                  disabled={disabled}
                  ariaLabel="供应商类型"
                  onChange={(nextValue) =>
                    updateModel(ruleIndex, modelIndex, {
                      protocol: (nextValue || undefined) as PayloadModelEntry['protocol'],
                    })
                  }
                />
                <Button variant="ghost" size="sm" onClick={() => removeModel(ruleIndex, modelIndex)} disabled={disabled}>
                  删除
                </Button>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="secondary" size="sm" onClick={() => addModel(ruleIndex)} disabled={disabled}>
                添加模型
              </Button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>移除参数</div>
            <StringListEditor
              value={rule.params}
              disabled={disabled}
              placeholder="JSON 路径 (gjson/sjson)，如 generationConfig.thinkingConfig.thinkingBudget"
              onChange={(params) => updateRule(ruleIndex, { params })}
            />
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="secondary" size="sm" onClick={addRule} disabled={disabled}>
          添加规则
        </Button>
      </div>
    </div>
  );
}

export function VisualConfigEditor({ values, disabled = false, onChange }: VisualConfigEditorProps) {
  const isKeepaliveDisabled = values.streaming.keepaliveSeconds === '' || values.streaming.keepaliveSeconds === '0';
  const isNonstreamKeepaliveDisabled =
    values.streaming.nonstreamKeepaliveInterval === '' || values.streaming.nonstreamKeepaliveInterval === '0';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ConfigSection title="服务器配置" description="基础服务器设置">
        <SectionGrid>
          <Input
            label="主机地址"
            placeholder="0.0.0.0"
            value={values.host}
            onChange={(e) => onChange({ host: e.target.value })}
            disabled={disabled}
          />
          <Input
            label="端口"
            type="number"
            placeholder="8317"
            value={values.port}
            onChange={(e) => onChange({ port: e.target.value })}
            disabled={disabled}
          />
        </SectionGrid>
      </ConfigSection>

      <ConfigSection title="TLS/SSL 配置" description="HTTPS 安全连接设置">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ToggleRow
            title="启用 TLS"
            description="启用 HTTPS 安全连接"
            checked={values.tlsEnable}
            disabled={disabled}
            onChange={(tlsEnable) => onChange({ tlsEnable })}
          />
          {values.tlsEnable && (
            <>
              <Divider />
              <SectionGrid>
                <Input
                  label="证书文件路径"
                  placeholder="/path/to/cert.pem"
                  value={values.tlsCert}
                  onChange={(e) => onChange({ tlsCert: e.target.value })}
                  disabled={disabled}
                />
                <Input
                  label="私钥文件路径"
                  placeholder="/path/to/key.pem"
                  value={values.tlsKey}
                  onChange={(e) => onChange({ tlsKey: e.target.value })}
                  disabled={disabled}
                />
              </SectionGrid>
            </>
          )}
        </div>
      </ConfigSection>

      <ConfigSection title="远程管理" description="远程访问和控制面板设置">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ToggleRow
            title="允许远程访问"
            description="允许从其他主机访问管理接口"
            checked={values.rmAllowRemote}
            disabled={disabled}
            onChange={(rmAllowRemote) => onChange({ rmAllowRemote })}
          />
          <ToggleRow
            title="禁用控制面板"
            description="禁用内置的 Web 控制面板"
            checked={values.rmDisableControlPanel}
            disabled={disabled}
            onChange={(rmDisableControlPanel) => onChange({ rmDisableControlPanel })}
          />
          <SectionGrid>
            <Input
              label="管理密钥"
              type="password"
              placeholder="设置管理密钥"
              value={values.rmSecretKey}
              onChange={(e) => onChange({ rmSecretKey: e.target.value })}
              disabled={disabled}
            />
            <Input
              label="面板仓库"
              placeholder="https://github.com/router-for-me/Cli-Proxy-API-Management-Center"
              value={values.rmPanelRepo}
              onChange={(e) => onChange({ rmPanelRepo: e.target.value })}
              disabled={disabled}
            />
          </SectionGrid>
        </div>
      </ConfigSection>

      <ConfigSection title="认证配置" description="API 密钥与认证文件目录设置">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Input
            label="认证文件目录 (auth-dir)"
            placeholder="~/.cli-proxy-api"
            value={values.authDir}
            onChange={(e) => onChange({ authDir: e.target.value })}
            disabled={disabled}
            hint="存放认证文件的目录路径（支持 ~）"
          />
          <ApiKeysCardEditor
            value={values.apiKeysText}
            disabled={disabled}
            onChange={(apiKeysText) => onChange({ apiKeysText })}
          />
        </div>
      </ConfigSection>

      <ConfigSection title="系统配置" description="调试、日志、统计与性能调试设置">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SectionGrid>
            <ToggleRow
              title="调试模式"
              description="启用详细的调试日志"
              checked={values.debug}
              disabled={disabled}
              onChange={(debug) => onChange({ debug })}
            />
            <ToggleRow
              title="商业模式"
              description="禁用高开销中间件以减少高并发内存"
              checked={values.commercialMode}
              disabled={disabled}
              onChange={(commercialMode) => onChange({ commercialMode })}
            />
            <ToggleRow
              title="写入日志文件"
              description="将日志保存到滚动文件"
              checked={values.loggingToFile}
              disabled={disabled}
              onChange={(loggingToFile) => onChange({ loggingToFile })}
            />
            <ToggleRow
              title="使用统计"
              description="收集使用统计信息"
              checked={values.usageStatisticsEnabled}
              disabled={disabled}
              onChange={(usageStatisticsEnabled) => onChange({ usageStatisticsEnabled })}
            />
          </SectionGrid>

          <SectionGrid>
            <Input
              label="日志文件大小限制 (MB)"
              type="number"
              placeholder="0"
              value={values.logsMaxTotalSizeMb}
              onChange={(e) => onChange({ logsMaxTotalSizeMb: e.target.value })}
              disabled={disabled}
            />
            <Input
              label="使用记录保留天数"
              type="number"
              placeholder="30"
              value={values.usageRecordsRetentionDays}
              onChange={(e) => onChange({ usageRecordsRetentionDays: e.target.value })}
              disabled={disabled}
              hint="0 为无限制（不清理）"
            />
          </SectionGrid>
        </div>
      </ConfigSection>

      <ConfigSection title="网络配置" description="代理、重试和路由设置">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SectionGrid>
            <Input
              label="代理 URL"
              placeholder="socks5://user:pass@127.0.0.1:1080/"
              value={values.proxyUrl}
              onChange={(e) => onChange({ proxyUrl: e.target.value })}
              disabled={disabled}
            />
            <Input
              label="请求重试次数"
              type="number"
              placeholder="3"
              value={values.requestRetry}
              onChange={(e) => onChange({ requestRetry: e.target.value })}
              disabled={disabled}
            />
            <Input
              label="最大重试间隔 (秒)"
              type="number"
              placeholder="30"
              value={values.maxRetryInterval}
              onChange={(e) => onChange({ maxRetryInterval: e.target.value })}
              disabled={disabled}
            />
            <div className="form-group">
              <label>路由策略</label>
              <ToastSelect
                value={values.routingStrategy}
                options={[
                  { value: 'round-robin', label: '轮询 (Round Robin)' },
                  { value: 'fill-first', label: '填充优先 (Fill First)' },
                ]}
                disabled={disabled}
                ariaLabel="路由策略"
                onChange={(nextValue) =>
                  onChange({ routingStrategy: nextValue as VisualConfigValues['routingStrategy'] })
                }
              />
              <div className="hint">选择凭据选择策略</div>
            </div>
          </SectionGrid>

          <ToggleRow
            title="强制模型前缀"
            description="未带前缀的模型请求只使用无前缀凭据"
            checked={values.forceModelPrefix}
            disabled={disabled}
            onChange={(forceModelPrefix) => onChange({ forceModelPrefix })}
          />
          <ToggleRow
            title="WebSocket 认证"
            description="启用 WebSocket 连接认证 (/v1/ws)"
            checked={values.wsAuth}
            disabled={disabled}
            onChange={(wsAuth) => onChange({ wsAuth })}
          />
        </div>
      </ConfigSection>

      <ConfigSection title="配额回退" description="配额耗尽时的回退策略">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ToggleRow
            title="切换项目"
            description="配额耗尽时自动切换到其他项目"
            checked={values.quotaSwitchProject}
            disabled={disabled}
            onChange={(quotaSwitchProject) => onChange({ quotaSwitchProject })}
          />
          <ToggleRow
            title="切换预览模型"
            description="配额耗尽时切换到预览版本模型"
            checked={values.quotaSwitchPreviewModel}
            disabled={disabled}
            onChange={(quotaSwitchPreviewModel) => onChange({ quotaSwitchPreviewModel })}
          />
        </div>
      </ConfigSection>

      <ConfigSection title="流式传输配置" description="Keepalive 与 bootstrap 重试设置">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SectionGrid>
            <div className="form-group">
              <label>Keepalive 秒数</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  type="number"
                  placeholder="0"
                  value={values.streaming.keepaliveSeconds}
                  onChange={(e) =>
                    onChange({ streaming: { ...values.streaming, keepaliveSeconds: e.target.value } })
                  }
                  disabled={disabled}
                />
                {isKeepaliveDisabled && (
                  <span
                    style={{
                      position: 'absolute',
                      right: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      background: 'var(--bg-secondary)',
                      padding: '2px 8px',
                      borderRadius: 999,
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    已禁用
                  </span>
                )}
              </div>
              <div className="hint">设置为 0 或留空表示禁用 keepalive</div>
            </div>
            <Input
              label="Bootstrap 重试次数"
              type="number"
              placeholder="1"
              value={values.streaming.bootstrapRetries}
              onChange={(e) => onChange({ streaming: { ...values.streaming, bootstrapRetries: e.target.value } })}
              disabled={disabled}
              hint="流式传输启动时（首包前）的重试次数"
            />
          </SectionGrid>

          <SectionGrid>
            <div className="form-group">
              <label>非流式 Keepalive 间隔 (秒)</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  type="number"
                  placeholder="0"
                  value={values.streaming.nonstreamKeepaliveInterval}
                  onChange={(e) =>
                    onChange({
                      streaming: { ...values.streaming, nonstreamKeepaliveInterval: e.target.value },
                    })
                  }
                  disabled={disabled}
                />
                {isNonstreamKeepaliveDisabled && (
                  <span
                    style={{
                      position: 'absolute',
                      right: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      background: 'var(--bg-secondary)',
                      padding: '2px 8px',
                      borderRadius: 999,
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    已禁用
                  </span>
                )}
              </div>
              <div className="hint">
                非流式响应时每隔 N 秒发送空行以防止空闲超时，设置为 0 或留空表示禁用
              </div>
            </div>
          </SectionGrid>
        </div>
      </ConfigSection>

      <ConfigSection title="Payload 配置" description="默认值、覆盖规则与过滤规则">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>默认规则</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              当请求中未指定参数时，使用这些默认值
            </div>
            <PayloadRulesEditor
              value={values.payloadDefaultRules}
              disabled={disabled}
              onChange={(payloadDefaultRules) => onChange({ payloadDefaultRules })}
            />
          </div>

          <div>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>覆盖规则</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              强制覆盖请求中的参数值
            </div>
            <PayloadRulesEditor
              value={values.payloadOverrideRules}
              disabled={disabled}
              protocolFirst
              onChange={(payloadOverrideRules) => onChange({ payloadOverrideRules })}
            />
          </div>

          <div>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>过滤规则</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              通过 JSON Path 预过滤上游请求体，自动剔除不合规/冗余参数（Request Sanitization）
            </div>
            <PayloadFilterRulesEditor
              value={values.payloadFilterRules}
              disabled={disabled}
              onChange={(payloadFilterRules) => onChange({ payloadFilterRules })}
            />
          </div>
        </div>
      </ConfigSection>
    </div>
  );
}
