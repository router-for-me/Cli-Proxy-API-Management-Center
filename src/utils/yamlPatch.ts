type YamlPatch =
  | {
      path: string[];
      type: 'string' | 'number' | 'boolean' | 'enum';
      value: string | number | boolean;
    }
  | {
      path: string[];
      type: 'stringArray';
      value: string[];
    }
  | {
      path: string[];
      type: 'objectArray';
      value: Array<Record<string, unknown>>;
      itemKeyOrder?: string[];
    }
  | {
      path: string[];
      type: 'delete';
    };

type YamlTemplatePatch = {
  rootKey: string;
  snippet: string;
  startMarker?: string;
  endMarker?: string;
};

const DEFAULT_INDENT_STEP = 2;

const isBlank = (line: string | undefined) => !line || !line.trim();
const isComment = (line: string | undefined) => {
  const trimmed = (line || '').trim();
  return trimmed.startsWith('#');
};
const isBlankOrComment = (line: string | undefined) => isBlank(line) || isComment(line);
const isSignificant = (line: string | undefined) => !!line && !isBlankOrComment(line);

const countIndent = (line: string | undefined) => {
  if (!line) return 0;
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === ' ') count++;
    else break;
  }
  return count;
};

const detectNewline = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');

const splitInlineComment = (line: string) => {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inDouble && ch === '\\' && !escaped) {
      escaped = true;
      continue;
    }
    if (!inSingle && ch === '"' && !escaped) {
      inDouble = !inDouble;
    } else if (!inDouble && ch === "'") {
      inSingle = !inSingle;
    } else if (!inSingle && !inDouble && ch === '#') {
      return { content: line.slice(0, i), comment: line.slice(i) };
    }
    escaped = false;
  }
  return { content: line, comment: '' };
};

const findNextSignificant = (lines: string[], startIndex: number) => {
  for (let i = startIndex; i < lines.length; i++) {
    if (isSignificant(lines[i])) return i;
  }
  return -1;
};

const findKeyLineInRange = (
  lines: string[],
  key: string,
  startIndex: number,
  endIndex: number,
  indent: number
) => {
  for (let i = startIndex; i <= endIndex && i < lines.length; i++) {
    const line = lines[i];
    if (!isSignificant(line)) continue;
    if (countIndent(line) !== indent) continue;
    const trimmed = line.slice(indent);
    if (!trimmed.startsWith(key)) continue;
    const afterKey = trimmed.slice(key.length);
    if (!/^\s*:/.test(afterKey)) continue;
    return i;
  }
  return -1;
};

const getKeyBlockEnd = (lines: string[], keyLineIndex: number) => {
  const indent = countIndent(lines[keyLineIndex] || '');
  const childStart = findNextSignificant(lines, keyLineIndex + 1);
  if (childStart === -1) return keyLineIndex;
  if (countIndent(lines[childStart]) <= indent) return keyLineIndex;

  for (let i = childStart + 1; i < lines.length; i++) {
    if (!isSignificant(lines[i])) continue;
    if (countIndent(lines[i]) <= indent) {
      let end = i - 1;
      while (
        end > keyLineIndex &&
        isBlankOrComment(lines[end]) &&
        countIndent(lines[end]) <= indent
      ) {
        end--;
      }
      return Math.max(end, keyLineIndex);
    }
  }

  let end = lines.length - 1;
  while (end > keyLineIndex && isBlankOrComment(lines[end]) && countIndent(lines[end]) <= indent) {
    end--;
  }
  return Math.max(end, keyLineIndex);
};

const formatYamlString = (value: unknown) =>
  JSON.stringify(value === undefined || value === null ? '' : String(value));

const formatYamlScalar = (value: unknown, type: 'string' | 'number' | 'boolean' | 'enum') => {
  switch (type) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number': {
      const num = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(num) ? String(num) : '0';
    }
    case 'string':
    case 'enum':
    default:
      return formatYamlString(value);
  }
};

