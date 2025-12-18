/**
 * Copies text to the clipboard.
 * Uses the modern Clipboard API (`navigator.clipboard`) with a fallback to the
 * deprecated `document.execCommand('copy')` for broader compatibility.
 *
 * @param text The text to copy.
 * @returns A promise that resolves to `true` if successful, `false` otherwise.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to fallback
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';

    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const successful = document.execCommand('copy');
    document.body.removeChild(textarea);

    return successful;
  } catch {
    return false;
  }
}
