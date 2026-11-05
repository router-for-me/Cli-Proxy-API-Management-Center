/**
 * "Smart config" paste parser for the provider form.
 *
 * Users copy credential snippets from tools such as cc-switch, new-api,
 * OpenAI/Claude clients, curl commands or plain chat messages. This module
 * turns that free text into one or more `{ baseUrl, apiKeys, models, name,
 * prefix }` candidates the provider form can fill in.
 *
 * The parser is intentionally heuristic: it never throws, always returns a
 * best-effort result and surfaces warnings so the UI can ask the user to
 * double-check the extracted values before saving.
 */

import { PROVIDER_DESCRIPTORS } from './descriptors';
import type {
  ApiKeyEntryInput,
  ModelEntryInput,
  ProviderBrand,
  ProviderEntryFormInput,
} from './types';

export type SmartConfigFormat =
  | 'cc-switch'
  | 'new-api'
  | 'claude-code'
  | 'openai'
  | 'curl'
  | 'json'
  | 'key-value'
  | 'text';

export type SmartConfigWarningCode =
  | 'noBaseUrl'
  | 'noApiKey'
  | 'shortApiKey'
  | 'normalizedBaseUrl'
  | 'modelsTruncated';

export interface SmartConfigCandidate {
  baseUrl: string | null;
  apiKeys: string[];
  models: string[];
  name: string | null;
  prefix: string | null;
  warnings: SmartConfigWarningCode[];
}

export interface SmartConfigResult {
  format: SmartConfigFormat;
  candidates: SmartConfigCandidate[];
}

export interface SmartConfigApplySummary {
  baseUrl: boolean;
  apiKeys: number;
  models: number;
  name: boolean;
  prefix: boolean;
  /** Keys beyond what the selected brand can store for a single credential. */
  extraApiKeys: number;
}

/** Upper bound for models filled from a single paste. */
export const MAX_SMART_MODELS = 100;

/* -------------------------------------------------------------------------- */
/* Internal shapes                                                            */
/* -------------------------------------------------------------------------- */

type FieldKind = 'baseUrl' | 'apiKey' | 'name' | 'models' | 'prefix';

interface Draft {
  baseUrls: string[];
  apiKeys: string[];
  models: string[];
  name: string | null;
  prefix: string | null;
  baseUrlTrimmed: boolean;
}

interface UrlMatch {
  start: number;
  end: number;
  value: string;
  score: number;
  trimmed: boolean;
}

/* -------------------------------------------------------------------------- */
/* Field labels                                                               */
/* -------------------------------------------------------------------------- */

const CN_FIELD_ALIASES: Record<string, FieldKind> = {
  基础地址: 'baseUrl',
  接口地址: 'baseUrl',
  服务地址: 'baseUrl',
  请求地址: 'baseUrl',
  地址: 'baseUrl',
  端点: 'baseUrl',
  api地址: 'baseUrl',
  网址: 'baseUrl',
  密钥: 'apiKey',
  令牌: 'apiKey',
  认证令牌: 'apiKey',
  访问令牌: 'apiKey',
  api密钥: 'apiKey',
  名称: 'name',
  渠道名称: 'name',
  模型: 'models',
  模型列表: 'models',
  前缀: 'prefix',
};

const BASE_URL_EXCLUDES =
  /(website|homepage|demo|doc|docs|documentation|icon|logo|avatar|image|redirect|callback|proxy|billing|pricing|status|help|support)/;

const API_KEY_EXCLUDES = /(endpoint|url|base|host|model|channel)/;

/**
 * Map a config label (English/Chinese, snake/kebab/camel case, with optional
 * `export` or provider prefixes) to a logical field kind.
 */
