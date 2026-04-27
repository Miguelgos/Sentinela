"use server";
import { createServerFn } from "@tanstack/react-start";

export const getHealth = createServerFn({ method: "GET" }).handler(async () => ({
  status: "ok",
  timestamp: new Date().toISOString(),
}));
