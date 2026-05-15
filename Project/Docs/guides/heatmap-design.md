# API Key x Model Heatmap 组件设计

## 1 目标

在 MonitorPage 中追加一个热力图组件，以 CSS Grid 展示 API Key（行）与 Model（列）交叉维度的用量强度。P0 优先级，参考 cpa-usage-keeper v1.7.2 的实现思路，但完全适配 CPA-Dashboard-kelen 的代码风格和主题系统。

---

## 2 组件接口设计

### 2.1 组件定义

```typescript
// 文件位置: src/components/monitor/ApiKeyModelHeatmap.tsx
// SCSS: src/components/monitor/ApiKeyModelHeatmap.module.scss
// index 导出: src/components/monitor/index.ts

interface HeatmapCell {
  /** 聚合度量值（如 total_tokens 总和） */
  value: number;
  /** 请求总数 */
  totalRequests: number;
  /** 成功次数 */
  successCount: number;
  /** 失败次数 */
  failureCount: number;
  /** 最近一次请求时间戳 (ms) */
  lastTimestamp: number;
  /** 该 cell 为空（无对应维度组合的数据） */
  isEmpty: boolean;
}

interface HeatmapRow {
  /** API Key 的标准化 source 标识 */
  source: string;
  /** 显示名称（已脱敏/渠道名） */
  displayName: string;
  /** 按 modelName → cell 的映射 */
  cells: Record<string, HeatmapCell>;
  /** 该行所有 cell 的总请求数 */
  totalRequests: number;
  /** 该行所有 cell 的总 token 数 */
  totalTokens: number;
}

interface ApiKeyModelHeatmapProps {
  /** 由 MonitorPage 传入的 CollectUsageDetails 结果 */
  details: UsageDetail[];
  /** 渠道名 → providerName 映射 */
  providerMap: Record<string, string>;
  /** sourceInfo 映射 */
  sourceInfoMap: Map<string, SourceInfo>;
  /** 凭证映射 */
  authFileMap?: Map<string, CredentialInfo>;
  /** 聚合度量: 'tokens' | 'requests'（默认 tokens） */
  metric?: 'tokens' | 'requests';
  /** 最大展示的 API Key 行数（超出部分折叠） */
  maxRows?: number;
  /** 最大展示的 Model 列数（超出部分折叠） */
  maxCols?: number;
  /** 加载中状态 */
  loading?: boolean;
}
```

### 2.2 MonitorPage 集成签名

```typescript
// MonitorPage 中新增 import
import { ApiKeyModelHeatmap } from '@/components/monitor';

// 传入 collectUsageDetails 的结果
const usageDetails = useMemo(
  () => collectUsageDetails(filteredData),
  [filteredData]
);

// 在 JSX 中放置位置：介于 statsGrid 和 RequestLogs 之间
<div className={styles.chartsGrid}>
  <Card title={t('monitor.heatmap.title')} subtitle={t('monitor.heatmap.subtitle')}>
    <ApiKeyModelHeatmap
      details={usageDetails}
      providerMap={providerMap}
      sourceInfoMap={sourceInfoMap}
      authFileMap={authFileMap}
      metric="tokens"
      maxRows={20}
      maxCols={15}
      loading={isLoading}
    />
  </Card>
</div>
```

---

## 3 数据聚合逻辑

### 3.1 核心聚合函数

新增纯函数文件 `src/utils/heatmap.ts`：

```typescript
/**
 * 构建 API Key x Model 热力图矩阵
 *
 * 输入: UsageDetail[]（来自 collectUsageDetails 的平面化明细）
 * 输出: HeatmapRow[]（按 totalTokens 降序排列的行；列按模型名称字母序）
 *
 * 算法:
 * 1. 遍历 details，以 (source, __modelName) 为复合键分组
 * 2. 对每组累加: total_tokens, 请求计数, 成功/失败计数, 最大 timestamp
 * 3. 收集所有出现过的 modelName 作为列集合
 * 4. 按 source 分组产出 HeatmapRow，每行包含所有模型列（缺失 = {isEmpty: true}）
 * 5. 按 totalTokens 降序排列行
 * 6. 对行名做脱敏/渠道名解析（复用 resolveSourceDisplay / getProviderDisplayParts）
 */
function buildHeatmapMatrix(details: UsageDetail[]): {
  rows: HeatmapRow[];
  models: string[];
} { ... }
```

