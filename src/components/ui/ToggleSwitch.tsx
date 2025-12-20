import type { ReactNode } from 'react';
import { Switch } from './switch';
import { Label } from './label';
import { Tooltip } from './Tooltip';
import { IconInfo } from './icons';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  tooltip?: string;
  disabled?: boolean;
}

export function ToggleSwitch({ checked, onChange, label, tooltip, disabled = false }: ToggleSwitchProps) {
  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
      />
      {label && <Label className="text-xs cursor-pointer">{label}</Label>}
      {tooltip && (
        <Tooltip content={tooltip}>
          <span className="text-muted-foreground hover:text-foreground cursor-help">
            <IconInfo size={12} />
          </span>
        </Tooltip>
      )}
    </div>
  );
}