const buildYamlLinesForValue = (
  key: string,
  indent: number,
  patch: YamlPatch,
  indentStep: number
): string[] => {
  const prefix = ' '.repeat(indent) + key + ':';
  if (patch.type === 'delete') {
    return [];
  }
  if (patch.type === 'stringArray') {
    const list = Array.isArray(patch.value) ? patch.value : [];
    if (!list.length) {
      return [`${prefix} []`];
    }
    const childIndent = ' '.repeat(indent + indentStep);
    return [prefix, ...list.map((item) => `${childIndent}- ${formatYamlString(item)}`)];
  }

  if (patch.type === 'objectArray') {
    const list = Array.isArray(patch.value) ? patch.value : [];
    if (!list.length) {
      return [`${prefix} []`];
    }
    const itemIndent = ' '.repeat(indent + indentStep);
    const childIndent = ' '.repeat(indent + indentStep + indentStep);
    const orderedKeys = Array.isArray(patch.itemKeyOrder) ? patch.itemKeyOrder : [];

    const lines: string[] = [prefix];
    list.forEach((rawItem) => {
      const item =
        rawItem && typeof rawItem === 'object' ? (rawItem as Record<string, unknown>) : {};
      const keys = [
        ...orderedKeys.filter((k) => Object.prototype.hasOwnProperty.call(item, k)),
        ...Object.keys(item).filter((k) => !orderedKeys.includes(k)),
      ];

      const normalizedKeys = keys
        .map((k) => String(k || '').trim())
        .filter(Boolean)
        .filter((k, idx, arr) => arr.indexOf(k) === idx);

      const pairs = normalizedKeys
        .map((k) => [k, item[k]] as const)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => ({ key: k, value: v }));

      if (!pairs.length) return;

      const first = pairs[0];
      lines.push(
        `${itemIndent}- ${first.key}: ${formatYamlScalar(first.value, typeof first.value === 'boolean' ? 'boolean' : typeof first.value === 'number' ? 'number' : 'string')}`
      );
      for (let i = 1; i < pairs.length; i++) {
        const p = pairs[i];
        const scalarType =
          typeof p.value === 'boolean'
            ? 'boolean'
            : typeof p.value === 'number'
              ? 'number'
              : 'string';
        lines.push(`${childIndent}${p.key}: ${formatYamlScalar(p.value, scalarType)}`);
      }
    });

    return lines.length === 1 ? [`${prefix} []`] : lines;
  }

  const scalarPatch = patch as Extract<YamlPatch, { type: 'string' | 'number' | 'boolean' | 'enum' }>;
  return [`${prefix} ${formatYamlScalar(scalarPatch.value, scalarPatch.type)}`];
};

const updateScalarLinePreserveComment = (
  line: string,
  indent: number,
  key: string,
  valueText: string
) => {
  const { comment } = splitInlineComment(line || '');
  const base = `${' '.repeat(indent)}${key}: ${valueText}`;
  if (!comment) return base;
  return `${base} ${comment.trimStart()}`.trimEnd();
};

const findBlockRangeForParent = (lines: string[], parentStartIndex: number) => {
  if (parentStartIndex === -1) {
    return { start: 0, end: Math.max(lines.length - 1, 0) };
  }
  const end = getKeyBlockEnd(lines, parentStartIndex);
  return { start: parentStartIndex + 1, end };
};

