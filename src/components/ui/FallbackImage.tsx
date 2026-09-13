import { useState, type ImgHTMLAttributes, type ReactNode } from 'react';

interface FallbackImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> {
  src: string | null | undefined;
  fallback: ReactNode;
}

/**
 * Renders an image, or `fallback` when there is no source or it fails to load
 * (e.g. a remote plugin logo that is unreachable).
 */
export function FallbackImage({ src, fallback, alt = '', ...imgProps }: FallbackImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) return <>{fallback}</>;
  return <img {...imgProps} src={src} alt={alt} onError={() => setFailedSrc(src)} />;
}
