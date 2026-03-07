import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { IconChevronDown } from './icons';
import styles from './Select.module.scss';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: ReadonlyArray<SelectOption>;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  fullWidth?: boolean;
  id?: string;
}

export function Select({
  value,
  options,
  onChange,
  placeholder,
  className,
  disabled = false,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  fullWidth = true,
  id,
}: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const listboxId = `${selectId}-listbox`;
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || disabled) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [disabled, open]);

  const isOpen = open && !disabled;
  const selectedIndex = useMemo(() => options.findIndex((option) => option.value === value), [options, value]);
  const resolvedHighlightedIndex =
    highlightedIndex >= 0 ? highlightedIndex : selectedIndex >= 0 ? selectedIndex : options.length > 0 ? 0 : -1;
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const displayText = selected?.label ?? placeholder ?? '';
  const isPlaceholder = !selected && placeholder;

  const commitSelection = useCallback(
    (nextIndex: number) => {
      const nextOption = options[nextIndex];
      if (!nextOption) return;
      onChange(nextOption.value);
      setOpen(false);
      setHighlightedIndex(nextIndex);
    },
    [onChange, options]
  );

  const moveHighlight = useCallback(
    (direction: 1 | -1) => {
      if (options.length === 0) return;
      const nextIndex = (resolvedHighlightedIndex + direction + options.length) % options.length;
      setHighlightedIndex(nextIndex);
    },
    [options.length, resolvedHighlightedIndex]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          if (!isOpen) {
            setOpen(true);
            return;
          }
          moveHighlight(1);
          return;
        case 'ArrowUp':
          event.preventDefault();
          if (!isOpen) {
            setOpen(true);
            return;
          }
          moveHighlight(-1);
          return;
        case 'Home':
          if (!isOpen || options.length === 0) return;
          event.preventDefault();
          setHighlightedIndex(0);
          return;
        case 'End':
          if (!isOpen || options.length === 0) return;
          event.preventDefault();
          setHighlightedIndex(options.length - 1);
          return;
        case 'Enter':
        case ' ': {
          event.preventDefault();
          if (!isOpen) {
            setOpen(true);
            return;
          }
          if (resolvedHighlightedIndex >= 0) {
            commitSelection(resolvedHighlightedIndex);
          }
          return;
        }
        case 'Escape':
          if (!isOpen) return;
          event.preventDefault();
          setOpen(false);
          return;
        case 'Tab':
          if (isOpen) setOpen(false);
          return;
        default:
          return;
      }
    },
    [commitSelection, disabled, isOpen, moveHighlight, options.length, resolvedHighlightedIndex]
  );

  return (
    <div
      className={`${styles.wrap} ${fullWidth ? styles.wrapFullWidth : ''} ${className ?? ''}`}
      ref={wrapRef}
    >
      <button
        id={selectId}
        type="button"
        className={styles.trigger}
        onClick={disabled ? undefined : () => setOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={
          isOpen && resolvedHighlightedIndex >= 0
            ? `${selectId}-option-${resolvedHighlightedIndex}`
            : undefined
        }
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
      >
        <span className={`${styles.triggerText} ${isPlaceholder ? styles.placeholder : ''}`}>
          {displayText}
        </span>
        <span className={styles.triggerIcon} aria-hidden="true">
          <IconChevronDown size={14} />
        </span>
      </button>
      {isOpen && (
        <div className={styles.dropdown} id={listboxId} role="listbox" aria-label={ariaLabel}>
          {options.map((opt, index) => {
            const active = opt.value === value;
            const highlighted = index === resolvedHighlightedIndex;
            return (
              <button
                key={opt.value}
                id={`${selectId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={active}
                className={`${styles.option} ${active ? styles.optionActive : ''} ${highlighted ? styles.optionHighlighted : ''}`.trim()}
                onMouseEnter={() => setHighlightedIndex(index)}
                onKeyDown={handleKeyDown}
                onClick={() => commitSelection(index)}
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
