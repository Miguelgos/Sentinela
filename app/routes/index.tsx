// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import App from "../../frontend/src/App";

export const Route = createFileRoute("/")({
  component: App,
});