export function fieldKindOf(label: string): FieldKind | null {
  const raw = label.trim().toLowerCase().replace(/^export\s+/, '');
  if (!raw) return null;
  const compact = raw.replace(/[^a-z0-9]+/g, '');
  if (!compact) {
    return CN_FIELD_ALIASES[raw] ?? null;
  }
  const cn = CN_FIELD_ALIASES[raw] ?? CN_FIELD_ALIASES[compact];
  if (cn) return cn;

  if (
    compact === 'url' ||
    compact === 'base' ||
    compact === 'endpoint' ||
    compact === 'gateway' ||
    compact === 'host' ||
    compact.endsWith('baseurl') ||
    compact.endsWith('baseuri') ||
    compact.endsWith('apiurl') ||
    compact.endsWith('apiaddress') ||
    compact.endsWith('apibase') ||
    compact.endsWith('endpoint') ||
    compact.endsWith('serverurl')
  ) {
    return BASE_URL_EXCLUDES.test(compact) ? null : 'baseUrl';
  }

  if (
    compact === 'key' ||
    compact === 'keys' ||
    compact === 'token' ||
    compact === 'secret' ||
    compact === 'apikey' ||
    compact === 'authorization' ||
    compact.endsWith('apikey') ||
    compact.endsWith('apikeys') ||
    compact.endsWith('authtoken') ||
    compact.endsWith('accesstoken') ||
    compact.endsWith('apitoken') ||
    compact.endsWith('authkey') ||
    compact.endsWith('secretkey') ||
    compact.endsWith('password')
  ) {
    return API_KEY_EXCLUDES.test(compact) ? null : 'apiKey';
  }

  if (
    compact === 'name' ||
    compact === 'title' ||
    compact === 'label' ||
    compact.endsWith('providername') ||
    compact.endsWith('channelname') ||
    compact.endsWith('displayname')
  ) {
    return 'name';
  }

  if (
    compact === 'model' ||
    compact === 'models' ||
    compact.endsWith('modellist') ||
    compact.endsWith('modelnames') ||
    compact.endsWith('supportedmodels')
  ) {
    return 'models';
  }

  if (compact === 'prefix' || compact.endsWith('modelprefix') || compact.endsWith('apiprefix')) {
    return 'prefix';
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Scalar helpers                                                             */
/* -------------------------------------------------------------------------- */

const PLACEHOLDER_KEYS = new Set([
  'your-api-key',
  'your_api_key',
  'yourapikey',
  'api-key',
  'apikey',
  'sk-xxx',
  'sk-xxxx',
  'sk-xxxxx',
  'sk-your-key',
  'sk-your-api-key',
  '<api-key>',
  '<your-api-key>',
  'your-key',
  'your-token',
  'changeme',
  'change-me',
  'placeholder',
  'token',
  'key',
  'secret',
  'none',
  'null',
  'undefined',
  'true',
  'false',
  'todo',
  'xxx',
  'xxxx',
  'xxxxx',
]);

const MODEL_NAME_HINTS =
  /^(?:gpt|o[13]|claude|gemini|gemma|deepseek|qwen|glm|kimi|moonshot|llama|mistral|mixtral|command|phi|yi-|intern|ernie|doubao|step-|minimax|abab|spark|hunyuan|grok|nova|titan|jamba|dbrx|sonar|seed|nemotron|reflection|stealth)/i;

function stripWrapping(value: string): string {
  let out = value.trim();
  out = out.replace(/\*\*/g, '').trim();
  out = out.replace(/^`+/, '').replace(/`+$/, '').trim();
  if (out.length >= 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      out = out.slice(1, -1).trim();
    }
  }
  out = out.replace(/^bearer\s+/i, '').trim();
  return out;
}

function stripTrailingComment(value: string): string {
  let out = value.trim();
  out = out.replace(/[,;]\s*$/, '');
  const hash = out.search(/\s#/);
  if (hash !== -1) out = out.slice(0, hash);
  const slashes = out.search(/\s\/\//);
  if (slashes !== -1) out = out.slice(0, slashes);
  return out.trim();
}

function looksLikeApiKey(value: string, minLength: number): boolean {
  const v = stripWrapping(value);
  if (v.length < minLength || v.length > 512) return false;
  if (/\s/.test(v)) return false;
  if (/^https?:\/\//i.test(v) || v.includes('://')) return false;
  if (/[<>{}"']/.test(v)) return false;
  if (/\*{2,}/.test(v) || v.includes('...')) return false;
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(v)) return false;
  if (PLACEHOLDER_KEYS.has(v.toLowerCase())) return false;
  if (/^(undefined|null|true|false|none|nan)$/i.test(v)) return false;
  if (!/[a-z0-9]/i.test(v)) return false;
  return true;
}

function looksLikeBareToken(value: string): boolean {
  if (MODEL_NAME_HINTS.test(value)) return false;
  if (!/[0-9]/.test(value)) return false;
  if (!/[a-z]/i.test(value)) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return false;
  return true;
}

function looksLikeModelName(value: string): boolean {
  const v = stripWrapping(value);
  if (!v || v === '*' || /^(all|none|default)$/i.test(v)) return false;
  if (v.length > 120) return false;
  if (/\s/.test(v)) return false;
  if (v.includes('://')) return false;
  if (looksLikeApiKey(v, 32) && !/[a-z]{4}/i.test(v)) return false;
  return true;
}

/* -------------------------------------------------------------------------- */
/* URL handling                                                               */
/* -------------------------------------------------------------------------- */

const URL_RE = /https?:\/\/[^\s"'<>`]+/gi;

const ENDPOINT_SUFFIXES = [
  '/chat/completions',
  '/completions',
  '/messages',
  '/responses',
  '/embeddings',
  '/rerank',
  '/models',
  '/images/generations',
  '/images/edits',
  '/audio/transcriptions',
  '/audio/translations',
  '/audio/speech',
];

export function normalizeBaseUrl(raw: string): { value: string; trimmed: boolean } {
  let value = stripTrailingComment(stripWrapping(raw));
  if (!value) return { value: '', trimmed: false };
  if (value.startsWith('//')) {
    value = `https:${value}`;
  } else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    if (/^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(\/|$)/i.test(value)) {
      value = `https://${value}`;
    } else {
      return { value: '', trimmed: false };
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { value: '', trimmed: false };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { value: '', trimmed: false };
  }

  parsed.search = '';
  parsed.hash = '';

  let path = parsed.pathname.replace(/\/+$/, '');
  let trimmed = false;
  const lower = path.toLowerCase();
  for (const suffix of ENDPOINT_SUFFIXES) {
    if (lower === suffix) {
      path = '';
      trimmed = true;
      break;
    }
    if (lower.endsWith(suffix)) {
      const remainder = path.slice(0, path.length - suffix.length);
      if (remainder === '' || /^\/v\d+(beta)?$/i.test(remainder) || /^\/api$/i.test(remainder)) {
        path = remainder.replace(/\/+$/, '');
        trimmed = true;
        break;
      }
    }
  }

  return { value: `${parsed.origin}${path}`, trimmed };
}

function scoreUrl(url: string): number {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return -10;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  let score = 0;
  if (/(^|\.)(docs?|documentation|help|support|status|console|dashboard|billing|pricing|blog|changelog|login|signup)\./.test(host)) {
    score -= 6;
  }
  if (
    host.includes('github.com') ||
    host.includes('discord') ||
    host.includes('twitter.') ||
    host === 'x.com' ||
    host.includes('youtube') ||
    host.includes('npmjs') ||
    host.includes('openreview') ||
    host.includes('arxiv.org')
  ) {
    score -= 6;
  }
  if (/(^|\/)(docs?|documentation|pricing|blog|changelog|login|signup|dashboard|console|billing|help|support)(\/|$)/.test(path)) {
    score -= 4;
  }
  if (path.includes('/v1') || path.includes('/v1beta') || path.includes('/api')) score += 3;
  if (host.startsWith('api.') || host.includes('.api.') || host.startsWith('api-')) score += 3;
  if (
    /(openai|anthropic|generativelanguage|deepseek|moonshot|x\.ai|dashscope|siliconflow|volces|bigmodel|openrouter|groq|together|mistral|cohere)/.test(
      host
    )
  ) {
    score += 2;
  }
  if (parsed.port) score += 2;
  if (path.length > 1) score += 1;
  return score;
}

function findUrlMatches(text: string): UrlMatch[] {
  const matches: UrlMatch[] = [];
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    let raw = match[0];
    while (raw.length && /[),.;:!?\]}]+$/.test(raw)) raw = raw.slice(0, -1);
    if (!raw) continue;
    const normalized = normalizeBaseUrl(raw);
    if (!normalized.value) continue;
    matches.push({
      start,
      end: start + raw.length,
      value: normalized.value,
      score: scoreUrl(normalized.value),
      trimmed: normalized.trimmed,
    });
  }
  return matches;
}

/* -------------------------------------------------------------------------- */
/* Draft collection                                                           */
/* -------------------------------------------------------------------------- */

function emptyDraft(): Draft {
  return { baseUrls: [], apiKeys: [], models: [], name: null, prefix: null, baseUrlTrimmed: false };
}

function isEmptyDraft(draft: Draft): boolean {
  return (
    draft.baseUrls.length === 0 &&
    draft.apiKeys.length === 0 &&
    draft.models.length === 0 &&
    !draft.name &&
    !draft.prefix
  );
}

function cloneDraft(draft: Draft): Draft {
  return {
    baseUrls: [...draft.baseUrls],
    apiKeys: [...draft.apiKeys],
    models: [...draft.models],
    name: draft.name,
    prefix: draft.prefix,
    baseUrlTrimmed: draft.baseUrlTrimmed,
  };
}

function addBaseUrlNormalized(draft: Draft, value: string, trimmed: boolean): void {
  if (!value) return;
  if (!draft.baseUrls.includes(value)) draft.baseUrls.push(value);
  if (trimmed) draft.baseUrlTrimmed = true;
}

function addBaseUrlValue(draft: Draft, raw: string): void {
  const cleaned = stripTrailingComment(raw);
  if (!cleaned) return;
  const matches = findUrlMatches(cleaned);
  if (matches.length) {
    const best = [...matches].sort((left, right) => right.score - left.score)[0];
    addBaseUrlNormalized(draft, best.value, best.trimmed);
    return;
  }
  const normalized = normalizeBaseUrl(cleaned);
  addBaseUrlNormalized(draft, normalized.value, normalized.trimmed);
}

function splitApiKeyValues(value: string): string[] {
  const cleaned = stripWrapping(value);
  if (!cleaned) return [];
  if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
    try {
      const parsed: unknown = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string');
      }
    } catch {
      /* fall through to delimiter splitting */
    }
  }
  const byLine = cleaned
    .split(/[\r\n;|]+/)
    .map(stripWrapping)
    .filter(Boolean);
  if (byLine.length > 1) return byLine;
  const byComma = cleaned
    .split(',')
    .map(stripWrapping)
    .filter(Boolean);
  if (byComma.length > 1 && byComma.every((part) => looksLikeApiKey(part, 6))) return byComma;
  const bySpace = cleaned
    .split(/\s+/)
    .map(stripWrapping)
    .filter(Boolean);
  if (bySpace.length > 1 && bySpace.every((part) => looksLikeApiKey(part, 12))) return bySpace;
  return [cleaned];
}

