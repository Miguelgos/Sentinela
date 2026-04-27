import { createRootRoute, Outlet, ScrollRestoration } from "@tanstack/react-router";
import "../../frontend/src/index.css";

export const Route = createRootRoute({
  component: () => (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  ),
});
