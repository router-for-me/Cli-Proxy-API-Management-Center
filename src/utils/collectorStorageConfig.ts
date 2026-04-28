export type CollectorStorageDriver = 'sqlite' | 'mysql';

export interface CollectorStorageDraft {
  driver: CollectorStorageDriver;
  sqlitePath: string;
  mysqlDsn: string;
  kafkaEnabled: boolean;
  kafkaBrokers: string;
  kafkaCallLogsTopic: string;
  kafkaUsageStatsTopic: string;
}

export const DEFAULT_COLLECTOR_STORAGE_DRAFT: CollectorStorageDraft = {
  driver: 'sqlite',
  sqlitePath: './data/collector.db',
  mysqlDsn: '',
  kafkaEnabled: false,
  kafkaBrokers: '127.0.0.1:9092',
  kafkaCallLogsTopic: 'cli-proxy-api-call-logs',
  kafkaUsageStatsTopic: 'cli-proxy-api-usage-stats'
};

const escapeYamlString = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const normalizeText = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
};

const normalizeOptionalText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const normalizeCollectorStorageDraft = (
  value: Partial<CollectorStorageDraft> | null | undefined
): CollectorStorageDraft => {
  const driver = value?.driver === 'mysql' ? 'mysql' : DEFAULT_COLLECTOR_STORAGE_DRAFT.driver;

  return {
    driver,
    sqlitePath: normalizeText(value?.sqlitePath, DEFAULT_COLLECTOR_STORAGE_DRAFT.sqlitePath),
    mysqlDsn: normalizeOptionalText(value?.mysqlDsn),
    kafkaEnabled: Boolean(value?.kafkaEnabled),
    kafkaBrokers: normalizeText(value?.kafkaBrokers, DEFAULT_COLLECTOR_STORAGE_DRAFT.kafkaBrokers),
    kafkaCallLogsTopic: normalizeText(
      value?.kafkaCallLogsTopic,
      DEFAULT_COLLECTOR_STORAGE_DRAFT.kafkaCallLogsTopic
    ),
    kafkaUsageStatsTopic: normalizeText(
      value?.kafkaUsageStatsTopic,
      DEFAULT_COLLECTOR_STORAGE_DRAFT.kafkaUsageStatsTopic
    )
  };
};

const yamlString = (value: string): string => `"${escapeYamlString(value)}"`;

const splitBrokers = (value: string): string[] =>
  value
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);

export const buildCollectorStorageConfigYaml = (
  draft: Partial<CollectorStorageDraft>
): string => {
  const normalized = normalizeCollectorStorageDraft(draft);
  const lines = [
    'collector:',
    '  storage:',
    `    driver: ${normalized.driver}`,
  ];

  if (normalized.driver === 'mysql') {
    lines.push(`    dsn: ${yamlString(normalized.mysqlDsn || 'collector:password@tcp(127.0.0.1:3306)/collector?parseTime=true')}`);
  } else {
    lines.push(`    path: ${yamlString(normalized.sqlitePath)}`);
  }

  lines.push('  kafka:', `    enabled: ${normalized.kafkaEnabled ? 'true' : 'false'}`);

  if (normalized.kafkaEnabled) {
    lines.push('    brokers:');
    for (const broker of splitBrokers(normalized.kafkaBrokers)) {
      lines.push(`      - ${yamlString(broker)}`);
    }
    lines.push(
      `    call_logs_topic: ${yamlString(normalized.kafkaCallLogsTopic)}`,
      `    usage_stats_topic: ${yamlString(normalized.kafkaUsageStatsTopic)}`
    );
  }

  lines.push(
    '  proxy:',
    '    # Collector listens on a separate port; users can call either native CLIProxyAPI or Collector.',
    '    upstream_base_url: "http://127.0.0.1:8080"',
    '    listen_addr: ":18080"'
  );

  return `${lines.join('\n')}\n`;
};
