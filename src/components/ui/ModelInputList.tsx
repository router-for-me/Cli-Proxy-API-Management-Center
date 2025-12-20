import { Button } from './Button';
import { Input } from './primitives/input';
import { IconPlus, IconX } from './icons';
import type { ModelAlias } from '@/types';

interface ModelEntry {
  name: string;
  alias: string;
}

interface ModelInputListProps {
  entries: ModelEntry[];
  onChange: (entries: ModelEntry[]) => void;
  addLabel: string;
  disabled?: boolean;
  namePlaceholder?: string;
  aliasPlaceholder?: string;
}

export const modelsToEntries = (models?: ModelAlias[]): ModelEntry[] => {
  if (!Array.isArray(models) || models.length === 0) {
    return [{ name: '', alias: '' }];
  }
  return models.map((m) => ({
    name: m.name || '',
    alias: m.alias || ''
  }));
};

export const entriesToModels = (entries: ModelEntry[]): ModelAlias[] => {
  return entries
    .filter((entry) => entry.name.trim())
    .map((entry) => {
      const model: ModelAlias = { name: entry.name.trim() };
      const alias = entry.alias.trim();
      if (alias && alias !== model.name) {
        model.alias = alias;
      }
      return model;
    });
};

export function ModelInputList({
  entries,
  onChange,
  addLabel,
  disabled = false,
  namePlaceholder = 'model-name',
  aliasPlaceholder = 'alias (optional)'
}: ModelInputListProps) {
  const currentEntries = entries.length ? entries : [{ name: '', alias: '' }];

  const updateEntry = (index: number, field: 'name' | 'alias', value: string) => {
    const next = currentEntries.map((entry, idx) => (idx === index ? { ...entry, [field]: value } : entry));
    onChange(next);
  };

  const addEntry = () => {
    onChange([...currentEntries, { name: '', alias: '' }]);
  };

  const removeEntry = (index: number) => {
    const next = currentEntries.filter((_, idx) => idx !== index);
    onChange(next.length ? next : [{ name: '', alias: '' }]);
  };

  return (
    <div className="flex flex-col gap-2">
      {currentEntries.map((entry, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Input
            placeholder={namePlaceholder}
            value={entry.name}
            onChange={(e) => updateEntry(index, 'name', e.target.value)}
            disabled={disabled}
            className="flex-1"
          />
          <Input
            placeholder={aliasPlaceholder}
            value={entry.alias}
            onChange={(e) => updateEntry(index, 'alias', e.target.value)}
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
