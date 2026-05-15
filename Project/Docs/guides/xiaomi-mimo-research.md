# Xiaomi MIMO 模型接入调研

> 日期: 2026-05-15 | 状态: 调研完成，待澄清 API 细节

## 调研结论

### 参考仓库中无实现

在 cockpit-tools、codex2api、sub2api、Kiro-account-manager、CLIProxyAPI 五个参考仓库中，**没有任何 Xiaomi MIMO 相关代码**。

唯一相关的引用是 cockpit-tools 中的一个遗留测试桩 (`codex_account.rs:4636-4672`)，使用占位符 URL `https://mimo.example.com/v1`，仅用于测试旧 provider 配置清理逻辑。

### 测试桩中的 API 特征

| 特性 | 值 |
|------|-----|
| Wire API 格式 | `"responses"` (Anthropic Messages/Responses 格式) |
| 认证方式 | OpenAI 风格 API key (`Authorization: Bearer sk-...`) |
| Base URL | `https://mimo.example.com/v1` (占位符) |
| 端点 | `/v1/responses` (推断) |

### 本项目当前模型分类

`src/utils/models.ts` 中硬编码的供应商分类：GPT/Claude/Gemini/Kimi/Qwen/GLM/Grok/DeepSeek/MiniMax。不匹配任何模式的归入 "Other"。

`src/utils/sourceResolver.ts` 支持五种 source 类型：gemini/claude/codex/vertex/openai。

### 接入方案

取决于 Xiaomi MIMO 的实际 API 格式：

**若为 OpenAI-compatible（Chat Completions）** → 无需修改前端：
- 通过现有 `openaiCompatibility` 配置接入
- 在 `modelPricePresets.ts` 中添加模型价格

**若为 Anthropic Responses 格式** → 需要新增：
- `sourceResolver.ts` 中添加新 type (例如 `'mimo'`)
- `types/provider.ts` 中添加新的 Config 类型
- `models.ts` 中添加分类规则

### 待澄清

- [ ] 获取小米官方 API 文档 URL
- [ ] 确认实际 API 格式（OpenAI Chat Completions 或 Anthropic Responses）
- [ ] 确认认证方式
- [ ] 获取支持的模型列表和定价
