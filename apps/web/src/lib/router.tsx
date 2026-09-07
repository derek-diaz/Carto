import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect
} from '@tanstack/react-router';
import App from '../App';
import { APP_VIEWS } from '../types/navigation';

// The root keeps the investigation alive while child routes change. Hash history also works
// in packaged Electron file:// windows without a server or special protocol handlers.
const root = createRootRoute({ component: App });
const routes = APP_VIEWS.map((path) => createRoute({ getParentRoute: () => root, path }));
export const router = createRouter({
  routeTree: root.addChildren([
    ...routes,
    createRoute({
      getParentRoute: () => root,
      path: 'logs',
      beforeLoad: () => {
        throw redirect({ to: '/connection', replace: true });
      }
    })
  ]),
  history: createHashHistory()
});
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