### 3.2 分组逻辑详解

```
对于每条 UsageDetail:
  rowKey = normalizeSourceId(detail.source)
  colKey = detail.__modelName || 'Unknown'
  矩阵[rowKey][colKey] += {
    value: metric === 'tokens' ? detail.tokens.total_tokens : 1
    totalRequests: 1
    successCount: detail.failed ? 0 : 1
    failureCount: detail.failed ? 1 : 0
    lastTimestamp: max(timestamp)
  }
```

### 3.3 行排序策略

默认按 `totalTokens` 降序排列（总量大的排在最前）。建议在组件内部通过 `useMemo` 管理排序态，并后续扩展按自定义字段排序能力。

### 3.4 行名解析

复用 MonitorPage 已有的 `providerMap`、`sourceInfoMap`、`authFileMap`，调用 `resolveSourceDisplay()` + `getProviderDisplayParts()` 获取脱敏后的显示名。逻辑与 `ChannelStats` 中的 `displayName` 构建一致。

---

## 4 CSS Grid 布局方案

### 4.1 网格结构

```
┌─────────────────────────────────────────────────────────┐
│                   表头行 (固定)                          │
│  (空角标)  │ Model A │ Model B │ Model C │ ... │ 行汇总 │
├───────────┼─────────┼─────────┼─────────┼─────┼───────┤
│ Key-1     │  ████   │  ██     │  ██████ │ ... │ 12.3K │
│ Key-2     │  ██     │  ████   │  ██     │ ... │  5.1K │
│ Key-3     │  █     │  ██████ │  ██     │ ... │  8.7K │
│ ...       │  ...    │  ...    │  ...    │ ... │  ...  │
├───────────┼─────────┼─────────┼─────────┼─────┼───────┤
│ 列汇总    │ 15.2K   │ 18.6K   │ 20.1K   │ ... │ 总和   │
└─────────────────────────────────────────────────────────┘
```

### 4.2 CSS Grid 定义

```scss
// 使用 display: grid; + grid-template-columns 构建
// 首列固定宽度为行标题，中间列等分，末列固定宽度为行汇总

.heatmapGrid {
  display: grid;
  grid-template-columns:
    180px                                   // 行标题列
    repeat(var(--heatmap-col-count, 5), 1fr) // 等分模型列
    80px;                                   // 行汇总列
  gap: 2px;
  font-size: 12px;
}
```

### 4.3 表头行

第一行是固定的表头行，`position: sticky; top: 0;`。最左侧角标为空，中间列显示模型名称，右侧为汇总列标题。模型名称过长时使用 `text-overflow: ellipsis` 截断，hover 时 tooltip 显示全名。

### 4.4 单元格渲染

```scss
.cell {
  width: 100%;
  aspect-ratio: 1;          // 正方形单元格
  border-radius: $radius-sm; // 4px 圆角
  cursor: pointer;
  position: relative;
  transition: opacity $transition-fast;

  &:hover {
    opacity: 0.85;
    // outline 替代 border 以避免布局偏移
    outline: 2px solid var(--text-primary);
    outline-offset: -2px;
  }
}
```

### 4.5 行标题列

行标题列左对齐，显示脱敏后的 API Key 名称（如 `provider-name (sk-***abc)`），支持 `text-overflow: ellipsis`。如果该行没有数据（全部为空），显示半透明。

### 4.6 汇总列

最右侧汇总列显示该行总 token 数或总请求数（紧凑格式，如 `12.3K`），只读不可点击。底部汇总行显示各列的总和。

### 4.7 空单元格

该 API Key 未使用某模型时，该 cell 以极低透明度（`opacity: 0.08`）的占位色块展示。

---

## 5 颜色映射方案

### 5.1 强度色阶（适配主题系统）

不在 SCSS 中硬编码颜色，而是通过 CSS 自定义属性定义热力色的 6 级色阶，在 `themes.scss` 中为 light/dark 分别覆盖。