const findInsertIndexForMissingKey = (
  lines: string[],
  parentStartIndex: number,
  parentIndent: number,
  key: string,
  parentPathKey: string,
  keyOrderMap: Record<string, string[]>,
  indentStep: number
) => {
  const orderKeys = keyOrderMap[parentPathKey] || [];

  const { start, end } = findBlockRangeForParent(lines, parentStartIndex);
  const childIndent = parentStartIndex === -1 ? 0 : parentIndent + indentStep;

  const firstSignificant = findNextSignificant(lines, start);
  const blockStart = firstSignificant === -1 ? start : firstSignificant;

  const keyIndexInOrder = orderKeys.indexOf(key);
  if (keyIndexInOrder === -1) {
    if (parentStartIndex === -1) {
      const last = (() => {
        for (let i = lines.length - 1; i >= 0; i--) {
          if (isSignificant(lines[i])) return i;
        }
        return -1;
      })();
      return last === -1 ? lines.length : last + 1;
    }
    return end + 1;
  }

  if (keyIndexInOrder > 0) {
    for (let i = keyIndexInOrder - 1; i >= 0; i--) {
      const prevKey = orderKeys[i];
      const found = findKeyLineInRange(lines, prevKey, start, end, childIndent);
      if (found !== -1) {
        const prevEnd = getKeyBlockEnd(lines, found);
        return prevEnd + 1;
      }
    }
  }

  if (parentStartIndex === -1) {
    const docFirst = findNextSignificant(lines, 0);
    return docFirst === -1 ? lines.length : docFirst;
  }

  return blockStart;
};

const upsertYamlAtPath = (
  lines: string[],
  path: string[],
  patch: YamlPatch,
  keyOrderMap: Record<string, string[]>,
  indentStep: number
) => {
  let parentStartIndex = -1;
  let parentIndent = -indentStep;
  let parentPathKey = '';

  for (let depth = 0; depth < path.length; depth++) {
    const key = path[depth];
    const isLeaf = depth === path.length - 1;

    const currentIndent = parentStartIndex === -1 ? 0 : parentIndent + indentStep;
    const { start, end } = findBlockRangeForParent(lines, parentStartIndex);

    const found = findKeyLineInRange(lines, key, start, end, currentIndent);

    if (found === -1) {
      if (isLeaf && patch.type === 'delete') return;
      const insertIndex = findInsertIndexForMissingKey(
        lines,
        parentStartIndex,
        parentIndent,
        key,
        parentPathKey,
        keyOrderMap,
        indentStep
      );

      if (isLeaf) {
        const insertLines = buildYamlLinesForValue(key, currentIndent, patch, indentStep);
        lines.splice(insertIndex, 0, ...insertLines);
        return;
      }

      const insertLine = `${' '.repeat(currentIndent)}${key}:`;
      lines.splice(insertIndex, 0, insertLine);
      parentStartIndex = insertIndex;
      parentIndent = currentIndent;
      parentPathKey = parentPathKey ? `${parentPathKey}.${key}` : key;
      continue;
    }

    if (isLeaf) {
      const blockEnd = getKeyBlockEnd(lines, found);

      if (patch.type === 'delete') {
        lines.splice(found, blockEnd - found + 1);
        return;
      }

      if (patch.type === 'stringArray' || patch.type === 'objectArray') {
        const newLines = buildYamlLinesForValue(key, currentIndent, patch, indentStep);
        lines.splice(found, blockEnd - found + 1, ...newLines);
        return;
      }

      const newScalar = formatYamlScalar(patch.value, patch.type);
      const updatedLine = updateScalarLinePreserveComment(
        lines[found],
        currentIndent,
        key,
        newScalar
      );
      lines.splice(found, blockEnd - found + 1, updatedLine);
      return;
    }

    parentStartIndex = found;
    parentIndent = currentIndent;
    parentPathKey = parentPathKey ? `${parentPathKey}.${key}` : key;
  }
};

export function applyYamlPatches(
  yamlText: string,
  patches: YamlPatch[],
  options: { indentStep?: number; keyOrderMap?: Record<string, string[]> } = {}
) {
  const indentStep = options.indentStep ?? DEFAULT_INDENT_STEP;
  const keyOrderMap = options.keyOrderMap ?? {};
  const newline = detectNewline(yamlText);
  const hadTrailingNewline = !!yamlText && (yamlText.endsWith('\n') || yamlText.endsWith('\r\n'));
  const lines = (yamlText || '').split(/\r?\n/);

  (patches || []).forEach((patch) => {
    if (!patch || !Array.isArray(patch.path) || patch.path.length === 0) return;
    upsertYamlAtPath(lines, patch.path, patch, keyOrderMap, indentStep);
  });

  const joined = lines.join(newline);
  return hadTrailingNewline && !joined.endsWith(newline) ? joined + newline : joined;
}