function addApiKeyValue(draft: Draft, raw: string): void {
  for (const key of splitApiKeyValues(raw)) {
    if (looksLikeApiKey(key, 4) && !draft.apiKeys.includes(key)) draft.apiKeys.push(key);
  }
}

function addModel(draft: Draft, value: string): void {
  const cleaned = stripWrapping(value).replace(/^["']|["']$/g, '').trim();
  if (!looksLikeModelName(cleaned)) return;
  if (!draft.models.includes(cleaned)) draft.models.push(cleaned);
}

function addModelList(draft: Draft, raw: string): void {
  const cleaned = stripWrapping(raw);
  if (!cleaned) return;
  if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
    try {
      const parsed: unknown = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string') addModel(draft, item);
          else if (item && typeof item === 'object') {
            const name = (item as { name?: unknown }).name;
            if (typeof name === 'string') addModel(draft, name);
          }
        }
        return;
      }
    } catch {
      /* fall through */
    }
  }
  for (const part of cleaned.split(/[,\n;]+/)) addModel(draft, part);
}

function collectScalarStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(collectScalarStrings);
  return [];
}

function collectApiKeyStrings(value: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectApiKeyStrings(item, depth + 1));
  const out: string[] = [];
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(obj)) {
      if (fieldKindOf(key) === 'apiKey') out.push(...collectApiKeyStrings(child, depth + 1));
    }
    if (out.length) return out;
    for (const child of Object.values(obj)) {
      if (typeof child === 'string' && looksLikeApiKey(child, 8)) out.push(child);
    }
  }
  return out;
}

