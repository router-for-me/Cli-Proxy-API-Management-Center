import type { ReactNode } from 'react';
import { Switch } from './switch';
import { Label } from './label';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}

export function ToggleSwitch({ checked, onChange, label, disabled = false }: ToggleSwitchProps) {
  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
      />
      {label && <Label className="text-xs cursor-pointer">{label}</Label>}
    </div>
  );
}