const trimEmptyEdges = (lines: string[]) => {
  let start = 0;
  let end = lines.length - 1;
  while (start <= end && isBlank(lines[start])) start++;
  while (end >= start && isBlank(lines[end])) end--;
  return lines.slice(start, end + 1);
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const dedentLines = (lines: string[]) => {
  let minIndent = Infinity;
  lines.forEach((line) => {
    if (isBlank(line)) return;
    minIndent = Math.min(minIndent, countIndent(line));
  });
  if (!Number.isFinite(minIndent) || minIndent <= 0) return lines;
  return lines.map((line) => (isBlank(line) ? line : line.slice(minIndent)));
};

const normalizeTemplateSnippetLines = (
  snippet: string,
  rootKey: string,
  { indentStep = DEFAULT_INDENT_STEP } = {}
) => {
  const rawLines = String(snippet || '').split(/\r?\n/);
  const uncommented = rawLines.map((line) => line.replace(/^(\s*)#\s?/, '$1'));
  const trimmed = dedentLines(trimEmptyEdges(uncommented));
  if (!trimmed.length) return [];

  const firstNonBlankIndex = trimmed.findIndex((line) => !isBlank(line));
  const firstLine = firstNonBlankIndex === -1 ? '' : trimmed[firstNonBlankIndex];
  const rootRe = new RegExp(`^\\s*${escapeRegExp(rootKey)}\\s*:\\s*$`);
  const hasRoot = rootRe.test(firstLine);
  if (hasRoot) {
    return trimmed;
  }

  const indented = trimmed.map((line) =>
    isBlank(line) ? line : `${' '.repeat(indentStep)}${line}`
  );
  return [`${rootKey}:`, ...indented];
};

export function normalizeYamlSnippetToRoot(
  snippet: string,
  rootKey: string,
  { indentStep = DEFAULT_INDENT_STEP } = {}
) {
  const newline = detectNewline(snippet || '');
  const lines = String(snippet || '').split(/\r?\n/);
  const uncommented = lines.map((line) => line.replace(/^(\s*)#\s?/, '$1'));
  const trimmed = dedentLines(trimEmptyEdges(uncommented));
  if (!trimmed.length) return '';

  const firstNonBlankIndex = trimmed.findIndex((line) => !isBlank(line));
  const firstLine = firstNonBlankIndex === -1 ? '' : trimmed[firstNonBlankIndex];
  const rootRe = new RegExp(`^\\s*${escapeRegExp(rootKey)}\\s*:\\s*$`);
  if (rootRe.test(firstLine)) {
    return trimmed.join(newline).trimEnd();
  }

  const indented = trimmed.map((line) =>
    isBlank(line) ? line : `${' '.repeat(indentStep)}${line}`
  );
  return [`${rootKey}:`, ...indented].join(newline).trimEnd();
}

export function extractYamlTopLevelBlock(yamlText: string, key: string) {
  const newline = detectNewline(yamlText || '');
  const lines = (yamlText || '').split(/\r?\n/);
  const found = findKeyLineInRange(lines, key, 0, lines.length - 1, 0);
  if (found === -1) return '';
  const end = getKeyBlockEnd(lines, found);
  return lines
    .slice(found, end + 1)
    .join(newline)
    .trimEnd();
}

export function extractYamlCommentSection(
  yamlText: string,
  startMarker: string,
  endMarker?: string,
  { includeMarkers = false } = {}
) {
  const newline = detectNewline(yamlText || '');
  const lines = (yamlText || '').split(/\r?\n/);

  const startIndex = lines.findIndex((line) => (line || '').trim() === startMarker.trim());
  if (startIndex === -1) return '';

  let endIndex = lines.length;
  if (endMarker) {
    const foundEnd = lines.findIndex(
      (line, idx) => idx > startIndex && (line || '').trim() === endMarker.trim()
    );
    if (foundEnd !== -1) {
      endIndex = foundEnd;
    }
  }

  const sliceStart = includeMarkers ? startIndex : startIndex + 1;
  const sliceEnd = includeMarkers ? endIndex : endIndex;
  const section = lines.slice(sliceStart, sliceEnd);
  const uncommented = section.map((line) => line.replace(/^(\s*)#\s?/, '$1'));
  const trimmed = trimEmptyEdges(uncommented);
  return trimmed.join(newline).trimEnd();
}

const replaceYamlTopLevelBlockInPlace = (lines: string[], key: string, newBlockLines: string[]) => {
  const found = findKeyLineInRange(lines, key, 0, lines.length - 1, 0);
  if (found === -1) return false;
  const end = getKeyBlockEnd(lines, found);
  lines.splice(found, end - found + 1, ...newBlockLines);
  return true;
};

const replaceCommentSectionByMarkersInPlace = (
  lines: string[],
  startMarker: string,
  endMarker: string | undefined,
  replacementLines: string[]
) => {
  const startIndex = lines.findIndex((line) => (line || '').trim() === startMarker.trim());
  if (startIndex === -1) return false;

  let endIndex = lines.length;
  if (endMarker) {
    const foundEnd = lines.findIndex(
      (line, idx) => idx > startIndex && (line || '').trim() === endMarker.trim()
    );
    if (foundEnd !== -1) {
      endIndex = foundEnd;
    }
  }

  const finalLines = [...replacementLines];
  if (finalLines.length && !isBlank(finalLines[finalLines.length - 1])) {
    finalLines.push('');
  }

  lines.splice(startIndex, endIndex - startIndex, ...finalLines);
  return true;
};

export function applyYamlTemplatePatches(
  yamlText: string,
  patches: YamlTemplatePatch[],
  { indentStep = DEFAULT_INDENT_STEP } = {}
) {
  const newline = detectNewline(yamlText);
  const hadTrailingNewline = !!yamlText && (yamlText.endsWith('\n') || yamlText.endsWith('\r\n'));
  const lines = (yamlText || '').split(/\r?\n/);

  (patches || []).forEach((patch) => {
    const rootKey = patch?.rootKey;
    const snippet = patch?.snippet;
    if (!rootKey || !snippet || !String(snippet).trim()) return;

    const newBlockLines = normalizeTemplateSnippetLines(snippet, rootKey, { indentStep });
    if (!newBlockLines.length) return;

    const replacedKey = replaceYamlTopLevelBlockInPlace(lines, rootKey, newBlockLines);
    if (replacedKey) return;

    const startMarker = patch?.startMarker;
    const endMarker = patch?.endMarker;
    if (startMarker) {
      const replacedCommentBlock = replaceCommentSectionByMarkersInPlace(
        lines,
        startMarker,
        endMarker,
        [startMarker.trim(), ...newBlockLines]
      );
      if (replacedCommentBlock) return;
    }

    const appendLines: string[] = [];
    if (startMarker) appendLines.push(startMarker.trim());
    appendLines.push(...newBlockLines, '');

    if (lines.length && !isBlank(lines[lines.length - 1])) {
      lines.push('');
    }
    lines.push(...appendLines);
  });

  const joined = lines.join(newline);
  return hadTrailingNewline && !joined.endsWith(newline) ? joined + newline : joined;
}

const parseYamlScalarValue = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  const num = Number(trimmed);
  if (Number.isFinite(num) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
    return num;
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }

  return trimmed;
};

export function getYamlScalarAtPath(yamlText: string, path: string[]): unknown {
  if (!path.length) return undefined;
  const lines = (yamlText || '').split(/\r?\n/);
  let parentStartIndex = -1;
  let parentIndent = -DEFAULT_INDENT_STEP;

  for (let depth = 0; depth < path.length; depth++) {
    const key = path[depth];
    const indent = parentStartIndex === -1 ? 0 : parentIndent + DEFAULT_INDENT_STEP;
    const { start, end } = findBlockRangeForParent(lines, parentStartIndex);
    const found = findKeyLineInRange(lines, key, start, end, indent);
    if (found === -1) return undefined;

    const isLeaf = depth === path.length - 1;
    if (isLeaf) {
      const { content } = splitInlineComment(lines[found] || '');
      const after = content.slice(indent).slice(key.length);
      const match = after.match(/^\s*:\s*(.*)$/);
      const raw = match ? match[1] : '';
      return parseYamlScalarValue(raw);
    }

    parentStartIndex = found;
    parentIndent = indent;
  }

  return undefined;
}

export function getYamlStringArrayAtPath(yamlText: string, path: string[]): string[] | undefined {
  if (!path.length) return undefined;
  const lines = (yamlText || '').split(/\r?\n/);
  let parentStartIndex = -1;
  let parentIndent = -DEFAULT_INDENT_STEP;

  for (let depth = 0; depth < path.length; depth++) {
    const key = path[depth];
    const indent = parentStartIndex === -1 ? 0 : parentIndent + DEFAULT_INDENT_STEP;
    const { start, end } = findBlockRangeForParent(lines, parentStartIndex);
    const found = findKeyLineInRange(lines, key, start, end, indent);
    if (found === -1) return undefined;

    const isLeaf = depth === path.length - 1;
    if (isLeaf) {
      const { content } = splitInlineComment(lines[found] || '');
      const after = content.slice(indent).slice(key.length);
      const match = after.match(/^\s*:\s*(.*)$/);
      const raw = (match ? match[1] : '').trim();
      if (raw === '[]') return [];

      const childStart = findNextSignificant(lines, found + 1);
      if (childStart === -1) return [];
      const childIndent = indent + DEFAULT_INDENT_STEP;
      if (countIndent(lines[childStart]) <= indent) return [];

      const items: string[] = [];
      for (let i = childStart; i < lines.length; i++) {
        if (!isSignificant(lines[i])) continue;
        if (countIndent(lines[i]) <= indent) break;
        if (countIndent(lines[i]) !== childIndent) continue;
        const trimmed = lines[i].slice(childIndent).trim();
        if (!trimmed.startsWith('-')) continue;
        const itemRaw = trimmed.replace(/^-+\s*/, '');
        const itemValue = parseYamlScalarValue(itemRaw);
        if (typeof itemValue === 'string') items.push(itemValue);
        else if (itemValue === undefined || itemValue === null) items.push('');
        else items.push(String(itemValue));
      }
      return items;
    }

    parentStartIndex = found;
    parentIndent = indent;
  }

  return undefined;
}

export function listYamlMapKeysAtPath(yamlText: string, path: string[]): string[] {
  if (!path.length) return [];
  const lines = (yamlText || '').split(/\r?\n/);
  let parentStartIndex = -1;
  let parentIndent = -DEFAULT_INDENT_STEP;

  for (let depth = 0; depth < path.length; depth++) {
    const key = path[depth];
    const indent = parentStartIndex === -1 ? 0 : parentIndent + DEFAULT_INDENT_STEP;
    const { start, end } = findBlockRangeForParent(lines, parentStartIndex);
    const found = findKeyLineInRange(lines, key, start, end, indent);
    if (found === -1) return [];

    const isLeaf = depth === path.length - 1;
    if (isLeaf) {
      const endIndex = getKeyBlockEnd(lines, found);
      const childIndent = indent + DEFAULT_INDENT_STEP;
      const keys: string[] = [];
      const seen = new Set<string>();

      for (let i = found + 1; i <= endIndex && i < lines.length; i++) {
        const line = lines[i];
        if (!isSignificant(line)) continue;
        if (countIndent(line) <= indent) break;
        if (countIndent(line) !== childIndent) continue;
        const trimmed = line.slice(childIndent);
        if (trimmed.trimStart().startsWith('-')) continue;
        const match = trimmed.match(/^([^\s:]+)\s*:\s*(.*)$/);
        if (!match) continue;
        const k = String(match[1] || '').trim();
        if (!k) continue;
        const lowered = k.toLowerCase();
        if (seen.has(lowered)) continue;
        seen.add(lowered);
        keys.push(k);
      }

      return keys;
    }

    parentStartIndex = found;
    parentIndent = indent;
  }

  return [];
}

export function getYamlObjectArrayAtPath(
  yamlText: string,
  path: string[]
): Array<Record<string, unknown>> | undefined {
  if (!path.length) return undefined;
  const lines = (yamlText || '').split(/\r?\n/);
  let parentStartIndex = -1;
  let parentIndent = -DEFAULT_INDENT_STEP;

  for (let depth = 0; depth < path.length; depth++) {
    const key = path[depth];
    const indent = parentStartIndex === -1 ? 0 : parentIndent + DEFAULT_INDENT_STEP;
    const { start, end } = findBlockRangeForParent(lines, parentStartIndex);
    const found = findKeyLineInRange(lines, key, start, end, indent);
    if (found === -1) return undefined;

    const isLeaf = depth === path.length - 1;
    if (isLeaf) {
      const { content } = splitInlineComment(lines[found] || '');
      const after = content.slice(indent).slice(key.length);
      const match = after.match(/^\s*:\s*(.*)$/);
      const raw = (match ? match[1] : '').trim();
      if (raw === '[]') return [];

      const blockEnd = getKeyBlockEnd(lines, found);
      const childStart = findNextSignificant(lines, found + 1);
      if (childStart === -1) return [];
      if (countIndent(lines[childStart]) <= indent) return [];

      let listIndent = indent + DEFAULT_INDENT_STEP;
      if (
        countIndent(lines[childStart]) > listIndent &&
        lines[childStart].trimStart().startsWith('-')
      ) {
        listIndent = countIndent(lines[childStart]);
      }

      const items: Array<Record<string, unknown>> = [];

      let i = childStart;
      while (i <= blockEnd && i < lines.length) {
        const line = lines[i];
        if (!isSignificant(line)) {
          i++;
          continue;
        }
        if (countIndent(line) <= indent) break;

        if (
          countIndent(line) === listIndent &&
          line.slice(listIndent).trimStart().startsWith('-')
        ) {
          const item: Record<string, unknown> = {};
          const first = splitInlineComment(
            line
              .slice(listIndent)
              .trimStart()
              .replace(/^-+\s*/, '')
          ).content.trim();
          if (first) {
            const kv = first.match(/^([^\s:]+)\s*:\s*(.*)$/);
            if (kv) {
              item[String(kv[1]).trim()] = parseYamlScalarValue(String(kv[2] ?? ''));
            }
          }

          let j = i + 1;
          while (j <= blockEnd && j < lines.length) {
            const next = lines[j];
            if (!isSignificant(next)) {
              j++;
              continue;
            }
            if (countIndent(next) <= indent) break;
            if (
              countIndent(next) === listIndent &&
              next.slice(listIndent).trimStart().startsWith('-')
            )
              break;
            if (countIndent(next) !== listIndent + DEFAULT_INDENT_STEP) {
              j++;
              continue;
            }

            const { content: kvLine } = splitInlineComment(
              next.slice(listIndent + DEFAULT_INDENT_STEP)
            );
            const kv = kvLine.trim().match(/^([^\s:]+)\s*:\s*(.*)$/);
            if (kv) {
              item[String(kv[1]).trim()] = parseYamlScalarValue(String(kv[2] ?? ''));
            }
            j++;
          }

          if (Object.keys(item).length) items.push(item);
          i = j;
          continue;
        }

        i++;
      }

      return items;
    }

    parentStartIndex = found;
    parentIndent = indent;
  }

  return undefined;
}
