import { isMap, isSeq, parseDocument, Scalar } from 'yaml';

export type YamlPatch =
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

const DEFAULT_INDENT_STEP = 2;

const detectNewline = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');

const normalizeNewlines = (text: string, newline: string) => text.replace(/\r?\n/g, newline);

const ensureTrailingNewline = (text: string, newline: string, wanted: boolean) => {
  if (!wanted) return text;
  return text.endsWith(newline) ? text : text + newline;
};

const trimEmptyEdges = (lines: string[]) => {
  let start = 0;
  let end = lines.length - 1;
  while (start <= end && !String(lines[start] ?? '').trim()) start++;
  while (end >= start && !String(lines[end] ?? '').trim()) end--;
  return lines.slice(start, end + 1);
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const countIndent = (line: string | undefined) => {
  if (!line) return 0;
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === ' ') count++;
    else break;
  }
  return count;
};

const dedentLines = (lines: string[]) => {
  let minIndent = Infinity;
  lines.forEach((line) => {
    if (!String(line ?? '').trim()) return;
    minIndent = Math.min(minIndent, countIndent(line));
  });
  if (!Number.isFinite(minIndent) || minIndent <= 0) return lines;
  return lines.map((line) => (!String(line ?? '').trim() ? line : line.slice(minIndent)));
};

const parseYamlDocumentOrThrow = (yamlText: string) => {
  const doc = parseDocument(String(yamlText ?? ''));
  if (doc.errors?.length) {
    const message = doc.errors[0]?.message || 'Invalid YAML';
    throw new Error(message);
  }
  return doc;
};

export function hasYamlTopLevelKey(yamlText: string, key: string) {
  try {
    const doc = parseYamlDocumentOrThrow(yamlText);
    const root = doc.contents;
    if (!isMap(root)) return false;
    return root.has(key);
  } catch {
    return false;
  }
}

export function applyYamlPatches(
  yamlText: string,
  patches: YamlPatch[],
  options: { indentStep?: number; keyOrderMap?: Record<string, string[]> } = {}
) {
  void options;
  const newline = detectNewline(String(yamlText || ''));
  const hadTrailingNewline =
    !!yamlText && (String(yamlText).endsWith('\n') || String(yamlText).endsWith('\r\n'));

  const doc = parseYamlDocumentOrThrow(String(yamlText || ''));

  (patches || []).forEach((patch) => {
    if (!patch || !Array.isArray(patch.path) || patch.path.length === 0) return;
    if (patch.type === 'delete') {
      doc.deleteIn(patch.path);
      return;
    }

    doc.setIn(patch.path, patch.value);
  });

  let out = String(doc);
  out = normalizeNewlines(out, newline);
  out = ensureTrailingNewline(out, newline, hadTrailingNewline);
  return out;
}

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

  const firstNonBlankIndex = trimmed.findIndex((line) => !!String(line ?? '').trim());
  const firstLine = firstNonBlankIndex === -1 ? '' : trimmed[firstNonBlankIndex];
  const rootRe = new RegExp(`^\\s*${escapeRegExp(rootKey)}\\s*:\\s*$`);
  if (rootRe.test(firstLine)) {
    return trimmed.join(newline).trimEnd();
  }

  const indented = trimmed.map((line) =>
    !String(line ?? '').trim() ? line : `${' '.repeat(indentStep)}${line}`
  );
  return [`${rootKey}:`, ...indented].join(newline).trimEnd();
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

export function removeYamlCommentSectionByMarkers(
  yamlText: string,
  startMarker: string,
  endMarker?: string
) {
  const newline = detectNewline(yamlText || '');
  const hadTrailingNewline =
    !!yamlText && (String(yamlText).endsWith('\n') || String(yamlText).endsWith('\r\n'));
  const lines = (yamlText || '').split(/\r?\n/);

  const startIndex = lines.findIndex((line) => (line || '').trim() === startMarker.trim());
  if (startIndex === -1) return yamlText;

  let endIndex = lines.length;
  if (endMarker) {
    const foundEnd = lines.findIndex(
      (line, idx) => idx > startIndex && (line || '').trim() === endMarker.trim()
    );
    if (foundEnd !== -1) endIndex = foundEnd;
  }

  lines.splice(startIndex, endIndex - startIndex);
  const out = ensureTrailingNewline(lines.join(newline), newline, hadTrailingNewline);
  return out;
}

export function getYamlScalarAtPath(yamlText: string, path: string[]): unknown {
  if (!path.length) return undefined;
  try {
    const doc = parseYamlDocumentOrThrow(String(yamlText || ''));
    const value = doc.getIn(path);
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      return value;
    if (value instanceof Scalar) return value.value;
    return undefined;
  } catch {
    return undefined;
  }
}

export function getYamlStringArrayAtPath(yamlText: string, path: string[]): string[] | undefined {
  if (!path.length) return undefined;
  try {
    const doc = parseYamlDocumentOrThrow(String(yamlText || ''));
    const node = doc.getIn(path);
    if (node === undefined) return undefined;
    if (Array.isArray(node)) return node.map((v) => String(v ?? ''));
    if (isSeq(node)) return node.toJSON().map((v: unknown) => String(v ?? ''));
    return undefined;
  } catch {
    return undefined;
  }
}

export function listYamlMapKeysAtPath(yamlText: string, path: string[]): string[] {
  if (!path.length) return [];
  try {
    const doc = parseYamlDocumentOrThrow(String(yamlText || ''));
    const node = doc.getIn(path);
    if (!isMap(node)) return [];

    const seen = new Set<string>();
    const keys: string[] = [];
    node.items.forEach((pair) => {
      const rawKey =
        pair.key instanceof Scalar ? String(pair.key.value ?? '') : String((pair.key as unknown) ?? '');
      const key = rawKey.trim();
      if (!key) return;
      const lowered = key.toLowerCase();
      if (seen.has(lowered)) return;
      seen.add(lowered);
      keys.push(key);
    });
    return keys;
  } catch {
    return [];
  }
}

export function getYamlObjectArrayAtPath(
  yamlText: string,
  path: string[]
): Array<Record<string, unknown>> | undefined {
  if (!path.length) return undefined;
  try {
    const doc = parseYamlDocumentOrThrow(String(yamlText || ''));
    const node = doc.getIn(path);
    if (node === undefined) return undefined;
    if (Array.isArray(node)) {
      return node.filter((v) => v && typeof v === 'object' && !Array.isArray(v)) as Array<
        Record<string, unknown>
      >;
    }
    if (!isSeq(node)) return undefined;
    const raw = node.toJSON();
    if (!Array.isArray(raw)) return undefined;
    return raw.filter((v) => v && typeof v === 'object' && !Array.isArray(v)) as Array<
      Record<string, unknown>
    >;
  } catch {
    return undefined;
  }
}
