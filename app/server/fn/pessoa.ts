"use server";
import { createServerFn } from "@tanstack/react-start";
import { lookupPessoas } from "../../../backend/src/db/mssql";

export const lookupPessoa = createServerFn({ method: "GET" })
  .inputValidator((input: { userIds: string }) => input)
  .handler(async ({ data }) => {
    const userIds = data.userIds.split(",").map((s: string) => s.trim()).filter(Boolean);
    if (userIds.length === 0) return {} as Record<string, string>;
    return lookupPessoas(userIds) as Promise<Record<string, string>>;
  });
