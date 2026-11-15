import axios, { type InternalAxiosRequestConfig } from 'axios';
import { SourceSessions } from '../../src/services/api/sourceSession';

/** Hub sources whose transport answers from `respond`, the way the fake hubs do. */
export function hubs(
  instanceIds: string[],
  respond: (config: InternalAxiosRequestConfig, payload?: { url?: string }) => unknown = () => ({})
) {
  const sessions = new SourceSessions();
  const original = axios.defaults.adapter;
  axios.defaults.adapter = async (config) => {
    const payload =
      typeof config.data === 'string' ? (JSON.parse(config.data) as { url?: string }) : undefined;
    return {
      data: await respond(config, payload),
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  };
  try {
    sessions.configure(
      instanceIds.map((instanceId) => ({
        instanceId,
        configurationRevision: 'fixture',
        apiBase: `https://${instanceId}.invalid`,
        managementKey: 'synthetic-test-key',
      }))
    );
  } finally {
    axios.defaults.adapter = original;
  }
  return sessions;
}
