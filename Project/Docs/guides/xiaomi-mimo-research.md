# Xiaomi MiMo 模型接入调研

> 日期: 2026-05-15 | 状态: 调研完成，已确认接入方案

## 结论：真实存在，OpenAI-compatible API

**Xiaomi MiMo 是小米官方的 AI 大模型平台**，非虚构、非 MiniMax/Kimi 的误称。
GitHub 组织 [XiaomiMiMo](https://github.com/XiaomiMiMo) 有 13 个开源仓库，核心模型 2.1K+ stars。

## 模型列表（5 个公开模型）

| Model ID | 名称 | 上下文 | 最大输出 | 发布时间 |
|----------|------|--------|---------|---------|
| `mimo-v2.5-pro` | MiMo-V2.5 Pro | 1M | 131K | 2026-04-22 |
| `mimo-v2.5` | MiMo-V2.5 | 1M | 131K | 2026-04-22 |
| `mimo-v2-pro` | MiMo-V2 Pro | 1M | 131K | 2026-03-18 |
| `mimo-v2-omni` | MiMo-V2 Omni | 262K | 131K | 2026-03-18 |
| `mimo-v2-flash` | MiMo-V2 Flash | 262K | 65K | 2026-03-03 |

## API 端点

| 端点 | Base URL | 协议 |
|------|---------|------|
| OpenAI-compatible | `https://api.xiaomimimo.com/v1` | Chat Completions |
| Anthropic Messages | `https://api.xiaomimimo.com/anthropic` | Messages API |

- 认证：`Bearer $XIAOMI_API_KEY`
- 函数调用：全部支持
- 推理控制：`chat_template_kwargs: { enable_thinking: true/false }`（非标准 `reasoning_effort`）
- 上下文缓存：支持（当前缓存写入免费）

## 官方资源

| 资源 | 链接 |
|------|------|
| 开放平台 | https://platform.xiaomimimo.com |
| API Key 管理 | https://platform.xiaomimimo.com/#/console/api-keys |
| 定价文档 | https://platform.xiaomimimo.com/docs/pricing |
| 技术报告 | https://arxiv.org/abs/2505.07608 |
| HuggingFace | https://huggingface.co/XiaomiMiMo |

## 接入方案（已确认）

**使用现有 `openaiCompatibility` 配置接入**，无需新增 source type：
- `src/utils/models.ts`：已添加 `{ id: 'mimo', label: 'MiMo', patterns: [/mimo/i, /xiaomi/i] }`
- `src/data/modelPricePresets.ts`：待添加定价
- Source type：通过 `openaiCompatibility` → `openai` 识别

推理控制的特殊性（`chat_template_kwargs.enable_thinking`）由后端 CLIProxyAPI 处理，前端无需适配。

## 已集成 MiMo 的项目（验证 API 兼容性）

lobehub, voocel/litellm, Bitterbot-AI/bitterbot-desktop, steipete/CodexBar, openclaw/openclaw, continuedev/continue, 1Panel-dev/1Panel, NextChat, lobe-chat, ChatGPT-Next-Web 等数十个项目均已集成。