```scss
// themes.scss — 浅色主题 (:root)
:root {
  --heatmap-level-0: rgba(0, 0, 0, 0.04);   // 空/极低
  --heatmap-level-1: #fef3c7;                // yellow-50  极轻度
  --heatmap-level-2: #fde68a;                // yellow-200 轻度
  --heatmap-level-3: #fbbf24;                // amber-400  中度
  --heatmap-level-4: #f97316;                // orange-500 重度
  --heatmap-level-5: #dc2626;                // red-600    极重度
}

// themes.scss — 深色主题 [data-theme='dark']
[data-theme='dark'] {
  --heatmap-level-0: rgba(255, 255, 255, 0.04);
  --heatmap-level-1: #713f12;                // yellow-900
  --heatmap-level-2: #a16207;                // yellow-700
  --heatmap-level-3: #d97706;                // amber-600
  --heatmap-level-4: #ea580c;                // orange-600
  --heatmap-level-5: #dc2626;                // red-600
}
```

如果项目规范不允许在 themes.scss 直接追加热力色，也可以在组件 SCSS 模块中用 `:root` / `[data-theme='dark']` 声明。

### 5.2 强度量化算法

基于指定 metric 的聚合值计算强度等级（0-5）：

```typescript
function getHeatLevel(value: number, min: number, max: number): number {
  if (max === 0 || value === 0) return 0;
  // 使用对数映射避免极端值带来的视觉扁平化
  const normalized = Math.log1p(value) / Math.log1p(max);
  return Math.min(Math.floor(normalized * 5) + 1, 5);
}
```

### 5.3 颜色应用

每个 cell 通过 `style={{ backgroundColor: 'var(--heatmap-level-N)' }}` 动态应用（N = 1-5）。空 cell 使用 `var(--heatmap-level-0)`。

---

## 6 交互设计

### 6.1 Tooltip（CSS 原生方案）

为每个 cell 添加 `data-tooltip` 属性 + CSS `::after` 伪元素 tooltip：

```scss
.cell {
  position: relative;

  &::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 10px;
    border-radius: $radius-md;
    background: var(--floating-surface, #fffdf9);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    font-size: 11px;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity $transition-fast;
    z-index: $z-tooltip;
    box-shadow: var(--floating-shadow);
  }

  &:hover::after {
    opacity: 1;
  }
}
```

Tooltip 内容示例，使用多行数据属性：

```
data-tooltip-line1="Model: claude-sonnet-4-20250514"
data-tooltip-line2="Tokens: 245,321"
data-tooltip-line3="Requests: 1,234 (98.5% success)"
data-tooltip-line4="Last: 2026-05-16 14:30:22"
```

通过 `::after` + `\A` + `white-space: pre-line` 实现多行显示。如果更复杂，考虑用 React Portal + 悬浮事件实现浮层组件，但优先使用纯 CSS 方案以保持简洁。

### 6.2 点击行为

点击 cell → 触发 `onCellClick` 回传 `(source, modelName, cellData)` → 可联动 `RequestLogs` 组件进行过滤。

MonitorPage 中持有 `heatmapFilter` state，设置为 `{ source: string; model: string } | null`。点击 cell 时设置该状态，同时将 `apiFilter` 置为空（开始新的过滤）。RequestLogs 组件检测到 `heatmapFilter` 非 null 时，优先使用该过滤条件。

### 6.3 响应式

| 断点 | 行为 |
|------|------|
| >1024px | 完整网格，最多 15 列 |
| 768-1024px | 最大 10 列，5 行（超出折叠 + "Show more" 按钮） |
| <768px | 不展示热力图（因为移动端网格太小无法交互），显示提示文字或改用折叠表格 |

折叠策略：

```typescript
const [showAllRows, setShowAllRows] = useState(false);
const [showAllCols, setShowAllCols] = useState(false);

const visibleRows = showAllRows ? rows : rows.slice(0, responsiveMaxRows);
const visibleModels = showAllCols ? models : models.slice(0, responsiveMaxCols);
```

折叠控制按钮使用项目已有的 Button 组件（variant="secondary", size="sm"）。

### 6.4 度量切换

Card 右上角增加度量切换按钮（与 `TimeRangeSelector` 模式相同）：
- "Tokens" / "Requests"

切换后 heatmap 颜色基于新度量重新映射。

---

## 7 集成到 MonitorPage 的方案

