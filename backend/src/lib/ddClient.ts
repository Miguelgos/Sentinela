import { makeClient } from "./httpClient";

const DD_SITE = process.env.DD_SITE || "us5.datadoghq.com";
const request = makeClient({
  baseUrl: `https://api.${DD_SITE}`,
  headers: {
    "DD-API-KEY":         process.env.DD_API_KEY  || "",
    "DD-APPLICATION-KEY": process.env.DD_APP_KEY  || "",
  },
});

export function ddFetch(path: string, method = "GET", body?: unknown): Promise<unknown> {
  return request(path, method, body);
}
