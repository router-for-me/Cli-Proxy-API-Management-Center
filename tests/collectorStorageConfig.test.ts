import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCollectorStorageConfigYaml,
  normalizeCollectorStorageDraft,
  type CollectorStorageDraft
} from '../src/utils/collectorStorageConfig.ts';

test('normalizes collector storage draft with sqlite defaults', () => {
  assert.deepEqual(normalizeCollectorStorageDraft({} as CollectorStorageDraft), {
    driver: 'sqlite',
    sqlitePath: './data/collector.db',
    mysqlDsn: '',
    kafkaEnabled: false,
    kafkaBrokers: '127.0.0.1:9092',
    kafkaCallLogsTopic: 'cli-proxy-api-call-logs',
    kafkaUsageStatsTopic: 'cli-proxy-api-usage-stats'
  });
});

test('builds sqlite collector config yaml without kafka when disabled', () => {
  const yaml = buildCollectorStorageConfigYaml({
    driver: 'sqlite',
    sqlitePath: './data/calls.db',
    mysqlDsn: '',
    kafkaEnabled: false,
    kafkaBrokers: '',
    kafkaCallLogsTopic: '',
    kafkaUsageStatsTopic: ''
  });

  assert.match(yaml, /driver: sqlite/);
  assert.match(yaml, /path: "\.\/data\/calls\.db"/);
  assert.match(yaml, /enabled: false/);
  assert.doesNotMatch(yaml, /brokers:/);
});

test('builds mysql collector config yaml with kafka topics', () => {
  const yaml = buildCollectorStorageConfigYaml({
    driver: 'mysql',
    sqlitePath: './data/collector.db',
    mysqlDsn: 'collector:secret@tcp(127.0.0.1:3306)/collector?parseTime=true',
    kafkaEnabled: true,
    kafkaBrokers: 'broker-1:9092, broker-2:9092',
    kafkaCallLogsTopic: 'call-logs',
    kafkaUsageStatsTopic: 'usage-stats'
  });

  assert.match(yaml, /driver: mysql/);
  assert.match(yaml, /dsn: "collector:secret@tcp\(127\.0\.0\.1:3306\)\/collector\?parseTime=true"/);
  assert.match(yaml, /enabled: true/);
  assert.match(yaml, /- "broker-1:9092"/);
  assert.match(yaml, /- "broker-2:9092"/);
  assert.match(yaml, /call_logs_topic: "call-logs"/);
  assert.match(yaml, /usage_stats_topic: "usage-stats"/);
});
