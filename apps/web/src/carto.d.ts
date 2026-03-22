import type { CartoApi } from '@shared/cartoApi';

declare global {
  interface Window {
    carto?: CartoApi;
  }
}

export {};
