import axios from 'axios';
import { isolateStorage } from './isolation';
import { mockTransport } from './transport';
import { findScenario } from './scenarios';

async function boot() {
  if (!import.meta.env.DEV) throw new Error('This temporary mock entry is development-only.');
  // No application module is imported until real storage has become inaccessible
  // and Axios has a terminal adapter which never forwards to the network.
  isolateStorage(window);
  mockTransport.configure(findScenario(new URLSearchParams(location.search).get('scenario')));
  axios.defaults.adapter = mockTransport.adapter;
  await import('./mount');
}
void boot().catch((error) => {
  document.getElementById('root')!.textContent =
    `Mock 环境未启动：${error instanceof Error ? error.message : String(error)}`;
});
