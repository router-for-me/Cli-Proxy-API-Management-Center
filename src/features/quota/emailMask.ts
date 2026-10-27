/**
 * Email masking for when "Show emails" is off: `t1@example.com` becomes
 * `t•••@e•••.com`, and a file name keeps its prefix and extension around it
 * (`claude-t•••@e•••.com.json`). Charts, rows and the timeline share it.
 */

const MASK = '•••';
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*/g;

export const containsEmail = (text: string): boolean => /\S@\S/.test(text);

/** Keep the first character of the local part and of the first domain label. */
export const maskEmail = (email: string): string => {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const domain = email.slice(at + 1);
  const dot = domain.indexOf('.');
  const head = dot === -1 ? domain : domain.slice(0, dot);
  const rest = dot === -1 ? '' : domain.slice(dot);
  return `${email[0]}${MASK}@${head ? head[0] : ''}${MASK}${rest}`;
};

/** Mask every email in `text`; a known account email is matched exactly first. */
export const maskEmails = (text: string, knownEmail?: string | null): string => {
  const known = knownEmail?.trim();
  if (known && known.includes('@') && text.includes(known)) {
    return text.split(known).join(maskEmail(known));
  }
  return text.replace(EMAIL_IN_TEXT, (match) => maskEmail(match));
};
