import type { ChangeEvent, ReactNode } from 'react';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  labelPosition?: 'left' | 'right';
  size?: 'md' | 'sm';
}

export function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled = false,
  labelPosition = 'right',
  size = 'md',
}: ToggleSwitchProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.checked);
  };

  const className = [
    'switch',
    size === 'sm' ? 'switch-sm' : '',
    labelPosition === 'left' ? 'switch-label-left' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <label className={className}>
      <input type="checkbox" checked={checked} onChange={handleChange} disabled={disabled} />
      <span className="track">
        <span className="thumb" />
      </span>
      {label && <span className="label">{label}</span>}
    </label>
  );
}
