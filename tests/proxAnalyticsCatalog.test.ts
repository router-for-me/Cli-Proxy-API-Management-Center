import { describe, expect, test } from 'bun:test';
import { readCatalogs, type Fetcher } from '../server/analytics/catalog';

type Row = { id: string; owned_by: string };

// CLIProxyAPI builds /v1/models by ranging a Go map, so its row order is random per process.
function source(instanceId: string, rows: Row[]) {
  const fetcher: Fetcher = async (input) =>
    Response.json(
      String(input).endsWith('/api-keys') ? ['client-key'] : { object: 'list', data: rows }
    );
  return {
    manifest: {
      instanceId,
      label: instanceId,
      upstreamOrigin: `http://${instanceId}.test`,
      managementKeyFile: '/unused',
    },
    fetcher,
  };
}

async function read(order: Row[][]) {
  const sources = order.map((rows, i) => source(`s${i}`, rows));
  return readCatalogs(
    sources.map((s) => s.manifest) as never,
    new AbortController().signal,
    (input, init) =>
      sources
        .find((s) => String(input).startsWith(s.manifest.upstreamOrigin))!
        .fetcher(input, init),
    async () => 'management-key'
  );
}

const claude = ['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].map(
  (id) => ({ id, owned_by: 'anthropic' })
);

describe('registered catalog order', () => {
  test('is the same for every order the upstream lists the models in', async () => {
    const orders = [claude, [...claude.slice(2), ...claude.slice(0, 2)], [...claude].reverse()];
    const results = await Promise.all(orders.map((rows) => read([rows])));
    const ids = results.map((r) => r.catalog.map((entry) => entry.id));
    expect(ids[1]).toEqual(ids[0]);
    expect(ids[2]).toEqual(ids[0]);
    expect(ids[0]).toEqual([
      'claude-fable-5-2',
      'claude-haiku-5-5',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
    ]);
  });

  test('orders by provider, then id, and keeps the sources in manifest order', async () => {
    const { catalog } = await read([
      [
        { id: 'b-model', owned_by: 'openai' },
        { id: 'z-model', owned_by: 'anthropic' },
        { id: 'a-model', owned_by: 'openai' },
        { id: 'a-model-2', owned_by: 'anthropic' },
      ],
      [{ id: 'first', owned_by: 'anthropic' }],
    ]);
    expect(catalog.map((entry) => `${entry.instance_id}/${entry.provider}/${entry.id}`)).toEqual([
      's0/anthropic/a-model-2',
      's0/anthropic/z-model',
      's0/openai/a-model',
      's0/openai/b-model',
      's1/anthropic/first',
    ]);
  });
});
