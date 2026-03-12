# API 健康评分 & SLA 监控商业化方案

## 一、方案概述

### 1.1 产品定位

在 Usage 页面 Token 效率卡片旁边新增两个商业化卡片：
- **API 健康评分卡片** - 服务质量可视化
- **SLA 监控卡片** - 服务承诺与合规

### 1.2 目标用户

| 用户类型 | 痛点 | 价值 |
|---------|------|------|
| 企业客户 | 需要服务质量保障 | SLA 承诺、赔偿机制 |
| 运维团队 | 监控服务健康状态 | 实时评分、预警通知 |
| 财务部门 | 成本与服务匹配 | 服务质量审计 |

---

## 二、API 健康评分卡片设计

### 2.1 卡片布局

```
┌─────────────────────────────────────────────┐
│ 🏥 API 健康评分                              │
├─────────────────────────────────────────────┤
│                                             │
│         综合评分                             │
│           94                                │
│          ━━━                                │
│         🟢 优秀                             │
│                                             │
├─────────────────────────────────────────────┤
│  成功率      98.2%   ████████░░  优秀       │
│  稳定性      92.0%   ███████░░░  良好       │
│  响应性      95.0%   ████████░░  优秀       │
├─────────────────────────────────────────────┤
│  本周无重大故障 · 连续运行 7 天              │
└─────────────────────────────────────────────┘
```

### 2.2 评分算法

```typescript
interface HealthScore {
  overall: number;           // 综合评分 0-100
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  metrics: {
    successRate: {
      value: number;         // 成功率 0-1
      score: number;         // 得分 0-100
      grade: string;         // 等级
    };
    stability: {
      value: number;         // 稳定性（基于错误波动）
      score: number;
      grade: string;
    };
    responsiveness: {
      value: number;         // 响应性（基于请求分布）
      score: number;
      grade: string;
    };
  };
  trend: 'up' | 'stable' | 'down';
  consecutiveDays: number;   // 连续无故障天数
}
```

**评分权重**：
| 指标 | 权重 | 计算方式 |
|-----|------|---------|
| 成功率 | 50% | success_count / total_requests |
| 稳定性 | 30% | 1 - (错误率标准差 / 平均错误率) |
| 响应性 | 20% | 基于请求时间分布均匀度 |

**等级划分**：
| 分数范围 | 等级 | 显示颜色 |
|---------|------|---------|
| 90-100 | 优秀 | 🟢 绿色 |
| 70-89 | 良好 | 🟡 黄色 |
| 50-69 | 一般 | 🟠 橙色 |
| 0-49 | 较差 | 🔴 红色 |

### 2.3 数据来源

```typescript
// 现有数据
usage?.success_count      // 成功请求数
usage?.failure_count      // 失败请求数
usage?.total_requests     // 总请求数

// 需要新增计算
// 1. 按时间段统计成功率变化（计算稳定性）
// 2. 请求时间分布（计算响应性）
```

---

## 三、SLA 监控卡片设计

### 3.1 卡片布局

```
┌─────────────────────────────────────────────┐
│ 🎯 SLA 监控                                  │
├─────────────────────────────────────────────┤
│  套餐等级     Pro ⭐                         │
│  SLA 承诺    99.9% 可用性                   │
├─────────────────────────────────────────────┤
│  本月可用性   99.7%                         │
│  ████████████████████░░░░  达标             │
│                                             │
│  请求成功率   98.2%  ✅ 达标                 │
│  错误恢复     15min  ✅ 达标                 │
│  响应时间     P95<3s ⚠️ 接近上限             │
├─────────────────────────────────────────────┤
│  📊 本月SLA状态: 🟢 正常                     │
│  剩余容错时间: 43分钟                        │
└─────────────────────────────────────────────┘
```

### 3.2 SLA 指标体系

