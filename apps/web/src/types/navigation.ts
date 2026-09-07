export const APP_VIEWS = ['monitor', 'publish', 'connection', 'settings', 'about'] as const;
export type AppView = (typeof APP_VIEWS)[number];