function collectModelStrings(value: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectModelStrings(item, depth + 1));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const field of ['name', 'id', 'model']) {
      if (typeof obj[field] === 'string') return [obj[field] as string];
    }
    return Object.values(obj).flatMap((item) => collectModelStrings(item, depth + 1));
  }
  return [];
}

function mergeInto(target: Draft, source: Draft): void {
  for (const url of source.baseUrls) {
    if (!target.baseUrls.includes(url)) target.baseUrls.push(url);
  }
  for (const key of source.apiKeys) {
    if (!target.apiKeys.includes(key)) target.apiKeys.push(key);
  }
  for (const model of source.models) {
    if (!target.models.includes(model)) target.models.push(model);
  }
  if (!target.name && source.name) target.name = source.name;
  if (!target.prefix && source.prefix) target.prefix = source.prefix;
  if (source.baseUrlTrimmed) target.baseUrlTrimmed = true;
}

const CONTAINER_KEYS = new Set([
  'env',
  'environment',
  'auth',
  'authentication',
  'headers',
  'settingsconfig',
  'config',
  'credentials',
  'credential',
  'extra',
  'options',
]);

function extractOwn(obj: Record<string, unknown>): Draft {
  const draft = emptyDraft();
  for (const [key, raw] of Object.entries(obj)) {
    const kind = fieldKindOf(key);
    if (!kind) continue;
    if (kind === 'baseUrl') {
      for (const value of collectScalarStrings(raw)) addBaseUrlValue(draft, value);
    } else if (kind === 'apiKey') {
      for (const value of collectApiKeyStrings(raw)) addApiKeyValue(draft, value);
    } else if (kind === 'models') {
      for (const value of collectModelStrings(raw)) addModelList(draft, value);
    } else if (kind === 'name') {
      const first = collectScalarStrings(raw).find((value) => value.trim());
      if (first && !draft.name) draft.name = stripWrapping(first);
    } else if (kind === 'prefix') {
      const first = collectScalarStrings(raw).find((value) => value.trim());
      if (first && !draft.prefix) draft.prefix = stripWrapping(first);
    }
  }
  return draft;
}