```typescript
interface SLAMetrics {
  tier: 'free' | 'basic' | 'pro' | 'enterprise';
  commitments: {
    availability: {
      target: number;        // 承诺可用性 99.9%
      current: number;       // 当前可用性
      status: 'met' | 'at_risk' | 'breached';
    };
    successRate: {
      target: number;        // 承诺成功率 99%
      current: number;
      status: 'met' | 'at_risk' | 'breached';
    };
    responseTime: {
      target: number;        // P95 < 3s
      current: number;
      status: 'met' | 'at_risk' | 'breached';
    };
    recoveryTime: {
      target: number;        // 恢复时间 < 15min
      current: number;
      status: 'met' | 'at_risk' | 'breached';
    };
  };
  remainingBudget: {
    downtime: number;        // 剩余容错时间（分钟）
    errors: number;          // 剩余容错错误数
  };
  compensation: {
    eligible: boolean;       // 是否符合赔偿条件
    amount: number;          // 赔偿金额
    percentage: number;      // 赔偿比例
  };
}
```

### 3.3 套餐等级与 SLA 承诺

| 套餐 | 可用性承诺 | 成功率承诺 | 响应时间 | 赔偿机制 |
|-----|-----------|-----------|---------|---------|
| Free | 无 | 无 | 无 | 无 |
| Basic | 99% | 95% | P95 < 5s | 无 |
| Pro | 99.9% | 99% | P95 < 3s | 10% 月费 |
| Enterprise | 99.99% | 99.9% | P95 < 1s | 按协议 |

### 3.4 赔偿计算规则

```typescript
// Pro 套餐赔偿规则
const compensationRules = {
  '99.0-99.9%': { percentage: 0, description: '达标' },
  '95.0-99.0%': { percentage: 10, description: '赔偿 10% 月费' },
  '90.0-95.0%': { percentage: 25, description: '赔偿 25% 月费' },
  '<90.0%': { percentage: 50, description: '赔偿 50% 月费' }
};
```

---

## 四、商业化策略

### 4.1 功能分层

| 功能 | Free | Basic | Pro | Enterprise |
|-----|------|-------|-----|------------|
| 健康评分基础版 | ✅ | ✅ | ✅ | ✅ |
| 健康评分历史趋势 | ❌ | ✅ | ✅ | ✅ |
| 健康评分预警 | ❌ | ❌ | ✅ | ✅ |
| SLA 基础监控 | ❌ | ✅ | ✅ | ✅ |
| SLA 承诺与赔偿 | ❌ | ❌ | ✅ | ✅ |
| 自定义 SLA 指标 | ❌ | ❌ | ❌ | ✅ |
| 专属 SLA 报告 | ❌ | ❌ | ❌ | ✅ |

### 4.2 转化路径

```
Free 用户
    ↓ 看到健康评分，发现服务不稳定
    ↓ 提示"升级 Pro 获取 SLA 保障"
Basic 用户
    ↓ SLA 接近红线，收到预警
    ↓ 提示"升级 Pro 获取赔偿保障"
Pro 用户
    ↓ 享受 SLA 保障，建立信任
    ↓ 推荐 Enterprise 定制化服务
```

### 4.3 收费建议

| 套餐 | 月费 | SLA 价值点 |
|-----|------|-----------|
| Basic | $29 | 基础监控 + 可视化 |
| Pro | $99 | SLA 承诺 + 赔偿保障 |
| Enterprise | $299+ | 定制 SLA + 专属支持 |

---

## 五、技术实现方案

### 5.1 文件结构

```
src/
├── components/usage/
│   ├── StatCards.tsx          # 修改：添加两个新卡片
│   ├── HealthScoreCard.tsx    # 新增：健康评分卡片
│   ├── SLAMonitorCard.tsx     # 新增：SLA 监控卡片
│   └── StatCards.module.scss  # 修改：添加样式
├── utils/usage/
│   ├── healthScore.ts         # 新增：健康评分计算
│   └── slaCalculator.ts       # 新增：SLA 指标计算
├── stores/
│   └── useSubscriptionStore.ts # 新增：订阅状态管理
└── i18n/locales/
    └── zh-CN.json              # 修改：添加国际化文案
```

### 5.2 核心计算函数

**健康评分计算**：
```typescript
// utils/usage/healthScore.ts
export function calculateHealthScore(
  successCount: number,
  failureCount: number,
  timeSeriesData: TimeSeriesPoint[]
): HealthScore {
  const totalRequests = successCount + failureCount;
  const successRate = totalRequests > 0 ? successCount / totalRequests : 0;
  
  // 成功率得分 (50%)
  const successRateScore = Math.min(successRate * 100, 100);
  
  // 稳定性得分 (30%) - 基于错误率波动
  const stabilityScore = calculateStability(timeSeriesData);
  
  // 响应性得分 (20%) - 基于请求分布
  const responsivenessScore = calculateResponsiveness(timeSeriesData);
  
  const overall = successRateScore * 0.5 + stabilityScore * 0.3 + responsivenessScore * 0.2;
  
  return {
    overall,
    grade: getGrade(overall),
    metrics: { ... },
    trend: calculateTrend(timeSeriesData),
    consecutiveDays: calculateConsecutiveDays(timeSeriesData)
  };
}
```

