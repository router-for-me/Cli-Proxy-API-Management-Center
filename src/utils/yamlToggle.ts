/**
 * Toggle (comment/uncomment) a specific openai-compatibility entry in raw YAML by provider name.
 *
 * Approach:
 *   - Find the `openai-compatibility:` section
 *   - Locate the list entry whose `name` matches the target
 *   - Comment out (prefix `# `) or uncomment (remove leading `# `) all lines of that entry
 *
 * The raw YAML API preserves comments, so commented-out entries remain in the file
 * but are ignored by the YAML parser.
 */

type OpenAISectionRange = {
  start: number;
  end: number;
  entryIndent: number;
};

function getLeadingIndent(line: string): number {
  const match = line.match(/^ */);
  return match ? match[0].length : 0;
}

function isCommentedLine(line: string): boolean {
  return /^\s*#/.test(line);
}

function stripCommentPrefixes(line: string): string {
  let normalized = line;
  while (/^# ?/.test(normalized)) {
    normalized = normalized.replace(/^# ?/, '');
  }
  return normalized;
}

function getListItemIndent(line: string): number | null {
  const match = line.match(/^(\s*)-\s/);
  return match ? match[1].length : null;
}

function findOpenAISectionRange(lines: string[]): OpenAISectionRange | null {
  let sectionStart = -1;
  let sectionIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (isCommentedLine(raw)) continue;

    if (/^\s*openai-compatibility\s*:/.test(raw)) {
      sectionStart = i + 1;
      sectionIndent = getLeadingIndent(raw);
      break;
    }
  }

  if (sectionStart === -1) return null;

  let sectionEnd = lines.length;
  for (let i = sectionStart; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim().length === 0) continue;
    if (isCommentedLine(raw)) continue;

    const indent = getLeadingIndent(raw);
    if (indent <= sectionIndent) {
      sectionEnd = i;
      break;
    }
  }

  return {
    start: sectionStart,
    end: sectionEnd,
    entryIndent: sectionIndent + 2,
  };
}

function isTopLevelEntryStart(line: string, entryIndent: number, commented: boolean): boolean {
  if (commented && !isCommentedLine(line)) return false;

  const effective = commented ? stripCommentPrefixes(line) : line;
  const listIndent = getListItemIndent(effective);
  return listIndent === entryIndent;
}

/**
 * Find the boundaries of a YAML list entry that contains `name: <targetName>`
 * within the `openai-compatibility:` section.
 *
 * Returns [startLine, endLine) or null if not found.
 */
function findOpenAIEntryRange(
  lines: string[],
  targetName: string,
  commented: boolean
): [number, number] | null {
  const section = findOpenAISectionRange(lines);
  if (!section) return null;

  // Step 2: Collect top-level entry ranges inside the section.
  const entries: Array<{ start: number; end: number; name: string | null }> = [];
  let currentStart = -1;

  for (let i = section.start; i < section.end; i++) {
    if (isTopLevelEntryStart(lines[i], section.entryIndent, commented)) {
      if (currentStart !== -1) {
        entries.push({
          start: currentStart,
          end: i,
          name: extractName(lines, currentStart, i, commented, section.entryIndent),
        });
      }
      currentStart = i;
    }
  }

  // Close last entry
  if (currentStart !== -1) {
    entries.push({
      start: currentStart,
      end: section.end,
      name: extractName(lines, currentStart, section.end, commented, section.entryIndent),
    });
  }

  // Step 3: Find the entry matching targetName
  const normalizedTarget = targetName.trim().toLowerCase();
  for (const entry of entries) {
    if (entry.name && entry.name.trim().toLowerCase() === normalizedTarget) {
      return [entry.start, entry.end];
    }
  }

  return null;
}

/**
 * Extract the `name` value from lines within [start, end).
 */
function extractName(
  lines: string[],
  start: number,
  end: number,
  commented: boolean,
  entryIndent: number
): string | null {
  const inlineNamePattern = new RegExp(`^\\s{${entryIndent}}-\\s*name\\s*:\\s*["']?([^"'\\n#]+)`);
  const topLevelNamePattern = new RegExp(`^\\s{${entryIndent + 2}}name\\s*:\\s*["']?([^"'\\n#]+)`);

  for (let i = start; i < end; i++) {
    const line = commented ? stripCommentPrefixes(lines[i]) : lines[i];
    const match = line.match(inlineNamePattern) ?? line.match(topLevelNamePattern);
    if (match) {
      return match[1].trim();
    }
  }
  return null;
}

/**
 * Comment out (disable) an openai-compatibility entry by name.
 * Returns the modified YAML string, or null if the entry was not found.
 */
export function commentOpenAIEntry(yamlContent: string, providerName: string): string | null {
  const lines = yamlContent.split('\n');
  const range = findOpenAIEntryRange(lines, providerName, false);
  if (!range) return null;

  const [start, end] = range;
  for (let i = start; i < end; i++) {
    // Only comment non-empty lines that are not already comments; preserve blank lines
    if (lines[i].trim().length > 0 && !isCommentedLine(lines[i])) {
      lines[i] = '# ' + lines[i];
    }
  }

  return lines.join('\n');
}

/**
 * Uncomment (enable) a previously commented-out openai-compatibility entry by name.
 * Returns the modified YAML string, or null if the entry was not found.
 */
export function uncommentOpenAIEntry(yamlContent: string, providerName: string): string | null {
  const lines = yamlContent.split('\n');
  const range = findOpenAIEntryRange(lines, providerName, true);
  if (!range) return null;

  const [start, end] = range;
  for (let i = start; i < end; i++) {
    // Remove all stacked leading comment prefixes introduced by repeated comment toggles.
    lines[i] = stripCommentPrefixes(lines[i]);
  }

  return lines.join('\n');
}

/**
 * Check if a provider name has a commented-out entry in the YAML.
 */
export function isOpenAIEntryCommented(yamlContent: string, providerName: string): boolean {
  const lines = yamlContent.split('\n');
  return findOpenAIEntryRange(lines, providerName, true) !== null
    && findOpenAIEntryRange(lines, providerName, false) === null;
}

/**
 * Get a list of all commented-out openai-compatibility provider names.
 */
export function getCommentedOpenAIEntryNames(yamlContent: string): string[] {
  const lines = yamlContent.split('\n');
  const names: string[] = [];
  const section = findOpenAISectionRange(lines);
  if (!section) return names;

  const starts: Array<{ index: number; commented: boolean }> = [];
  for (let i = section.start; i < section.end; i++) {
    const effective = stripCommentPrefixes(lines[i]);
    const listIndent = getListItemIndent(effective);
    if (listIndent === section.entryIndent) {
      starts.push({ index: i, commented: isCommentedLine(lines[i]) });
    }
  }

  for (let i = 0; i < starts.length; i++) {
    const current = starts[i];
    if (!current.commented) continue;

    const end = i + 1 < starts.length ? starts[i + 1].index : section.end;
    const name = extractName(lines, current.index, end, true, section.entryIndent);
    if (name && !isActiveEntry(lines, name)) names.push(name);
  }

  return names;
}

/**
 * Check if a name exists as an active (non-commented) entry.
 */
function isActiveEntry(lines: string[], name: string): boolean {
  return findOpenAIEntryRange(lines, name, false) !== null;
}
