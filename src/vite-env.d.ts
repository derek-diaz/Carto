import type { BuildOptions } from 'vite';

declare module 'vite' {
  // electron-vite expects BuildEnvironmentOptions (Vite 6+); map to BuildOptions for Vite 5.
  export type BuildEnvironmentOptions = BuildOptions
}
