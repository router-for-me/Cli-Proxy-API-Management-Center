/**
 * Quota configuration definitions.
 *
 * 数据层在 src/features/quota/providers/&#42;/data.ts（React-free），
 * 渲染体在同目录的 *QuotaBody.tsx（吃类型化 QuotaClassMap，见 features/quota/types.ts）。
 * 本文件把两者组合成旧 UI 消费的完整 QuotaConfig。
 */

import type { ComponentType } from 'react';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  KimiQuotaRow,
  KimiQuotaState,
  XaiBillingSummary,
  XaiQuotaState,
} from '@/types';
import {
  ANTIGRAVITY_CONFIG as ANTIGRAVITY_DATA,
  type AntigravityQuotaData,
} from '@/features/quota/providers/antigravity/data';
import { AntigravityQuotaBody } from '@/features/quota/providers/antigravity/AntigravityQuotaBody';
import {
  CLAUDE_CONFIG as CLAUDE_DATA,
  type ClaudeQuotaData,
} from '@/features/quota/providers/claude/data';
import { ClaudeQuotaBody } from '@/features/quota/providers/claude/ClaudeQuotaBody';
import {
  CODEX_CONFIG as CODEX_DATA,
  type CodexQuotaData,
} from '@/features/quota/providers/codex/data';
import { CodexQuotaBody } from '@/features/quota/providers/codex/CodexQuotaBody';
import { KIMI_CONFIG as KIMI_DATA } from '@/features/quota/providers/kimi/data';
import { KimiQuotaBody } from '@/features/quota/providers/kimi/KimiQuotaBody';
import { XAI_CONFIG as XAI_DATA } from '@/features/quota/providers/xai/data';
import { XaiQuotaBody } from '@/features/quota/providers/xai/XaiQuotaBody';
import type { QuotaProviderData, QuotaStore } from '@/features/quota/providers/types';
import type { QuotaBodyProps } from '@/features/quota/types';
import styles from '@/pages/QuotaPage.module.scss';

export type { QuotaStore };

export interface QuotaConfig<TState, TData> extends QuotaProviderData<TState, TData> {
  cardClassName: string;
  gridClassName: string;
  Body: ComponentType<QuotaBodyProps<TState>>;
}

export const CLAUDE_CONFIG: QuotaConfig<ClaudeQuotaState, ClaudeQuotaData> = {
  ...CLAUDE_DATA,
  cardClassName: styles.claudeCard,
  gridClassName: styles.claudeGrid,
  Body: ClaudeQuotaBody,
};

export const ANTIGRAVITY_CONFIG: QuotaConfig<AntigravityQuotaState, AntigravityQuotaData> = {
  ...ANTIGRAVITY_DATA,
  cardClassName: styles.antigravityCard,
  gridClassName: styles.antigravityGrid,
  Body: AntigravityQuotaBody,
};

export const CODEX_CONFIG: QuotaConfig<CodexQuotaState, CodexQuotaData> = {
  ...CODEX_DATA,
  cardClassName: styles.codexCard,
  gridClassName: styles.codexGrid,
  Body: CodexQuotaBody,
};

export const KIMI_CONFIG: QuotaConfig<KimiQuotaState, KimiQuotaRow[]> = {
  ...KIMI_DATA,
  cardClassName: styles.kimiCard,
  gridClassName: styles.kimiGrid,
  Body: KimiQuotaBody,
};

export const XAI_CONFIG: QuotaConfig<XaiQuotaState, XaiBillingSummary> = {
  ...XAI_DATA,
  cardClassName: styles.xaiCard,
  gridClassName: styles.xaiGrid,
  Body: XaiQuotaBody,
};
