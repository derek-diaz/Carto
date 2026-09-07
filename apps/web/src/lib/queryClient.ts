import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      gcTime: 30 * 60 * 1000,
      networkMode: 'always'
    },
    mutations: { retry: false, networkMode: 'always' }
  }
});
