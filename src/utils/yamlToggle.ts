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
  // Step 1: Find the `openai-compatibility:` section header
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^openai-compatibility\s*:/.test(lines[i].trimStart())) {
      sectionStart = i + 1;
      break;
    }
  }
  if (sectionStart === -1) return null;

  // Step 2: Determine section boundaries and collect entry ranges
  // Entries are YAML list items starting with `  - ` (or `#  - ` if commented)
  const entries: Array<{ start: number; end: number; name: string | null }> = [];
  let currentStart = -1;

  for (let i = sectionStart; i < lines.length; i++) {
    const raw = lines[i];

    // If we hit a non-indented, non-blank, non-comment line → section ended
    if (raw.length > 0 && !/^\s/.test(raw) && !/^#/.test(raw)) {
      break;
    }

    const effective = commented ? raw.replace(/^#\s?/, '') : raw;

    // Check if this line starts a new list item (e.g. `  - name:` or `  - base-url:`)
    if (/^\s{1,4}-\s/.test(effective)) {
      if (currentStart !== -1) {
        // Close previous entry
        entries.push({ start: currentStart, end: i, name: extractName(lines, currentStart, i, commented) });
      }
      currentStart = i;
    }
  }

  // Close last entry
  if (currentStart !== -1) {
    let endIdx = lines.length;
    for (let i = currentStart + 1; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.length > 0 && !/^\s/.test(raw) && !/^#/.test(raw)) {
        endIdx = i;
        break;
      }
      const effective = commented ? raw.replace(/^#\s?/, '') : raw;
      if (/^\s{1,4}-\s/.test(effective)) {
        endIdx = i;
        break;
      }
    }
    entries.push({ start: currentStart, end: endIdx, name: extractName(lines, currentStart, endIdx, commented) });
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
function extractName(lines: string[], start: number, end: number, commented: boolean): string | null {
  for (let i = start; i < end; i++) {
    const line = commented ? lines[i].replace(/^#\s?/, '') : lines[i];
    const match = line.match(/\bname\s*:\s*["']?([^"'\n#]+)/);
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
    // Only comment non-empty lines; preserve blank lines
    if (lines[i].trim().length > 0) {
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
    // Remove leading `# ` or `#` (one level of commenting)
    lines[i] = lines[i].replace(/^# ?/, '');
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

  // Find section
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^openai-compatibility\s*:/.test(lines[i].trimStart())) {
      sectionStart = i + 1;
      break;
    }
  }
  if (sectionStart === -1) return names;

  // Scan for commented list items
  let currentStart = -1;
  for (let i = sectionStart; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.length > 0 && !/^\s/.test(raw) && !/^#/.test(raw)) break;

    // Check if this is a commented list item start
    const uncommented = raw.replace(/^#\s?/, '');
    if (/^\s{1,4}-\s/.test(uncommented) && /^#/.test(raw)) {
      if (currentStart !== -1) {
        const name = extractName(lines, currentStart, i, true);
        if (name && !isActiveEntry(lines, name)) names.push(name);
      }
      currentStart = i;
    } else if (/^\s{1,4}-\s/.test(raw) && !/^#/.test(raw)) {
      // Active (uncommented) entry start - close any pending commented entry
      if (currentStart !== -1) {
        const name = extractName(lines, currentStart, i, true);
        if (name && !isActiveEntry(lines, name)) names.push(name);
        currentStart = -1;
      }
    }
  }

  // Close last entry
  if (currentStart !== -1) {
    const name = extractName(lines, currentStart, lines.length, true);
    if (name && !isActiveEntry(lines, name)) names.push(name);
  }

  return names;
}

/**
 * Check if a name exists as an active (non-commented) entry.
 */
function isActiveEntry(lines: string[], name: string): boolean {
  const normalizedName = name.trim().toLowerCase();
  // Simple check: find an uncommented line with this name
  for (const line of lines) {
    if (/^#/.test(line)) continue;
    const match = line.match(/\bname\s*:\s*["']?([^"'\n#]+)/);
    if (match && match[1].trim().toLowerCase() === normalizedName) {
      return true;
    }
  }
  return false;
}
