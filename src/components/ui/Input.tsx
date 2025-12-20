import type { InputHTMLAttributes, ReactNode } from 'react';
import { Input as InputPrimitive } from './primitives/input';
import { Label } from './label';
import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  rightElement?: ReactNode;
}

export function Input({ label, hint, error, rightElement, className = '', id, ...rest }: InputProps) {
  const inputId = id || (label ? `input-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);

  return (
    <div className="flex flex-col gap-1.5">
      {label && <Label htmlFor={inputId} className="text-xs font-medium">{label}</Label>}
      <div className="relative">
        <InputPrimitive
          id={inputId}
          className={cn(rightElement && 'pr-10', className)}
          aria-invalid={!!error}
          {...rest}
        />
        {rightElement && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            {rightElement}
          </div>
        )}
      </div>
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
