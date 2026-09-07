import { useCallback } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { APP_VIEWS, type AppView } from '../types/navigation';

const views = new Set<string>(APP_VIEWS);
export const useAppNavigation = () => {
  const path = useRouterState({ select: (state) => state.location.pathname.slice(1) });
  const navigate = useNavigate();
  const view: AppView = views.has(path) ? (path as AppView) : 'connection';
  const setView = useCallback(
    (next: AppView) => {
      void navigate({ to: `/${next}` });
    },
    [navigate]
  );
  return [view, setView] as const;
};
