import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';

const styles = readFileSync(
  new URL('../src/features/authFiles/components/AuthFileQuota.module.scss', import.meta.url),
  'utf8'
);

describe('auth-file quota action button spacing', () => {
  test('spaces the icon and text inside Button’s content wrapper', () => {
    const markup = renderToStaticMarkup(
      createElement(Button, {}, createElement(IconRefreshCw, { size: 14 }), 'Refresh quota')
    );
    expect(markup).toContain('<span><svg');
    expect(markup).toContain('</svg>Refresh quota</span>');
    expect(styles).toMatch(
      /\.quotaResetCreditButton\s*\{[^}]*> span:last-child\s*\{\s*display: inline-flex;\s*align-items: center;\s*gap: 6px;/
    );
  });
});