function extractEffective(value: unknown, depth = 0): Draft {
  const draft = emptyDraft();
  if (depth > 8 || !value || typeof value !== 'object' || Array.isArray(value)) return draft;
  const obj = value as Record<string, unknown>;
  mergeInto(draft, extractOwn(obj));

  for (const [key, raw] of Object.entries(obj)) {
    const compact = key.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!CONTAINER_KEYS.has(compact)) continue;
    if (compact === 'headers' && Array.isArray(raw)) {
      for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const record = entry as Record<string, unknown>;
        const label =
          typeof record.name === 'string'
            ? record.name
            : typeof record.key === 'string'
              ? record.key
              : '';
        const headerValue = typeof record.value === 'string' ? record.value : '';
        if (label && headerValue && fieldKindOf(label) === 'apiKey') {
          addApiKeyValue(draft, headerValue);
        }
      }
      continue;
    }
    if (typeof raw === 'string') {
      const parsed = parseEmbeddedString(raw);
      for (const candidateDraft of parsed) mergeInto(draft, candidateDraft);
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      mergeInto(draft, extractEffective(raw, depth + 1));
    }
  }
  return draft;
}

function looksLikeEmbeddedConfig(raw: string): boolean {
  const lower = raw.toLowerCase();
  return (
    lower.includes('base_url') ||
    lower.includes('base-url') ||
    lower.includes('baseurl') ||
    lower.includes('anthropic_base_url') ||
    lower.includes('api_key') ||
    lower.includes('api-key') ||
    lower.includes('apikey') ||
    lower.includes('[model_providers.')
  );
}

function parseEmbeddedString(raw: string): Draft[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const out: Draft[] = [];
      collectCandidates(parsed, null, 0, out);
      if (out.length) return out;
    } catch {
      /* fall through to line parsing */
    }
  }
  const draft = parseTextBlocks(raw);
  return isEmptyDraft(draft) ? [] : [draft];
}

