import { expect, test } from 'bun:test';

test('the top gradient spans the full width on phones', async () => {
  const styles = await Bun.file('src/styles/layout.scss').text();
  const mobile = styles.slice(styles.indexOf('@media (max-width: $breakpoint-mobile) {'));
  expect(mobile).toMatch(/\.top-gradient-blur \{[^}]*left: 0;/);
});
