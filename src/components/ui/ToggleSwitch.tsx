import type { ChangeEvent, ReactNode } from 'react';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}

export function ToggleSwitch({ checked, onChange, label, disabled = false }: ToggleSwitchProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.checked);
  };

  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={handleChange} disabled={disabled} />
      <span className="track">
        <span className="thumb" />
      </span>
      {label && <span className="label">{label}</span>}
    </label>
  );
}
