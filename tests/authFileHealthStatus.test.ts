import { expect, test } from 'bun:test';
import {
  getAuthFileRuntimeStatus,
  hasAuthFileStatusMessage,
  isAuthFileProblem,
  isAuthFileUnavailable,
} from '@/features/authFiles/constants';
import type { AuthFileItem } from '@/types';

const baseFile = (overrides: Partial<AuthFileItem> = {}): AuthFileItem => ({
  name: 'claude-hello@example.com.json',
  type: 'claude',
  disabled: false,
  ...overrides,
});

test('isAuthFileUnavailable honors unavailable flag and error status', () => {
  expect(isAuthFileUnavailable(baseFile({ unavailable: true }))).toBe(true);
  expect(isAuthFileUnavailable(baseFile({ status: 'error' }))).toBe(true);
  expect(isAuthFileUnavailable(baseFile({ status: 'Unavailable' }))).toBe(true);
  expect(isAuthFileUnavailable(baseFile({ status: 'failed' }))).toBe(true);
  expect(isAuthFileUnavailable(baseFile({ status: 'ok' }))).toBe(false);
  expect(isAuthFileUnavailable(baseFile())).toBe(false);
});

test('getAuthFileRuntimeStatus normalizes status text', () => {
  expect(getAuthFileRuntimeStatus(baseFile({ status: ' Error ' }))).toBe('error');
  expect(getAuthFileRuntimeStatus(baseFile())).toBe('');
});

test('isAuthFileProblem includes unavailable credentials without status_message', () => {
  const unavailableOnly = baseFile({ unavailable: true });
  expect(hasAuthFileStatusMessage(unavailableOnly)).toBe(false);
  expect(isAuthFileProblem(unavailableOnly)).toBe(true);

  const messageOnly = baseFile({
    status_message: '{"type":"error","error":{"message":"Invalid bearer token"}}',
  });
  expect(isAuthFileProblem(messageOnly)).toBe(true);

  expect(isAuthFileProblem(baseFile())).toBe(false);
});
