type GroupState = {
  hasInnerVariableQuantifier: boolean;
  hasAlternation: boolean;
  justOpened: boolean;
};

type Quantifier = {
  length: number;
  min: number;
  max: number | null; // null means unbounded
  variable: boolean; // can match multiple lengths for the repeated token
};

const OUTER_REPEAT_MAX_SAFE_UPPER_BOUND = 9;

const isDigit = (ch: string | undefined): ch is string => ch !== undefined && ch >= '0' && ch <= '9';

const readBraceQuantifier = (pattern: string, index: number): Quantifier | null => {
  if (pattern[index] !== '{') return null;

  let i = index + 1;
  let minStr = '';
  while (isDigit(pattern[i])) {
    minStr += pattern[i];
    i += 1;
  }

  if (minStr.length === 0) return null;
  const min = Number(minStr);

  let max: number | null = min;
  if (pattern[i] === ',') {
    i += 1;
    let maxStr = '';
    while (isDigit(pattern[i])) {
      maxStr += pattern[i];
      i += 1;
    }
    max = maxStr.length === 0 ? null : Number(maxStr);
  }

  if (pattern[i] !== '}') return null;

  const variable = max === null || max !== min;
  return { length: i - index + 1, min, max, variable };
};

const readQuantifier = (pattern: string, index: number): Quantifier | null => {
  const ch = pattern[index];
  if (ch === '*') return { length: 1, min: 0, max: null, variable: true };
  if (ch === '+') return { length: 1, min: 1, max: null, variable: true };
  if (ch === '?') return { length: 1, min: 0, max: 1, variable: true };
  if (ch !== '{') return null;
  return readBraceQuantifier(pattern, index);
};

/**
 * Heuristic safety check for user-supplied JS regex patterns.
 *
 * Goal: prevent patterns that are very likely to cause catastrophic backtracking
 * (e.g. `^(a+)+$`) from running on the main thread.
 *
 * Notes:
 * - This is intentionally conservative but tries to avoid blocking common safe patterns.
 * - We do not execute the regex here; only scan the pattern string.
 */
export function isLikelyUnsafeJsRegex(pattern: string): boolean {
  let inCharClass = false;
  const groupStack: GroupState[] = [
    { hasInnerVariableQuantifier: false, hasAlternation: false, justOpened: false },
  ];

  const markInnerVariableQuantifier = () => {
    for (let i = 0; i < groupStack.length; i += 1) {
      groupStack[i].hasInnerVariableQuantifier = true;
    }
  };

  const markAlternation = () => {
    for (let i = 0; i < groupStack.length; i += 1) {
      groupStack[i].hasAlternation = true;
    }
  };

  const isOuterRepeatRisky = (q: Quantifier): boolean => {
    // If it cannot repeat more than once, it's not a "repeat group" in the sense that
    // triggers catastrophic backtracking (e.g. `(a+)?`).
    const max = q.max ?? Number.POSITIVE_INFINITY;
    if (max <= 1) return false;

    // Unbounded repetition is the main hazard: `*`, `+`, `{m,}`.
    if (q.max === null) return true;

    // Large fixed/variable upper bounds also explode combinatorially with an inner variable quantifier.
    return q.max > OUTER_REPEAT_MAX_SAFE_UPPER_BOUND;
  };

  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];

    // Reset "justOpened" once we move past the first token inside the group.
    const top = groupStack[groupStack.length - 1];
    if (top.justOpened) {
      top.justOpened = false;
      // `(?...)` group prefixes use `?` immediately after `(` and are not quantifiers.
      if (ch === '?') continue;
    }

    if (ch === '\\') {
      const next = pattern[i + 1];
      // Backreferences often make backtracking far worse.
      if (next && next >= '1' && next <= '9') return true;
      // Named backreference: \k<name>
      if (next === 'k' && pattern[i + 2] === '<') return true;

      // Skip escaped character.
      i += 1;
      continue;
    }

    if (inCharClass) {
      if (ch === ']') inCharClass = false;
      continue;
    }

    if (ch === '[') {
      inCharClass = true;
      continue;
    }

    if (ch === '(') {
      groupStack.push({ hasInnerVariableQuantifier: false, hasAlternation: false, justOpened: true });
      continue;
    }

    if (ch === ')') {
      const group = groupStack.pop();
      if (!group) return true; // unbalanced, treat as unsafe

      const q = readQuantifier(pattern, i + 1);
      if (
        q &&
        isOuterRepeatRisky(q) &&
        (group.hasInnerVariableQuantifier || group.hasAlternation)
      ) {
        return true;
      }
      continue;
    }

    if (ch === '|') {
      // Alternation inside a repeated group is frequently a backtracking hotspot.
      markAlternation();
      continue;
    }

    const q = readQuantifier(pattern, i);
    if (q) {
      if (q.variable) markInnerVariableQuantifier();
      i += q.length - 1;
      continue;
    }
  }

  return false;
}
