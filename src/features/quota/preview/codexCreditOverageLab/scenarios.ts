/** Temporary developer fixtures. Diagnostic copy deliberately follows the Chinese review brief. */
import type { AuthFileItem } from '@/types';

export type Reply =
  | {
      kind:
        | 'success'
        | 'hold'
        | 'timeout'
        | 'network'
        | 'mismatch'
        | 'empty'
        | 'invalid'
        | 'string'
        | 'missing-status';
    }
  | { kind: 'upstream' | 'management'; status: number };
export type Identity =
  | 'shared'
  | 'no-email'
  | 'mixed'
  | 'workspace'
  | 'missing-index'
  | 'missing-account'
  | 'zero'
  | 'camel'
  | 'long';
export interface Scenario {
  id: string;
  group: string;
  title: string;
  expected: string;
  steps: string;
  replies: Reply[];
  initial?: 'allowed' | 'blocked' | 'yesterday' | 'unconfirmed-allow' | 'unconfirmed-block';
  identity?: Identity;
  quota?: 'idle' | 'loading' | 'error';
  credits?: 'zero' | 'unlimited' | 'missing';
  siwc?: 'bound' | 'unbound';
  disabled?: boolean;
}
const scene = (
  id: string,
  group: string,
  title: string,
  expected: string,
  extra: Partial<Scenario> = {}
): Scenario => ({
  id,
  group,
  title,
  expected,
  steps:
    '点击第一张卡片的“设置”，选择“允许使用 Credit”或“不允许使用 Credit”，再点击“保存”。仅点选不应发 PATCH。',
  replies: [{ kind: 'success' }],
  ...extra,
});
export const SCENARIOS: Scenario[] = [
  scene(
    'unknown',
    '基本状态',
    '初始未知 / 成功允许与禁止',
    '未知时不预选且保存禁用；点选后关闭重开仍不预选；保存成功后同账号卡片及重开的表单显示已确认结果。'
  ),
  scene(
    'allowed',
    '基本状态',
    '已确认允许 → 禁止',
    '初始预选“允许”；选择“不允许使用 Credit”并保存后，两张卡片均变为“不允许”。',
    { initial: 'allowed' }
  ),
  scene(
    'blocked',
    '基本状态',
    '已确认禁止 → 允许',
    '初始预选“不允许”；选择允许并保存后，两张卡片均变为“已允许”。',
    { initial: 'blocked' }
  ),
  scene(
    'yesterday',
    '基本状态',
    '跨日确认时间',
    '确认时间带日期；同日只显示时分；长时间文本不造成横向溢出。',
    { initial: 'yesterday' }
  ),
  scene(
    'different-account',
    '并发与未决写入',
    '同账号挂起时另一账号独立写入',
    '另一账号应立即写入成功，原账号仍保持写入中；请求索引与账号请求头分别正确。',
    {
      replies: [{ kind: 'hold' }, { kind: 'success' }],
      steps: '第一张选择允许并保存，保持挂起，然后点击上方“另一账号写入”；最后放行 200。',
    }
  ),
  scene(
    'hold',
    '并发与未决写入',
    '手动挂起：关闭保护 / 同账号锁',
    '保存中 Esc、×、两个单选项和保存均禁用；同账号两张卡片一起锁定，其他账号不受影响。',
    {
      replies: [{ kind: 'hold' }],
      steps: '打开第一张卡片，选择允许并保存；尝试 Esc。用上方“放行 200”结束请求。',
    }
  ),
  scene(
    'timeout',
    '并发与未决写入',
    '超时后延迟生效 / 同值重试',
    '第一次超时后只能重试相同值；第二次 200 仍是“结果未知”；延迟写入生效后也不会误显示反向已确认。',
    {
      replies: [{ kind: 'timeout' }, { kind: 'success' }],
      steps:
        '选择允许并保存 → 结果未知 → 再次保存 → 点击上方“延迟写入生效”。反向选项应始终禁用，关闭重开不预选。',
    }
  ),
  scene(
    'unknown-allow',
    '并发与未决写入',
    '预置允许未决 / 重新打开',
    '允许可重试，禁止不可用；仅一处未决说明；同值成功也不清除保护。',
    { initial: 'unconfirmed-allow' }
  ),
  scene(
    'unknown-block',
    '并发与未决写入',
    '预置禁止未决 / 对称保护',
    '禁止可重试，允许不可用；同值成功后仍保留未决保护。',
    { initial: 'unconfirmed-block' }
  ),
  scene(
    'retry-forbidden',
    '并发与未决写入',
    '未决后同值重试 403',
    '403 显示明确错误，但先前未决状态和反向保护保留。',
    { initial: 'unconfirmed-allow', replies: [{ kind: 'upstream', status: 403 }] }
  ),
  scene(
    'no-email',
    '身份与凭证',
    '同账号两个无邮箱凭证',
    '即使文件名不同也共用账号锁；两张卡片显示写入中；另一账号不受影响。',
    {
      identity: 'no-email',
      replies: [{ kind: 'hold' }],
      steps:
        '第一张选择允许并保存，保持挂起并观察两张卡片；上方“并发重入探针”也不得产生第二次同账号 PATCH。',
    }
  ),
  scene(
    'mixed-email',
    '身份与凭证',
    '同账号有邮箱 / 无邮箱混合',
    '缺少邮箱的副本不能绕过已知用户的账号锁；旧快照保守失效。',
    { identity: 'mixed', replies: [{ kind: 'hold' }] }
  ),
  scene(
    'workspace',
    '身份与凭证',
    '同工作区两个不同用户',
    '写入按账号串行；确认快照不借用其他用户的邮箱身份。',
    { identity: 'workspace' }
  ),
  scene(
    'missing-index',
    '身份与凭证',
    '缺失 authIndex',
    '第一张无法加载额度/设置；“前置校验探针”返回 missing_auth_index，PATCH 数为零。',
    { identity: 'missing-index' }
  ),
  scene(
    'missing-account',
    '身份与凭证',
    '缺失 ChatGPT Account ID',
    '第一张可显示读取到的额度，但不显示超额设置入口；前置校验拒绝，PATCH 数为零。',
    { identity: 'missing-account' }
  ),
  scene(
    'zero-index',
    '身份与凭证',
    '数字 0 的 authIndex',
    '0 被规范化为字符串 "0" 并用于被点击卡片的请求，不误判缺失。',
    { identity: 'zero' }
  ),
  scene(
    'camel-index',
    '身份与凭证',
    'camelCase authIndex / ID token 账号',
    '请求使用 camelCase 索引；从 id_token 解析账号并带正确账号请求头。',
    { identity: 'camel' }
  ),
  scene(
    'long-label',
    '身份与凭证',
    '超长邮箱与文件名',
    '320px / 390px 下标题、账号和风险说明可换行，无横向溢出。',
    { identity: 'long' }
  ),
  ...[401, 403, 404, 405, 429, 400, 409, 500, 502, 503].map((status) =>
    scene(
      `upstream-${status}`,
      '上游错误',
      `ChatGPT HTTP ${status}`,
      status >= 500
        ? '结果标为未知；保留账号级未决写入保护。'
        : '对话框显示对应错误；此前确认值保持不变；上游 401 不应登出管理中心。',
      { initial: 'blocked', replies: [{ kind: 'upstream', status }] }
    )
  ),
  ...[400, 401, 403, 404, 429, 502, 503].map((status) =>
    scene(
      `management-${status}`,
      '管理端与网络',
      `CPA 外层 HTTP ${status}`,
      status === 401
        ? '当前管理端 401 触发当前会话退出；不是 ChatGPT 上游 401。'
        : status >= 500
          ? '转发结果不确定，标为结果未知并保护后续写入。'
          : '管理端拒绝发生在转发前，保持之前确认值。',
      { initial: 'blocked', replies: [{ kind: 'management', status }] }
    )
  ),
  scene(
    'network',
    '管理端与网络',
    '网络断开 / 无 HTTP 状态',
    '不能确认是否已经转发；显示结果未知并保留保护。',
    { replies: [{ kind: 'network' }] }
  ),
  ...(['mismatch', 'empty', 'invalid', 'string', 'missing-status'] as const).map((kind) =>
    scene(
      `body-${kind}`,
      '异常响应',
      {
        mismatch: '200 返回相反布尔值',
        empty: '204 / 空响应体',
        invalid: '200 / 无效 JSON',
        string: '200 / 字符串 "true"',
        'missing-status': '外层缺失 status_code',
      }[kind],
      '不把异常响应当作成功；结果未知，禁止反向设置。',
      { replies: [{ kind }] }
    )
  ),
  ...[
    ['connection', '切换连接后旧 401', '切换连接'],
    ['aba', 'A → B → A 后旧结果', 'A → B → A'],
    ['session', '同连接重新登录后旧结果', '新会话'],
    ['cache', '写入时清理全部额度缓存', '清理全部额度'],
    ['delete', '删除一个凭证仍保留账号保护', '删除首凭证'],
    ['replace', '打开对话框后凭证身份变化', '替换首凭证身份'],
  ].map(([id, title, action]) =>
    scene(
      `race-${id}`,
      '连接与生命周期',
      title,
      id === 'cache'
        ? '清理额度不解锁写入；旧结果不能回填新缓存，结束后保留未决保护。'
        : id === 'delete'
          ? '另一个凭证仍观察同账号的锁和结果；删除文件不改变真实账号设置。'
          : id === 'replace'
            ? '旧对话框提示凭证变化，两个写入选项不可用，不发送替换用户的 PATCH。'
            : '请求保留原连接地址与密钥；旧 401 不登出新会话，旧版本/插件事件不污染新会话。',
      {
        replies: [{ kind: 'hold' }],
        steps:
          id === 'replace'
            ? `打开第一张设置但先不提交，然后点上方“${action}”。`
            : `第一张选择允许并保存 → 上方“${action}” → “返回旧 401”或“放行 200”。查看事件、登录状态及请求原连接。`,
      }
    )
  ),
  scene(
    'idle',
    '展示与边界',
    '额度尚未加载',
    '初始没有 Credit 设置行；手动刷新额度只发 GET，不发 PATCH。',
    { quota: 'idle' }
  ),
  scene('loading', '展示与边界', '额度加载中', '加载过程中不显示可写设置入口。', {
    quota: 'loading',
  }),
  scene('quota-error', '展示与边界', '额度读取失败', '显示额度错误；不出现可写设置入口。', {
    quota: 'error',
  }),
  scene(
    'disabled',
    '展示与边界',
    '凭证禁用时的卡片行为',
    '卡片级入口禁用；真实配额列表会过滤禁用凭证。',
    { disabled: true }
  ),
  scene('zero-credits', '展示与边界', 'Credit 余额为 0', '正确显示 0，不把余额当开关状态。', {
    credits: 'zero',
  }),
  scene('unlimited', '展示与边界', 'Credit 无限', '显示无限额度，开关仍保持未知直到明确写入。', {
    credits: 'unlimited',
  }),
  scene(
    'missing-credits',
    '展示与边界',
    '无 Credit 余额字段',
    '余额未知时省略该字段，不猜测余额或开关。',
    { credits: 'missing' }
  ),
  scene(
    'siwc-bound',
    '展示与边界',
    'SIWC 已绑定但未开启',
    '弹窗不展示与本次设置无关的绑定信息；仍使用外层 Codex token 占位符。',
    { siwc: 'bound' }
  ),
  scene(
    'siwc-unbound',
    '展示与边界',
    'SIWC 未绑定',
    '不展示无关的绑定状态；设置的账号影响范围和扣费后果仍明确可见。',
    { siwc: 'unbound' }
  ),
];
export const findScenario = (id: string | null) =>
  SCENARIOS.find((item) => item.id === id) ?? SCENARIOS[0];
