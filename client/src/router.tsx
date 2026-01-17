import App from "@/App";
import NotFound from "@/pages/NotFound";
import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";

import { lazy } from "react";

const ContextWorkbench = lazy(
  () => import("@/pages/workbench/ContextWorkbench")
);
const DataWorkbench = lazy(() => import("@/pages/workbench/DataWorkbench"));
const VariablesWorkbench = lazy(
  () => import("@/pages/workbench/VariablesWorkbench")
);
const DatabaseWorkbench = lazy(
  () => import("@/pages/workbench/DatabaseWorkbench")
);
const VectorWorkbench = lazy(() => import("@/pages/workbench/VectorWorkbench"));
const EvaluationWorkbench = lazy(
  () => import("@/pages/workbench/EvaluationWorkbench")
);

const rootRoute = createRootRoute({
  component: App,
  notFoundComponent: NotFound,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/workbench/context" });
  },
});

const workbenchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workbench",
});

const workbenchContextRoute = createRoute({
  getParentRoute: () => workbenchRoute,
  path: "/context",
  component: ContextWorkbench,
});

const workbenchDataRoute = createRoute({
  getParentRoute: () => workbenchRoute,
  path: "/data",
  component: DataWorkbench,
});

const workbenchVariablesRoute = createRoute({
  getParentRoute: () => workbenchRoute,
  path: "/variables",
  component: VariablesWorkbench,
});

const workbenchDatabaseRoute = createRoute({
  getParentRoute: () => workbenchRoute,
  path: "/database",
  component: DatabaseWorkbench,
});

const workbenchVectorRoute = createRoute({
  getParentRoute: () => workbenchRoute,
  path: "/vector",
  component: VectorWorkbench,
});

const workbenchEvaluationRoute = createRoute({
  getParentRoute: () => workbenchRoute,
  path: "/evaluation",
  component: EvaluationWorkbench,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  workbenchRoute.addChildren([
    workbenchContextRoute,
    workbenchDataRoute,
    workbenchVariablesRoute,
    workbenchDatabaseRoute,
    workbenchVectorRoute,
    workbenchEvaluationRoute,
  ]),
]);

export const router = createRouter({
  notFoundMode: "root",
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
