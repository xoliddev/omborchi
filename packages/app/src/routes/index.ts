import { adminRoutes } from './admin';
import { catalogRoutes } from './catalog';
import { partyRoutes } from './parties';
import { reportRoutes } from './reports';
import { salesRoutes } from './sales';
import { stockRoutes } from './stock';

export const routes = {
  ...adminRoutes,
  ...catalogRoutes,
  ...stockRoutes,
  ...partyRoutes,
  ...salesRoutes,
  ...reportRoutes,
};

export type Routes = typeof routes;
export type RouteName = keyof Routes;
