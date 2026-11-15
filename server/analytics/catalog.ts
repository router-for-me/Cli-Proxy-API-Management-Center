import { readFile } from 'node:fs/promises';
import type { SourceManifest } from '../../src/domain/providerSources/types';
import type { AnalyticsResponse, RegisteredAnalyticsModel } from '../../src/domain/analytics/types';
import { normalizeModelList } from '../../src/utils/models';
import { isRecord } from '../../src/utils/helpers';
import { readJson } from '../http/readJson';

export type Fetcher = typeof fetch;

/** Read only the registered catalog, using each source's own client access key. */
export async function readCatalogs(
  sources: SourceManifest['sources'],
  signal: AbortSignal,
  fetcher: Fetcher = fetch,
  readKey = async (path: string) => (await readFile(path, 'utf8')).trim()
) {
  const results = await Promise.all(
    sources.map(async (source) => {
      const catalog: RegisteredAnalyticsModel[] = [];
      let state: 'ready' | 'unavailable' = 'unavailable';
      try {
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
        const get = async (path: string, key: string) => {
          requestSignal.throwIfAborted();
          const response = await fetcher(new URL(path, source.upstreamOrigin), {
            headers: { Authorization: `Bearer ${key}` },
            signal: requestSignal,
            redirect: 'error',
          });
          if (!response.ok || !response.body) {
            await response.body?.cancel();
            throw new Error('Catalog unavailable');
          }
          return readJson(response.body, 1024 * 1024);
        };
        const keys = await get(
          '/v8/management/config/access/api-keys',
          await readKey(source.managementKeyFile)
        );
        if (!Array.isArray(keys) || !keys.every((key) => typeof key === 'string') || !keys[0])
          throw new Error('Client API key unavailable');
        const payload = await get('/v1/models', keys[0]);
        if (!isRecord(payload) || !Array.isArray(payload.data) || payload.data.length > 1000)
          throw new Error('Invalid registered catalog');
        const rows = payload.data;
        if (
          !rows.every(
            (row) =>
              isRecord(row) &&
              typeof row.id === 'string' &&
              row.id.length > 0 &&
              row.id.length <= 256
          )
        )
          throw new Error('Invalid registered model');
        const owners = new Map(rows.map((row) => [row.id, row.owned_by]));
        for (const model of normalizeModelList(rows, { dedupe: true })) {
          const owner = owners.get(model.name);
          catalog.push({
            instance_id: source.instanceId,
            instance_label: source.label,
            provider: typeof owner === 'string' && owner.length <= 128 ? owner : 'unknown',
            id: model.name,
          });
        }
        // The upstream lists models in Go map order, which changes per process; the rates view
        // renders this order as sent, so give it one. Ids are unique after dedupe.
        const lexical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
        catalog.sort((a, b) => lexical(a.provider, b.provider) || lexical(a.id, b.id));
        state = 'ready';
      } catch {
        // Failed catalog discovery never hides the other source or invents an empty success.
        catalog.length = 0;
      }
      return { catalog, status: { instance_id: source.instanceId, label: source.label, state } };
    })
  );
  signal.throwIfAborted();
  const catalog = results.flatMap((result) => result.catalog);
  if (catalog.length > 1000) throw new Error('Registered catalog exceeds analytics capacity');
  const catalog_sources: AnalyticsResponse['catalog_sources'] = results.map(
    (result) => result.status
  );
  return { catalog, catalog_sources };
}
