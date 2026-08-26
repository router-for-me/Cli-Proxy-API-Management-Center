const getRuleKey = (value: string): string => value.trim().toLowerCase();

export function normalizeOAuthExcludedRules(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const rules: string[] = [];

  for (const value of values) {
    const rule = value.trim();
    const key = getRuleKey(rule);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rules.push(rule);
  }

  return rules;
}

export function getEffectiveOAuthExcludedRules(
  selectedRules: Iterable<string>,
  customRule: string
): string[] {
  return normalizeOAuthExcludedRules([...selectedRules, customRule]);
}

export function hasOAuthExcludedRule(values: Iterable<string>, candidate: string): boolean {
  const candidateKey = getRuleKey(candidate);
  if (!candidateKey) return false;
  return Array.from(values).some((value) => getRuleKey(value) === candidateKey);
}

export function updateOAuthExcludedRule(
  values: Iterable<string>,
  candidate: string,
  selected: boolean
): string[] {
  const candidateRule = candidate.trim();
  const candidateKey = getRuleKey(candidateRule);
  const rules = normalizeOAuthExcludedRules(values).filter(
    (value) => getRuleKey(value) !== candidateKey
  );

  if (selected && candidateKey) rules.push(candidateRule);
  return rules;
}

export function getCustomOAuthExcludedRules(
  selectedRules: Iterable<string>,
  catalogRules: Iterable<string>
): string[] {
  const catalogKeys = new Set(
    normalizeOAuthExcludedRules(catalogRules).map((value) => getRuleKey(value))
  );
  return normalizeOAuthExcludedRules(selectedRules).filter(
    (value) => !catalogKeys.has(getRuleKey(value))
  );
}
