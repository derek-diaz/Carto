import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DiscoveryParams } from '@shared/types';
import { getCartoClient } from '../lib/cartoClient';

const discoveryKey = ['discovery'] as const;
export const useDiscovery = (connected: boolean) => {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: discoveryKey,
    queryFn: () => getCartoClient().getDiscovery(),
    refetchInterval: (query) =>
      connected || ['starting', 'running', 'stopping'].includes(query.state.data?.state ?? '')
        ? 1000
        : false,
    refetchIntervalInBackground: true
  });
  const startMutation = useMutation({
    mutationFn: (params: DiscoveryParams) => getCartoClient().startDiscovery(params),
    onMutate: () => client.cancelQueries({ queryKey: discoveryKey }),
    onSuccess: (data) => client.setQueryData(discoveryKey, data),
    onSettled: () => client.invalidateQueries({ queryKey: discoveryKey })
  });
  const stopMutation = useMutation({
    mutationFn: () => getCartoClient().stopDiscovery(),
    onMutate: () => client.cancelQueries({ queryKey: discoveryKey }),
    onSuccess: (data) => client.setQueryData(discoveryKey, data),
    onSettled: () => client.invalidateQueries({ queryKey: discoveryKey })
  });
  const { mutateAsync: startScan } = startMutation;
  const { mutateAsync: stopScan } = stopMutation;
  const start = useCallback(
    async (params: DiscoveryParams) => {
      await startScan(params);
    },
    [startScan]
  );
  const stop = useCallback(async () => {
    await stopScan();
  }, [stopScan]);
  return { snapshot: query.data ?? null, error: query.error?.message ?? '', start, stop };
};
