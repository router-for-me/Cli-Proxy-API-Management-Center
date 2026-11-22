import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sheet = source('../src/components/ui/Sheet/Sheet.tsx');
const provider = source('../src/features/providers/sheets/ProviderSheet.tsx');

test('provider navigation changes the sheet view key without remounting the dialog', () => {
  expect(provider).toContain(
    "const viewKey = `${state.brand}:${state.resource?.id ?? 'new'}:${state.mode}`"
  );
  const props = provider.match(/<Sheet\s+([\s\S]*?)\n\s*>/u)?.[1];
  expect(props).toContain('viewKey={viewKey}');
  expect(props).not.toContain('key={');
});

test('view changes reset body scroll and focus before paint without replacing the opener', () => {
  const effects = [...sheet.matchAll(/useLayoutEffect\(\(\) => \{([\s\S]*?)\}, \[([^\]]*)\]\);/gu)];
  const reset = effects.find(([, , deps]) => deps.includes('viewKey'))?.[1];
  expect(reset).toContain('if (!open) return');
  expect(reset).toContain('bodyRef.current.scrollTop = 0');
  expect(reset).toContain('focus({ preventScroll: true })');
  expect(reset).not.toContain('previouslyFocusedRef');
  expect(sheet).toContain('previouslyFocusedRef.current?.focus({ preventScroll: true })');
});
