import { createRootRoute, Outlet } from '@tanstack/react-router'

// The route tree is the files in this folder; `routeTree.gen.ts` is generated from them.
//
//   index                        /                  pick a list to work on. No map.
//   reguleringer.index           /reguleringer      saved delivery definitions. No map.
//   reguleringer.$reguleringId   /reguleringer/7    one regulering, previews and test runs.
//   kjoring                      /kjoring           what komreg-backend holds. No map.
//   parametre                    /parametre         static explainer. No map, no state.
//   _map                         (no path)          MapView, the persistent shell.
//   _map.kart, .arbeidsliste, .komreg               the work pages, in MapView's <Outlet/>.
export const Route = createRootRoute({ component: () => <Outlet /> })
