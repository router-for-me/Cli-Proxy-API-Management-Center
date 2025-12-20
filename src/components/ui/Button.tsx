import type { PropsWithChildren } from 'react';
import { Button as ButtonPrimitive } from './primitives/button';
import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'md' | 'sm';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
}

const variantMap: Record<ButtonVariant, 'default' | 'secondary' | 'ghost' | 'destructive'> = {
  primary: 'default',
  secondary: 'secondary',
  ghost: 'ghost',
  danger: 'destructive',
};

const sizeMap: Record<ButtonSize, 'default' | 'sm'> = {
  md: 'default',
  sm: 'sm',
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  className = '',
  disabled,
  ...rest
}: PropsWithChildren<ButtonProps>) {
  return (
    <ButtonPrimitive
      variant={variantMap[variant]}
      size={sizeMap[size]}
      disabled={disabled || loading}
      className={cn(fullWidth && 'w-full', className)}
      {...rest}
    >
      {loading && (
        <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </ButtonPrimitive>
  );
}
