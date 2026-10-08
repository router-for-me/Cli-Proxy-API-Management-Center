import { isRecord } from '@/utils/helpers';

export interface ParsedApiErrorResponse {
  message: string;
  apiCode?: string;
}

const readString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Reverse proxies such as nginx answer with their own HTML error page when the
 * backend is unreachable. Use the page title (or first heading) instead of the
 * markup; an empty result lets the caller fall back to the transport message.
 */
const readHtmlErrorPage = (text: string): string | undefined => {
  if (!/^<(?:!doctype\s+html|html|head|body)\b/i.test(text)) return undefined;
  for (const tag of ['title', 'h1']) {
    const match = text.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    const content = match?.[1]
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (content) return content;
  }
  return '';
};

/**
 * Parse the Management API's error envelope.
 *
 * Newer endpoints use `error` as a stable machine-readable code and `message`
 * as the human-readable detail. Older endpoints may put the only useful text
 * directly in `error`, so that remains a fallback.
 */
export const parseApiErrorResponse = (
  responseData: unknown,
  fallbackMessage: string
): ParsedApiErrorResponse => {
  if (!isRecord(responseData)) {
    const text = readString(responseData);
    return {
      message: (readHtmlErrorPage(text) ?? text) || readString(fallbackMessage) || 'Request failed',
    };
  }

  const errorValue = responseData.error;
  const errorRecord = isRecord(errorValue) ? errorValue : null;
  const stringError = readString(errorValue);
  const apiCode = stringError || readString(errorRecord?.code) || undefined;
  const message =
    readString(responseData.message) ||
    readString(errorRecord?.message) ||
    stringError ||
    readString(fallbackMessage) ||
    'Request failed';

  return { message, apiCode };
};
