/**
 * Validation and type checking functions for quota management.
 */

import type { AuthFileItem } from '@/types';

export function resolveAuthProvider(file: AuthFileItem): string {
  const raw = file.provider ?? file.type ?? '';
  const key = String(raw).trim().toLowerCase().replace(/_/g, '-');
  if (key === 'x-ai' || key === 'grok') return 'xai';
  if (
    key === 'glm' ||
    key === 'zai' ||
    key === 'z-ai' ||
    key === 'zhipu' ||
    key === 'bigmodel' ||
    key === 'openai-compatible-glm' ||
    key === 'openai-compatible-zai' ||
    key === 'openai-compatible-z-ai' ||
    key === 'openai-compatible-zhipu' ||
    key === 'openai-compatible-bigmodel'
  ) {
    return 'glm';
  }
  return key;
}

export function isAntigravityFile(file: AuthFileItem): boolean {
  return resolveAuthProvider(file) === 'antigravity';
}

export function isClaudeFile(file: AuthFileItem): boolean {
  return resolveAuthProvider(file) === 'claude';
}

export function isCodexFile(file: AuthFileItem): boolean {
  return resolveAuthProvider(file) === 'codex';
}

export function isKimiFile(file: AuthFileItem): boolean {
  return resolveAuthProvider(file) === 'kimi';
}

export function isGlmFile(file: AuthFileItem): boolean {
  return resolveAuthProvider(file) === 'glm';
}

export function isXaiFile(file: AuthFileItem): boolean {
  return resolveAuthProvider(file) === 'xai';
}

export function isDisabledAuthFile(file: AuthFileItem): boolean {
  const raw = (file as { disabled?: unknown }).disabled;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') return raw.trim().toLowerCase() === 'true';
  return false;
}