**SLA 指标计算**：
```typescript
// utils/usage/slaCalculator.ts
export function calculateSLAMetrics(
  tier: SubscriptionTier,
  usage: UsagePayload,
  timeSeriesData: TimeSeriesPoint[]
): SLAMetrics {
  const tierConfig = SLA_TIERS[tier];
  const currentAvailability = calculateAvailability(timeSeriesData);
  const currentSuccessRate = calculateSuccessRate(usage);
  
  return {
    tier,
    commitments: {
      availability: {
        target: tierConfig.availabilityTarget,
        current: currentAvailability,
        status: getStatus(currentAvailability, tierConfig.availabilityTarget)
      },
      // ... 其他指标
    },
    remainingBudget: calculateRemainingBudget(tier, timeSeriesData),
    compensation: calculateCompensation(tier, currentAvailability)
  };
}
```

### 5.3 实现步骤

#### 第一阶段：基础实现
1. 创建 `HealthScoreCard.tsx` 组件
2. 创建 `SLAMonitorCard.tsx` 组件
3. 实现基础评分算法
4. 添加国际化文案
5. 集成到 `StatCards.tsx`

#### 第二阶段：数据增强
1. 添加时间序列数据支持
2. 实现稳定性计算
3. 实现趋势分析
4. 添加连续运行天数统计

#### 第三阶段：商业化功能
1. 创建订阅状态管理
2. 实现套餐等级判断
3. 添加 SLA 赔偿计算
4. 实现功能分层展示

#### 第四阶段：高级功能
1. 添加预警通知
2. 生成 SLA 报告
3. 自定义 SLA 指标（Enterprise）

---

## 六、UI 设计规范

### 6.1 颜色系统

```scss
// 健康评分颜色
$health-excellent: #22c55e;   // 90-100
$health-good: #84cc16;        // 70-89
$health-fair: #f59e0b;        // 50-69
$health-poor: #ef4444;        // 0-49

// SLA 状态颜色
$sla-met: #22c55e;            // 达标
$sla-at-risk: #f59e0b;        // 接近上限
$sla-breached: #ef4444;       // 违约
```

### 6.2 卡片样式

```scss
.healthScoreCard, .slaMonitorCard {
  grid-column: span 4;
  
  @include tablet {
    grid-column: span 6;
  }
  
  @include mobile {
    grid-column: auto;
  }
}

.scoreRing {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 700;
}

.metricRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-subtle);
  
  &:last-child {
    border-bottom: none;
  }
}
```

---

## 七、风险与应对

| 风险 | 影响 | 应对措施 |
|-----|------|---------|
| 数据不足导致评分不准 | 用户信任度下降 | 显示"数据收集中"状态 |
| SLA 承诺无法兑现 | 赔偿成本 | 设置合理阈值，监控预警 |
| 免费用户转化率低 | 商业化效果差 | 强化 Pro 版差异化价值 |
| 竞品类似功能 | 差异化不足 | 突出赔偿机制、定制化 |

---

## 八、成功指标

| 指标 | 目标 | 衡量方式 |
|-----|------|---------|
| 卡片查看率 | >60% | 埋点统计 |
| Pro 转化率 | >5% | 订阅数据 |
| SLA 预警触发率 | <10% | 系统日志 |
| 用户满意度 | >4.5/5 | NPS 调研 |

---

## 九、总结

本方案通过 **API 健康评分** 和 **SLA 监控** 两个商业化卡片，实现以下价值：

1. **用户价值**：服务质量可视化、透明承诺、赔偿保障
2. **商业价值**：差异化竞争、促进付费转化、建立信任
3. **技术价值**：复用现有数据、渐进式实现、可扩展架构

建议优先实现第一阶段基础功能，验证用户反馈后逐步完善商业化能力。
