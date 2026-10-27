/** Fork brand mark: two upstream strokes merging into one outgoing line. */
export const FORK_BRAND_NAME = 'prox';

export function ForkBrandLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" role="img" aria-label={FORK_BRAND_NAME}>
      <rect width="32" height="32" rx="8" fill="#1c1b19" />
      <g fill="none" strokeLinecap="round" strokeWidth="3.2">
        <path d="M9.5 8.5 L16 16" stroke="#e3975d" />
        <path d="M16 16 L10 23.5" stroke="#84abfa" />
        <path d="M8.5 16 H24" stroke="#eef6f6" />
      </g>
    </svg>
  );
}
