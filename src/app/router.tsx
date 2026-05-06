import {
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { AppLayout } from './AppLayout';
import { DashboardPage } from '../pages/DashboardPage';
import { CatalogPage } from '../pages/CatalogPage';
import { FinderPage } from '../pages/FinderPage';
import { ProfilePage } from '../pages/ProfilePage';
import { LearnPage } from '../pages/LearnPage';
import { PlayersPage } from '../pages/PlayersPage';
import { AuthPage } from '../pages/AuthPage';
import { RpgPage } from '../pages/RpgPage';
import { RpgStartPage } from '../pages/RpgStartPage';
import { AppErrorBoundary } from '../shared/ui/AppErrorBoundary';

const rootRoute = createRootRoute({
  component: AppLayout,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardPage,
});

const catalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/catalog',
  component: CatalogPage,
});

const finderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/finder',
  component: FinderPage,
});

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
  component: ProfilePage,
});

const playersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/players',
  component: PlayersPage,
});

const lobbyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/lobby',
  component: RpgPage,
});

const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth',
  component: AuthPage,
});

const rpgRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rpg',
  component: RpgStartPage,
});

const learnRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/learn/$slug',
  component: LearnPage,
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  catalogRoute,
  finderRoute,
  playersRoute,
  lobbyRoute,
  profileRoute,
  authRoute,
  rpgRoute,
  learnRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultErrorComponent: AppErrorBoundary,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