function collectCandidates(
  value: unknown,
  inheritedName: string | null,
  depth: number,
  out: Draft[]
): void {
  if (depth > 12) return;
  if (Array.isArray(value)) {
    for (const item of value) collectCandidates(item, inheritedName, depth + 1, out);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const obj = value as Record<string, unknown>;
  const effective = extractEffective(obj);
  const name = effective.name ?? inheritedName;
  if (effective.baseUrls.length || effective.apiKeys.length) {
    out.push({ ...cloneDraft(effective), name });
  }

  const childName = effective.name ?? inheritedName;
  for (const raw of Object.values(obj)) {
    if (raw && typeof raw === 'object') {
      collectCandidates(raw, childName, depth + 1, out);
    } else if (typeof raw === 'string' && looksLikeEmbeddedConfig(raw)) {
      for (const draft of parseEmbeddedString(raw)) {
        out.push({ ...cloneDraft(draft), name: draft.name ?? childName });
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Line / text parsing                                                        */
/* -------------------------------------------------------------------------- */

function parseTextBlocks(text: string): Draft {
  const draft = emptyDraft();
  const normalized = text
    .replace(/\uFF1A/g, ':')
    .replace(/\uFF1D/g, '=')
    .replace(/\u3000/g, ' ');

  for (const line of normalized.split(/\r?\n/)) {
    const cleanedLine = line.replace(/^\s*[-*•·]\s+/, '').trim();
    if (!cleanedLine || cleanedLine.startsWith('#')) continue;

    const authHeader = /\bauthorization\s*[:=]\s*(?:bearer\s+)?([A-Za-z0-9._-]+)/i.exec(
      cleanedLine
    );
    if (authHeader) addApiKeyValue(draft, authHeader[1]);

    const keyHeader = /\b(?:x-api-key|api-key|apikey)\s*[:=]\s*([A-Za-z0-9._-]+)/i.exec(
      cleanedLine
    );
    if (keyHeader) addApiKeyValue(draft, keyHeader[1]);

    const kv = /^(?:["']?)([^:="']{1,80})(?:["']?)\s*[:=]\s*(.+)$/.exec(cleanedLine);
    if (kv) {
      const label = kv[1].trim();
      const value = stripTrailingComment(kv[2]);
      const kind = fieldKindOf(label);
      if (kind === 'baseUrl') addBaseUrlValue(draft, value);
      else if (kind === 'apiKey') addApiKeyValue(draft, value);
      else if (kind === 'name') {
        if (!draft.name) draft.name = stripWrapping(value);
      } else if (kind === 'prefix') {
        if (!draft.prefix) draft.prefix = stripWrapping(value);
      } else if (kind === 'models') addModelList(draft, value);
      continue;
    }

    if (/^https?:\/\//i.test(cleanedLine)) addBaseUrlValue(draft, cleanedLine);
  }

  return draft;
}

function findBareApiKeys(text: string, urls: UrlMatch[], models: string[]): string[] {
  const out: string[] = [];
  const inUrl = (index: number) => urls.some((url) => index >= url.start && index < url.end);
  const modelSet = new Set(models.map((model) => model.toLowerCase()));
  const patterns = [
    /\b(?:sk|sk-ant|sk-proj|sk-or|gsk|hf|xai|user|pk|ak)[-_][A-Za-z0-9_-]{8,}\b/g,
    /\bAIza[0-9A-Za-z_-]{20,}\b/g,
    /\b[0-9a-fA-F]{32,}\b/g,
    /\b[A-Za-z0-9][A-Za-z0-9_.-]{31,}\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (inUrl(index)) continue;
      const value = match[0];
      if (modelSet.has(value.toLowerCase())) continue;
      if (!looksLikeApiKey(value, 16)) continue;
      if (!looksLikeBareToken(value)) continue;
      if (!out.includes(value)) out.push(value);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Block splitting                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Split pasted text into independent blocks separated by blank lines or
 * horizontal rules (`---`, `===`, …). Each surviving block is treated as a
 * separate configuration candidate, so users can paste several providers at
 * once and pick the right one.
 */
function splitTextBlocks(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const blocks: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const joined = current.join('\n').trim();
    if (joined) blocks.push(joined);
    current = [];
  };

  for (const line of normalized.split('\n')) {
    const trimmed = line.trim();
    const isSeparator = /^([-=*_~])\1{2,}$/.test(trimmed);
    if (!trimmed || isSeparator) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

/**
 * Parse a single block of free text into a draft, applying the bare URL/key
 * fallbacks used for unstructured pastes.
 */
function buildTextDraft(raw: string): Draft {
  const textDraft = parseTextBlocks(raw);
  const urlMatches = findUrlMatches(raw);
  if (textDraft.baseUrls.length === 0) {
    const best = urlMatches
      .filter((url) => url.score >= -1)
      .sort((left, right) => right.score - left.score)[0];
    if (best) addBaseUrlNormalized(textDraft, best.value, best.trimmed);
  }
  if (textDraft.apiKeys.length === 0) {
    for (const key of findBareApiKeys(raw, urlMatches, textDraft.models)) {
      if (!textDraft.apiKeys.includes(key)) textDraft.apiKeys.push(key);
    }
  }
  return textDraft;
}

/**
 * Turn non-JSON pasted text into drafts. Content is split on blank lines /
 * horizontal rules; blocks that only carry half a credential (just a URL or
 * just a key) are merged backwards into the previous block so wrapped TOML
 * sections and split pairs still resolve to one candidate.
 */
function parseTextIntoDrafts(raw: string): Draft[] {
  const blocks = splitTextBlocks(raw);
  if (blocks.length <= 1) {
    const draft = buildTextDraft(raw);
    return isEmptyDraft(draft) ? [] : [draft];
  }

  const drafts: Draft[] = [];
  for (const block of blocks) {
    const parsedJson = tryParseJson(block);
    if (parsedJson !== undefined) {
      const out: Draft[] = [];
      collectCandidates(parsedJson, null, 0, out);
      if (out.length) {
        drafts.push(...out);
        continue;
      }
    }

    const draft = buildTextDraft(block);
    if (isEmptyDraft(draft)) continue;

    const incomplete = draft.baseUrls.length === 0 || draft.apiKeys.length === 0;
    const previous = drafts[drafts.length - 1];
    if (incomplete && previous) {
      mergeInto(previous, draft);
      continue;
    }
    drafts.push(draft);
  }

  return drafts;
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                   */
/* -------------------------------------------------------------------------- */

function tryParseJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    /* try to recover JSON embedded in surrounding prose */
  }
  const start = trimmed.search(/[[{]/);
  const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function draftsMatch(left: Draft, right: Draft): boolean {
  const leftBase = left.baseUrls[0] ?? '';
  const rightBase = right.baseUrls[0] ?? '';
  if (leftBase && rightBase) return leftBase === rightBase;
  if (left.apiKeys.length && right.apiKeys.length) {
    return left.apiKeys.some((key) => right.apiKeys.includes(key));
  }
  if (!leftBase && !rightBase && !left.apiKeys.length && !right.apiKeys.length) {
    return !!left.name && left.name === right.name;
  }
  return false;
}

function dedupeDrafts(drafts: Draft[]): Draft[] {
  const out: Draft[] = [];
  for (const draft of drafts) {
    const existing = out.find((candidate) => draftsMatch(candidate, draft));
    if (!existing) {
      out.push(cloneDraft(draft));
      continue;
    }
    mergeInto(existing, draft);
  }
  return out;
}

function finalizeCandidate(draft: Draft): SmartConfigCandidate {
  const warnings: SmartConfigWarningCode[] = [];
  const baseUrl =
    [...draft.baseUrls].sort((left, right) => scoreUrl(right) - scoreUrl(left))[0] ?? null;
  if (!baseUrl) warnings.push('noBaseUrl');
  if (draft.baseUrlTrimmed) warnings.push('normalizedBaseUrl');

  const apiKeys = draft.apiKeys;
  if (apiKeys.length === 0) warnings.push('noApiKey');
  else if (apiKeys.some((key) => key.length < 12)) warnings.push('shortApiKey');

  let models = draft.models;
  if (models.length > MAX_SMART_MODELS) {
    models = models.slice(0, MAX_SMART_MODELS);
    warnings.push('modelsTruncated');
  }

  return { baseUrl, apiKeys, models, name: draft.name, prefix: draft.prefix, warnings };
}

function detectFormat(raw: string): SmartConfigFormat {
  const lower = raw.toLowerCase();
  if (/\bcurl\b/.test(lower)) return 'curl';
  if (
    lower.includes('anthropic_base_url') ||
    lower.includes('anthropic_auth_token') ||
    lower.includes('anthropic_api_key')
  ) {
    return lower.includes('settingsconfig') ? 'cc-switch' : 'claude-code';
  }
  if (lower.includes('settingsconfig')) return 'cc-switch';
  if (lower.includes('new-api') || lower.includes('newapi')) return 'new-api';
  if (
    /"base_url"\s*:/.test(lower) &&
    /"(key|api_key)"\s*:/.test(lower) &&
    /"models"\s*:/.test(lower)
  ) {
    return 'new-api';
  }
  if (lower.includes('openai_base_url') || lower.includes('openai_api_key')) return 'openai';
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (/^[^\n]+[:=][^\n]+$/m.test(trimmed)) return 'key-value';
  return 'text';
}

export function parseSmartConfig(text: string): SmartConfigResult | null {
  const raw = (text ?? '').trim();
  if (!raw) return null;

  const drafts: Draft[] = [];
  const parsedJson = tryParseJson(raw);
  if (parsedJson !== undefined) collectCandidates(parsedJson, null, 0, drafts);

  if (drafts.length === 0) {
    drafts.push(...parseTextIntoDrafts(raw));
  }

  if (drafts.length === 0) return null;

  const candidates = dedupeDrafts(drafts).slice(0, 20).map(finalizeCandidate);
  if (candidates.length === 0) return null;
  return { format: detectFormat(raw), candidates };
}

/* -------------------------------------------------------------------------- */
/* Form application                                                           */
/* -------------------------------------------------------------------------- */

function dedupeStrings(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

export function maskApiKey(value: string): string {
  const key = value.trim();
  if (key.length <= 10) return `${key.slice(0, 3)}…`;
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

/**
 * Build the next form state from a parsed candidate.
 *
 * Base URL / name / prefix / credential are always replaced when the candidate
 * provides them (that is the point of pasting a config); the model list is only
 * filled when the form has no models yet, so a curated list is never wiped.
 */
export function applySmartConfigCandidate(
  brand: ProviderBrand,
  form: ProviderEntryFormInput,
  candidate: SmartConfigCandidate
): { next: ProviderEntryFormInput; summary: SmartConfigApplySummary } {
  const descriptor = PROVIDER_DESCRIPTORS[brand];
  const next: ProviderEntryFormInput = { ...form };
  const summary: SmartConfigApplySummary = {
    baseUrl: false,
    apiKeys: 0,
    models: 0,
    name: false,
    prefix: false,
    extraApiKeys: 0,
  };

  if (candidate.baseUrl && descriptor.supportsBaseUrl) {
    next.baseUrl = candidate.baseUrl;
    summary.baseUrl = true;
  }
  if (candidate.name && descriptor.supportsName) {
    next.name = candidate.name;
    summary.name = true;
  }
  if (candidate.prefix && descriptor.supportsPrefix) {
    next.prefix = candidate.prefix;
    summary.prefix = true;
  }

  const keys = dedupeStrings(candidate.apiKeys);
  if (keys.length) {
    if (descriptor.supportsApiKeyEntries) {
      const entries: ApiKeyEntryInput[] = keys.map((apiKey) => ({
        apiKey,
        proxyUrl: '',
        weight: undefined,
      }));
      next.apiKeyEntries = entries;
      summary.apiKeys = keys.length;
    } else if (descriptor.supportsApiKey) {
      next.apiKey = keys[0];
      summary.apiKeys = 1;
      summary.extraApiKeys = keys.length - 1;
    }
  }

  if (candidate.models.length && descriptor.supportsModels) {
    const existing = (form.models ?? []).filter((model) => model.name.trim());
    if (existing.length === 0) {
      const models = dedupeStrings(candidate.models).slice(0, MAX_SMART_MODELS);
      next.models = models.map((name): ModelEntryInput => ({ name, alias: '' }));
      summary.models = models.length;
    }
  }

  return { next, summary };
}
