declare module '*.module.scss' {
  const classes: Record<string, string>;
  export default classes;
}

declare module '*.png' {
  const src: string;
  export default src;
}

// Global constants injected by Vite at build time
declare const __APP_VERSION__: string;
