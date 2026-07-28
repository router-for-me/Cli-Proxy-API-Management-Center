/**
 * Verify the provider filter chips actually filter the board, and that the
 * density picker changes the column count. Run after shoot.sh has Chrome up.
 */

const [, , OUT = '/tmp/quota-filtered.png'] = Bun.argv;
const DEBUG_PORT = 9222;

const targets = (await (await fetch(`http://localhost:${DEBUG_PORT}/json`)).json()) as {
  type: string;
  webSocketDebuggerUrl: string;
}[];
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

let nextId = 1;
const pending = new Map<number, (msg: Record<string, never>) => void>();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(String(event.data));
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)!(msg);
    pending.delete(msg.id);
  }
});

const send = (method: string, params: Record<string, unknown> = {}): Promise<never> => {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve as never);
    ws.send(JSON.stringify({ id, method, params }));
  });
};

const evaluate = async (expression: string): Promise<unknown> => {
  const msg = (await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as { result?: { result?: { value?: unknown } } };
  return msg.result?.result?.value;
};

const cardCount = () =>
  evaluate(
    `[...document.querySelectorAll('button')].filter(
       (b) => /Refresh quota/i.test(b.textContent || '')).length`
  );

const clickChip = (label: string) =>
  evaluate(`(() => {
    const chip = [...document.querySelectorAll('button')]
      .find((b) => (b.textContent || '').trim().startsWith(${JSON.stringify(label)}));
    if (!chip) return 'chip not found: ' + ${JSON.stringify(label)};
    chip.click();
    return 'clicked';
  })()`);

const results: Record<string, unknown> = {};
results.allCards = await cardCount();

for (const [chip, expected] of [
  ['Claude', 4],
  ['Antigravity', 1],
  ['Codex', 2],
  ['Kimi', 1],
] as const) {
  const clicked = await clickChip(chip);
  await Bun.sleep(400);
  const count = await cardCount();
  results[chip] = { clicked, count, expected, ok: count === expected };
}

await clickChip('All credentials');
await Bun.sleep(400);
results.backToAll = await cardCount();

// Density: 2 per row should widen the cards.
await evaluate(`(() => {
  const picker = document.querySelector('[role="group"][aria-label*="row" i]')
    || document.querySelectorAll('[role="group"]')[1];
  const first = picker?.querySelector('button');
  first?.click();
  return true;
})()`);
await Bun.sleep(400);
results.columnsAfterDensity = await evaluate(`(() => {
  const grid = [...document.querySelectorAll('div')].find(
    (d) => getComputedStyle(d).display === 'grid'
      && d.querySelector('button') && d.children.length > 2
      && /Refresh quota/i.test(d.textContent || ''));
  return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : null;
})()`);

console.log(JSON.stringify(results, null, 2));

// Screenshot the filtered-to-Claude state as the visual record.
await clickChip('Claude');
await Bun.sleep(500);
const shot = (await send('Page.captureScreenshot', { format: 'png' })) as {
  result?: { data?: string };
};
await Bun.write(OUT, Buffer.from(String(shot.result?.data), 'base64'));
console.log(`wrote ${OUT}`);

ws.close();
