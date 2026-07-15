/**
 * Resolver functions for extracting data from auth files.
 */

import type { AuthFileItem } from '@/types';
import {
  normalizeNumberValue,
  normalizeStringValue,
  normalizePlanType,
  parseIdTokenPayload,
} from './parsers';

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const resolveCodexAuthInfo = (value: unknown): Record<string, unknown> | null => {
  const payload = parseIdTokenPayload(value);
  if (!payload) return null;
  const nested = toRecord(payload['https://api.openai.com/auth']);
  return nested ?? payload;
};

export function extractCodexChatgptAccountId(value: unknown): string | null {
  const payload = parseIdTokenPayload(value);
  if (!payload) return null;
  return normalizeStringValue(payload.chatgpt_account_id ?? payload.chatgptAccountId);
}

export function resolveCodexChatgptAccountId(file: AuthFileItem): string | null {
  const metadata =
    file && typeof file.metadata === 'object' && file.metadata !== null
      ? (file.metadata as Record<string, unknown>)
      : null;
  const attributes =
    file && typeof file.attributes === 'object' && file.attributes !== null
      ? (file.attributes as Record<string, unknown>)
      : null;

  const candidates = [file.id_token, metadata?.id_token, attributes?.id_token];

  for (const candidate of candidates) {
    const id = extractCodexChatgptAccountId(candidate);
    if (id) return id;
  }

  return null;
}

const planTypeFromAuthInfo = (value: unknown): string | null => {
  const authInfo = resolveCodexAuthInfo(value);
  if (!authInfo) return null;
  return (
    normalizePlanType(authInfo.chatgpt_plan_type) ??
    normalizePlanType(authInfo.chatgptPlanType) ??
    normalizePlanType(authInfo.plan_type) ??
    normalizePlanType(authInfo.planType)
  );
};

export function resolveCodexPlanType(file: AuthFileItem): string | null {
  const metadata =
    file && typeof file.metadata === 'object' && file.metadata !== null
      ? (file.metadata as Record<string, unknown>)
      : null;
  const attributes =
    file && typeof file.attributes === 'object' && file.attributes !== null
      ? (file.attributes as Record<string, unknown>)
      : null;
  const idToken =
    file && typeof file.id_token === 'object' && file.id_token !== null
      ? (file.id_token as Record<string, unknown>)
      : null;
  const metadataIdToken =
    metadata && typeof metadata.id_token === 'object' && metadata.id_token !== null
      ? (metadata.id_token as Record<string, unknown>)
      : null;

  // Prefer explicitly stored plan fields over JWT-derived values so quota
  // refresh can correct stale chatgpt_plan_type claims after downgrades.
  const storedCandidates = [
    file.plan_type,
    file.planType,
    file['plan_type'],
    file['planType'],
    metadata?.plan_type,
    metadata?.planType,
    attributes?.plan_type,
    attributes?.planType,
    file.chatgpt_plan_type,
    file.chatgptPlanType,
    file['chatgpt_plan_type'],
    file['chatgptPlanType'],
    metadata?.chatgpt_plan_type,
    metadata?.chatgptPlanType,
    attributes?.chatgpt_plan_type,
    attributes?.chatgptPlanType,
  ];

  for (const candidate of storedCandidates) {
    const planType = normalizePlanType(candidate);
    if (planType) return planType;
  }

  const tokenCandidates = [
    planTypeFromAuthInfo(file.id_token),
    planTypeFromAuthInfo(idToken),
    planTypeFromAuthInfo(metadata?.id_token),
    planTypeFromAuthInfo(metadataIdToken),
    planTypeFromAuthInfo(attributes?.id_token),
    normalizePlanType(idToken?.plan_type),
    normalizePlanType(idToken?.planType),
    normalizePlanType(metadataIdToken?.plan_type),
    normalizePlanType(metadataIdToken?.planType),
  ];

  for (const planType of tokenCandidates) {
    if (planType) return planType;
  }

  return null;
}

const normalizeDateLikeValue = (value: unknown): string | number | null => {
  const numberValue = normalizeNumberValue(value);
  if (numberValue === 0) return null;
  if (numberValue !== null) return numberValue;

  const stringValue = normalizeStringValue(value);
  if (!stringValue || stringValue === '0') return null;
  return stringValue;
};

export function resolveCodexSubscriptionActiveUntil(file: AuthFileItem): string | number | null {
  const metadata = toRecord(file.metadata);
  const attributes = toRecord(file.attributes);
  const idToken = resolveCodexAuthInfo(file.id_token);
  const metadataIdToken = resolveCodexAuthInfo(metadata?.id_token);
  const attributesIdToken = resolveCodexAuthInfo(attributes?.id_token);
  const subscription = toRecord(file.subscription);
  const metadataSubscription = toRecord(metadata?.subscription);
  const attributesSubscription = toRecord(attributes?.subscription);

  const candidates = [
    file.chatgpt_subscription_active_until,
    file.chatgptSubscriptionActiveUntil,
    file.subscription_active_until,
    file.subscriptionActiveUntil,
    subscription?.active_until,
    subscription?.activeUntil,
    idToken?.chatgpt_subscription_active_until,
    idToken?.chatgptSubscriptionActiveUntil,
    metadata?.chatgpt_subscription_active_until,
    metadata?.chatgptSubscriptionActiveUntil,
    metadata?.subscription_active_until,
    metadata?.subscriptionActiveUntil,
    metadataSubscription?.active_until,
    metadataSubscription?.activeUntil,
    metadataIdToken?.chatgpt_subscription_active_until,
    metadataIdToken?.chatgptSubscriptionActiveUntil,
    attributes?.chatgpt_subscription_active_until,
    attributes?.chatgptSubscriptionActiveUntil,
    attributes?.subscription_active_until,
    attributes?.subscriptionActiveUntil,
    attributesSubscription?.active_until,
    attributesSubscription?.activeUntil,
    attributesIdToken?.chatgpt_subscription_active_until,
    attributesIdToken?.chatgptSubscriptionActiveUntil,
  ];

  for (const candidate of candidates) {
    const value = normalizeDateLikeValue(candidate);
    if (value !== null) return value;
  }

  return null;
}
