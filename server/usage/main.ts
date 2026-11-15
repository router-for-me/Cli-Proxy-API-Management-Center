// prox-usage owns sockets and HTTP here; its worker owns every SQLite call.
import { loadSourceManifest } from '../providerSources/config';
import { UsageCollector } from './collector';
import { UsageWriter } from './writer';
import { createUsageStatusHandler } from './status';
import { cpampRetiredFromEnv } from './writerProtocol';
import { createAnalyticsHandler, ANALYTICS_PATHS } from './handler';
import { EventLoopLagStats, startEventLoopLagProbe } from '../eventLoopLag';

const eventLoopLag = new EventLoopLagStats();

const { manifest } = loadSourceManifest(
  process.env.PROX_SOURCE_MANIFEST ??
    new URL('../../deploy/provider-sources.json', import.meta.url).pathname
);
const dbPath = process.env.PROX_USAGE_DB_PATH ?? '/data/usage.sqlite';
const writer = new UsageWriter();
await writer.init(
  {
    events: dbPath,
    raw: process.env.PROX_USAGE_RAW_PATH ?? '/data/usage-raw.sqlite',
    rateBookPath: process.env.PROX_USAGE_RATES_PATH,
  },
  manifest.sources.map((source) => source.instanceId),
  Date.now(),
  undefined,
  {
    rateBookPath: process.env.PROX_USAGE_RATES_PATH,
    clientAliasesPath: process.env.PROX_USAGE_CLIENT_ALIASES_PATH,
  }
);
const analytics = createAnalyticsHandler({
  dbPath,
  keyFile: manifest.history.managementKeyFile,
  rateBookPath: process.env.PROX_USAGE_RATES_PATH,
});
let healthy = true;
const collectors = manifest.sources.map((source) => new UsageCollector(source, writer));
writer.onOverflow = () => collectors.forEach((collector) => collector.overflow());
const statusHandler = createUsageStatusHandler({
  keyFile: manifest.history.managementKeyFile,
  sources: () => collectors.map((collector) => collector.status),
  writer: () => writer.status,
  jobs: writer,
  exporter: () => writer.exporterSnapshot(),
  eventLoop: () => eventLoopLag.snapshot(),
  cpampRetired: cpampRetiredFromEnv(),
  healthy: () => healthy,
});
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 18320,
  // Let a query's 30-second deadline decide expiry before Bun closes an idle socket.
  idleTimeout: 35,
  fetch: (request) =>
    ANALYTICS_PATHS.includes(new URL(request.url).pathname)
      ? analytics(request)
      : statusHandler(request),
});
let closing: Promise<void> | null = null;
const shutdown = (): Promise<void> => {
  if (closing) return closing;
  healthy = false;
  analytics.close();
  closing = (async () => {
    const stops = await Promise.allSettled(collectors.map((collector) => collector.stop()));
    try {
      await writer.close();
    } finally {
      await server.stop(true);
    }
    if (stops.some((stop) => stop.status === 'rejected')) {
      throw new Error('Usage unsubscribe did not acknowledge; final events were flushed');
    }
  })();
  return closing;
};
const exit = () => {
  void shutdown().then(
    () => process.exit(0),
    () => process.exit(1)
  );
};
writer.onFailure = exit;
process.once('SIGTERM', exit);
process.once('SIGINT', exit);
collectors.forEach((collector) => collector.start());
startEventLoopLagProbe(console.warn, eventLoopLag);
console.log('Prox usage listening on loopback port 18320');
