import { createHandler } from './app';
import { QuotaStore } from './quota/store';
import { QuotaCollector } from './quota/collector';
import { ResetClaims } from './quota/claims';
import { loadSourceManifest } from './providerSources/config';
import { LEGACY_SOURCE_MAPPING } from './quota/identity';
import { createAnalyticsHandler } from './analytics/handler';
import { startEventLoopLagProbe } from './eventLoopLag';

const { manifest, revision } = loadSourceManifest(
  process.env.PROX_SOURCE_MANIFEST ??
    new URL('../deploy/provider-sources.json', import.meta.url).pathname
);
const keyFile = manifest.history.managementKeyFile;
const store = new QuotaStore(process.env.PROX_DB_PATH ?? '/data/quota.sqlite');
const knownIds = manifest.sources.map((source) => source.instanceId);
store.migrateLegacySources(
  LEGACY_SOURCE_MAPPING.filter((mapping) => knownIds.includes(mapping.instanceId)),
  knownIds
);
// Configuration is an immutable process-lifetime snapshot. Restart to apply a new revision.
const collector = new QuotaCollector(store, { sources: manifest.sources, revision });
const quotaHandler = createHandler({
  store,
  collector,
  keyFile,
  claims: new ResetClaims({ store, collector }),
});
const analyticsHandler = createAnalyticsHandler(manifest);
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 18319,
  fetch: (request) =>
    new URL(request.url).pathname === '/v1/analytics'
      ? analyticsHandler(request)
      : quotaHandler(request),
});
collector.start();
startEventLoopLagProbe();
// Keep the default analytics views warm so page loads never wait on slow scans.
void analyticsHandler.warm();
const analyticsWarmer = setInterval(() => void analyticsHandler.warm(), 15_000);
console.log('Prox quota history listening on loopback port 18319');
const shutdown = () => {
  collector.stop();
  clearInterval(analyticsWarmer);
  void server.stop(true);
  store.close();
  process.exit(0);
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
