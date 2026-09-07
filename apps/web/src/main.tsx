import React from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { router } from './lib/router';
import { queryClient } from './lib/queryClient';
import { TooltipProvider } from './components/ui/tooltip';
import { NotificationProvider } from './components/ui/notifications';
import './styles/globals.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delay={400}>
          <NotificationProvider>
            <RouterProvider router={router} />
          </NotificationProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </React.StrictMode>
  );
}
