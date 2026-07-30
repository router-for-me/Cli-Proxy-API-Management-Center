export const parseExcludedModelRules = (text: string): string[] => {
  const seen = new Set<string>();
  const rules: string[] = [];
  text.split(/\r?\n/).forEach((raw) => {
    const rule = raw.trim();
    const key = rule.toLowerCase();
    if (!rule || seen.has(key)) return;
    seen.add(key);
    rules.push(rule);
  });
  return rules;
};

export const matchesExcludedModelRule = (rule: string, modelId: string): boolean => {
  const normalizedRule = rule.trim().toLowerCase();
  const normalizedModel = modelId.trim().toLowerCase();
  if (!normalizedRule || !normalizedModel) return false;
  if (!normalizedRule.includes('*')) return normalizedRule === normalizedModel;

  const escaped = normalizedRule
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`, 'i').test(normalizedModel);
};

export const isModelExcludedByWildcard = (rules: readonly string[], modelId: string): boolean =>
  rules.some((rule) => rule.includes('*') && matchesExcludedModelRule(rule, modelId));

export const splitExcludedModelRules = (
  rules: readonly string[],
  candidateIds: readonly string[]
): { selectedIds: string[]; customRules: string[] } => {
  const candidateByKey = new Map(candidateIds.map((id) => [id.trim().toLowerCase(), id]));
  const selectedIds: string[] = [];
  const customRules: string[] = [];

  rules.forEach((rule) => {
    const candidate = !rule.includes('*') ? candidateByKey.get(rule.toLowerCase()) : undefined;
    if (candidate) selectedIds.push(candidate);
    else customRules.push(rule);
  });

  return { selectedIds, customRules };
};

export const toggleExcludedModel = (
  rules: readonly string[],
  modelId: string,
  excluded: boolean
): string[] => {
  const key = modelId.trim().toLowerCase();
  const next = rules.filter((rule) => rule.includes('*') || rule.toLowerCase() !== key);
  if (excluded && key) next.push(modelId.trim());
  return parseExcludedModelRules(next.join('\n'));
};

export const replaceCustomExcludedModelRules = (
  rules: readonly string[],
  candidateIds: readonly string[],
  customText: string
): string[] => {
  const { selectedIds } = splitExcludedModelRules(rules, candidateIds);
  return parseExcludedModelRules(
    [...selectedIds, ...parseExcludedModelRules(customText)].join('\n')
  );
};
