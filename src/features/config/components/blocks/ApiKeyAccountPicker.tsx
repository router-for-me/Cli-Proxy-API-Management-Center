import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import type { PolicyAccount } from './usePolicyAccounts';
import styles from './Blocks.module.scss';

interface ApiKeyAccountPickerProps {
  accounts: PolicyAccount[];
  loading: boolean;
  error: string;
  selected: string[];
  disabled?: boolean;
  onChange: (next: string[]) => void;
}

export function ApiKeyAccountPicker({
  accounts,
  loading,
  error,
  selected,
  disabled,
  onChange,
}: ApiKeyAccountPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return accounts;
    return accounts.filter(
      (account) =>
        account.label.toLowerCase().includes(needle) ||
        account.provider.includes(needle) ||
        account.authIndex.toLowerCase().includes(needle)
    );
  }, [accounts, query]);
  const groups = useMemo(() => {
    const map = new Map<string, PolicyAccount[]>();
    for (const account of visible) {
      const list = map.get(account.provider) ?? [];
      list.push(account);
      map.set(account.provider, list);
    }
    return Array.from(map.entries());
  }, [visible]);
  const knownIndexes = useMemo(() => new Set(accounts.map((a) => a.authIndex)), [accounts]);
  const missing = selected.filter((index) => !knownIndexes.has(index));

  const toggle = (authIndex: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(authIndex);
    else next.delete(authIndex);
    onChange(Array.from(next));
  };
  const selectVisible = () => {
    const next = new Set(selected);
    visible.forEach((account) => next.add(account.authIndex));
    onChange(Array.from(next));
  };

  const prefix = 'config_management.visual.api_keys.policy';
  return (
    <div className={styles.policyAccounts}>
      <div className={styles.policyAccountsToolbar}>
        <input
          className="input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t(`${prefix}.search_placeholder`)}
          aria-label={t(`${prefix}.search_placeholder`)}
          disabled={disabled}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={selectVisible}
          disabled={disabled || visible.length === 0}
        >
          {t(`${prefix}.select_all`)}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange([])}
          disabled={disabled || selected.length === 0}
        >
          {t(`${prefix}.clear`)}
        </Button>
      </div>
      <div className="hint">
        {selected.length === 0
          ? t(`${prefix}.all_accounts_hint`)
          : t(`${prefix}.selected_count`, { count: selected.length })}
      </div>
      {loading && <div className="hint">{t(`${prefix}.loading`)}</div>}
      {error && <div className="error-box">{t(`${prefix}.load_error`, { message: error })}</div>}
      {!loading && !error && accounts.length === 0 && (
        <div className="hint">{t(`${prefix}.no_accounts`)}</div>
      )}
      <div className={styles.policyAccountList}>
        {groups.map(([provider, list]) => (
          <div key={provider} className={styles.policyAccountGroup}>
            <div className={styles.policyAccountGroupTitle}>{provider}</div>
            {list.map((account) => (
              <div key={account.authIndex} className={styles.policyAccountRow}>
                <SelectionCheckbox
                  checked={selectedSet.has(account.authIndex)}
                  onChange={(checked) => toggle(account.authIndex, checked)}
                  disabled={disabled}
                  label={account.label}
                  title={account.authIndex}
                />
                <span
                  className={`${styles.policyBadge} ${styles[`policyState_${account.state}`] ?? ''}`}
                >
                  {t(`${prefix}.state_${account.state}`)}
                </span>
              </div>
            ))}
          </div>
        ))}
        {missing.map((authIndex) => (
          <div key={authIndex} className={styles.policyAccountRow}>
            <SelectionCheckbox
              checked
              onChange={(checked) => toggle(authIndex, checked)}
              disabled={disabled}
              label={authIndex}
            />
            <span className={`${styles.policyBadge} ${styles.policyState_disabled}`}>
              {t(`${prefix}.state_missing`)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
