import { resolvePluginAssetURL } from '@/features/plugins/pluginResources';
import type { ProviderFlowState } from './hooks/useOAuthFlows';

export type FlowView = 'idle' | 'flow' | 'success' | 'failed';

/**
 * 对话框视图：有授权链接（或正在生成）→ 步骤视图；链接失效后的失败 → 失败视图。
 * 轮询网络失败时链接仍在，留在步骤视图里：手动回调仍可提交并恢复轮询。
 */
export const resolveFlowView = (state: ProviderFlowState): FlowView => {
  if (state.status === 'success') return 'success';
  if (state.url || state.status === 'waiting') return 'flow';
  if (state.status === 'error') return 'failed';
  return 'idle';
};

/** 授权链接拆成 host + 余下部分：host 高亮，方便用户核对要去的域名。 */
export const splitAuthUrl = (url: string): { host: string; rest: string } => {
  try {
    const { host } = new URL(url);
    if (!host) return { host: '', rest: url };
    const hostEnd = url.indexOf(host) + host.length;
    return { host, rest: url.slice(hostEnd) };
  } catch {
    return { host: '', rest: url };
  }
};

/**
 * 插件登录页的内嵌地址：链接与面板同源时返回绝对地址，否则返回空串。
 *
 * 宿主只下发 url，不声明该页能否被嵌入。插件自带的登录页由宿主同源提供，
 * 而第三方授权页普遍以 X-Frame-Options / frame-ancestors 拒绝嵌入，
 * 所以只内嵌同源页；跨源（含连接远端后端时）仍走新标签页。
 * 相对路径按插件资源的规则以 apiBase 解析，与插件资源页 iframe 一致。
 */
export const resolveEmbeddedLoginUrl = (
  url: string | undefined,
  apiBase: string,
  panelOrigin: string
): string => {
  const trimmed = (url || '').trim();
  if (!trimmed || !panelOrigin) return '';
  try {
    const target = new URL(resolvePluginAssetURL(trimmed, apiBase), panelOrigin);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return '';
    return target.origin === panelOrigin ? target.href : '';
  } catch {
    return '';
  }
};
