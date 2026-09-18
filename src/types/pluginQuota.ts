/**
 * 通用插件额度：宿主归一化形状。
 *
 * 内置 provider 的载荷字段各不相同，插件则统一回这一套（与宿主
 * `pluginapi.QuotaFetchResponse` 对应），面板因此可以用一个适配器渲染任意插件
 * provider。字段全部可选：插件允许只回整体额度、只回套餐行，或只回订阅名。
 */

export interface PluginQuotaMetric {
  key: string;
  label: string;
  value: number;
  unit?: string;
  format?: string;
  currency?: string;
}

export interface PluginQuotaBucket {
  window?: string;
  /** 剩余比例，1 = 满额。缺失时该行只显示绝对时间。 */
  remainingFraction?: number;
  resetTime?: string;
  description?: string;
}

export interface PluginQuotaGroup {
  displayName?: string;
  buckets?: PluginQuotaBucket[];
}

export interface PluginQuotaSubscription {
  plan?: string;
  tierName?: string;
  tierId?: string;
}

export interface PluginQuotaData {
  subscription?: PluginQuotaSubscription | null;
  summary?: PluginQuotaMetric[];
  groups?: PluginQuotaGroup[];
  serverTimeOffsetMs?: number;
}

/** 卡片渲染所需的单行：由 `buildPluginQuotaRows` 从归一化载荷折算。 */
export interface PluginQuotaRow {
  id: string;
  label: string;
  /** 剩余百分比 0–100；null 表示上游没给比例。 */
  percent: number | null;
  /** 形如 `354 / 500`，上游未提供时省略。 */
  amount?: string;
  resetAtMs?: number | null;
}

export interface PluginQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  rows: PluginQuotaRow[];
  error?: string;
  errorStatus?: number;
}
