import { Button } from './Button';
import { Input } from './primitives/input';
import { IconPlus, IconX } from './icons';
import type { HeaderEntry } from '@/utils/headers';

interface HeaderInputListProps {
  entries: HeaderEntry[];
  onChange: (entries: HeaderEntry[]) => void;
  addLabel: string;
  disabled?: boolean;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

export function HeaderInputList({
  entries,
  onChange,
  addLabel,
  disabled = false,
  keyPlaceholder = 'X-Custom-Header',
  valuePlaceholder = 'value'
}: HeaderInputListProps) {
  const currentEntries = entries.length ? entries : [{ key: '', value: '' }];

  const updateEntry = (index: number, field: 'key' | 'value', value: string) => {
    const next = currentEntries.map((entry, idx) => (idx === index ? { ...entry, [field]: value } : entry));
    onChange(next);
  };

  const addEntry = () => {
    onChange([...currentEntries, { key: '', value: '' }]);
  };

  const removeEntry = (index: number) => {
    const next = currentEntries.filter((_, idx) => idx !== index);
    onChange(next.length ? next : [{ key: '', value: '' }]);
  };

  return (
    <div className="flex flex-col gap-2">
      {currentEntries.map((entry, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Input
            placeholder={keyPlaceholder}
            value={entry.key}
            onChange={(e) => updateEntry(index, 'key', e.target.value)}
            disabled={disabled}
            className="flex-1"
          />
          <Input
            placeholder={valuePlaceholder}
            value={entry.value}
            onChange={(e) => updateEntry(index, 'value', e.target.value)}
            disabled={disabled}
            className="flex-1"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => removeEntry(index)}
            disabled={disabled || currentEntries.length <= 1}
            title="Remove"
            aria-label="Remove"
            className="shrink-0 size-8 p-0"
          >
            <IconX size={14} />
          </Button>
        </div>
      ))}
      <button 
        type="button"
        onClick={addEntry} 
        disabled={disabled} 
        className="self-start flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
      >
        <IconPlus size={12} />
        <span className="underline underline-offset-2">{addLabel}</span>
      </button>
    </div>
  );
}