### 7.1 文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/components/monitor/ApiKeyModelHeatmap.tsx` | 新增 | 组件实现 |
| `src/components/monitor/ApiKeyModelHeatmap.module.scss` | 新增 | 组件样式 |
| `src/utils/heatmap.ts` | 新增 | 矩阵构建纯函数 |
| `src/components/monitor/index.ts` | 修改 | 导出新组件 |
| `src/styles/themes.scss` | 修改 | 追加 `--heatmap-level-N` CSS 自定义属性 |
| `src/pages/MonitorPage.tsx` | 修改 | 集成组件 |
| `src/i18n/locales/en.json` | 修改 | 新增翻译键 |
| `src/i18n/locales/zh-CN.json` | 修改 | 新增翻译键 |

### 7.2 MonitorPage.tsx 改动点

1. 新增 import `ApiKeyModelHeatmap`、`collectUsageDetails`
2. 新增 `useMemo` 计算 `usageDetails`（从 `filteredData`）
3. 新增 `heatmapFilter` state（与日志筛选联动）
4. 在 JSX 的 `statsGrid` 与 `RequestLogs` 之间插入热力图卡片
5. 将 `heatmapFilter` 传递到 `RequestLogs` 作为可选过滤条件

### 7.3 i18n 新增翻译键

```json
{
  "monitor": {
    "heatmap": {
      "title": "API Key × Model Heatmap",
      "subtitle": "Token intensity by API Key and Model",
      "empty": "No data for selected time range",
      "col_total": "Total",
      "row_total": "Total",
      "metric_tokens": "Tokens",
      "metric_requests": "Requests",
      "show_more_rows": "Show all rows ({{count}})",
      "show_less_rows": "Show less",
      "show_more_models": "Show all models ({{count}})",
      "show_less_models": "Show less",
      "mobile_fallback": "Heatmap is not available on mobile devices"
    }
  }
}
```

### 7.4 性能考虑

- `buildHeatmapMatrix` 在 `useMemo` 中执行，依赖 `details` 数组引用
- `details` 本身由 `collectUsageDetails(filteredData)` 在 `useMemo` 中产出
- 如果 details 量大（>5000 条），考虑在 `heatmap.ts` 中增加 `requestAnimationFrame` 分批渲染矩阵构建
- CSS Grid 渲染 cell 数量 = rows * cols，最大 20*15=300 个 DOM 节点，性能风险低
- model 列的缩减策略（`maxCols`）可以将主要模型保留，次要模型归入 "Other" 列

### 7.5 连接 RequestLogs 筛选

```typescript
// MonitorPage 新增
const [heatmapFilter, setHeatmapFilter] = useState<{
  source: string;
  model: string;
} | null>(null);

// 传递给 ApiKeyModelHeatmap
<ApiKeyModelHeatmap
  details={usageDetails}
  onCellClick={(source, model) => setHeatmapFilter({ source, model })}
  ...
/>

// 传递给 RequestLogs
<RequestLogs
  heatmapFilter={heatmapFilter}
  onClearHeatmapFilter={() => setHeatmapFilter(null)}
  ...
/>
```

---

## 8 风险与注意事项

1. **颜色无障碍对比度**：Level-1（最弱色）需确保在浅色模式下与背景色有足够区分度。Level-5（最强色）在深色模式下红色底色需调整亮度，避免过曝。建议验证 WCAG 2.1 AA 标准的非文本对比度（3:1）。
2. **行名脱敏一致性**：行名的脱敏逻辑必须与 ChannelStats 的 `displayName` 构建一致，否则用户会困惑。
3. **空数据边界**：当 filteredData 为 null 或 details 为空时，组件应渲染空状态提示而非空白网格。
4. **Tooltip 溢出边界**：当 cell 靠近视口底部或右侧时，tooltip 可能被截断。需要检测位置后自动转换方向（往上溢出改为往下、往左溢出改为往右）。
5. **vs chart.js 替代**：不采用 chart.js 的 matrix/heatmap 插件是为了保持组件简洁、减少依赖、避免 chart.js 注册的额外负担。CSS Grid 渲染更直接可控。

---

## 9 实现顺序建议

1. `src/utils/heatmap.ts` — 先编写并单元测试矩阵构建逻辑
2. `src/styles/themes.scss` — 追加 CSS 自定义属性
3. `src/components/monitor/ApiKeyModelHeatmap.module.scss` — 样式
4. `src/components/monitor/ApiKeyModelHeatmap.tsx` — 组件实现
5. `src/components/monitor/index.ts` — 导出
6. i18n 翻译键
7. `src/pages/MonitorPage.tsx` — 集成
