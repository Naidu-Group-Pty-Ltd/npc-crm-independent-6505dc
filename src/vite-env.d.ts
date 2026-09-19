/// <reference types="vite/client" />

/**
 * Injected by Vite (`define` in vite.config.ts). Identifies the deployed build
 * so the app can detect a tab running a cached older bundle.
 */
declare const __BUILD_ID__: string;

declare module '*.xlsx?inline' {
  const src: string;
  export default src;
}
