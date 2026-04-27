import { makeClient } from "./httpClient";

const request = makeClient({
  baseUrl: "https://api.gocache.com.br",
  headers: { "GoCache-Token": process.env.GC_TOKEN || "" },
});

export function gcFetch(path: string, method = "GET", body?: unknown): Promise<unknown> {
  return request(path, method, body);
}
