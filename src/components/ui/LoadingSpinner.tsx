export function LoadingSpinner({ size = 20 }: { size?: number }) {
  return (
    <div
      className="loading-spinner"
      style={{ width: size, height: size, borderWidth: size / 7 }}
      role="status"
      aria-live="polite"
    />
  );
}