export const buildFiles = (scenario: Scenario): AuthFileItem[] => {
  const base: AuthFileItem = {
    name: 'codex-a.json',
    type: 'codex',
    provider: 'codex',
    auth_index: 'mock-a',
    email: 'review@example.invalid',
    chatgpt_account_id: 'mock-account-a',
    plan_type: 'pro',
    siwcBindSupported: true,
    useSiwc: true,
    siwcBound: true,
  };
  const files: AuthFileItem[] = [
    base,
    {
      ...base,
      name: 'codex-copy.json',
      auth_index: 'mock-copy',
      email: ' REVIEW@EXAMPLE.INVALID ',
    },
    {
      ...base,
      name: 'other-account.json',
      auth_index: 'mock-other',
      email: 'other@example.invalid',
      chatgpt_account_id: 'mock-account-b',
    },
  ];
  if (scenario.identity === 'no-email') {
    delete files[0].email;
    delete files[1].email;
  }
  if (scenario.identity === 'mixed') delete files[1].email;
  if (scenario.identity === 'workspace') files[1].email = 'workspace-member@example.invalid';
  if (scenario.identity === 'missing-index') delete files[0].auth_index;
  if (scenario.identity === 'missing-account') delete files[0].chatgpt_account_id;
  if (scenario.identity === 'zero') files[0].auth_index = 0;
  if (scenario.identity === 'camel') {
    files[0].authIndex = 'mock-camel';
    delete files[0].auth_index;
    files[0].id_token = { chatgpt_account_id: files[0].chatgpt_account_id };
    delete files[0].chatgpt_account_id;
  }
  if (scenario.identity === 'long') {
    files[0].name = 'codex-very-long-credential-file-for-mobile-accessibility-review.json';
    files[0].email = 'very.long.account.identifier.for.wrapping.verification@example.invalid';
  }
  files[0].disabled = scenario.disabled;
  if (scenario.siwc) {
    files[0].useSiwc = false;
    files[0].siwcBound = scenario.siwc === 'bound';
  }
  return files;
};
