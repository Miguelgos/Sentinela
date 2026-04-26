import https from "https";
import { SeqApiEvent, parseSeqApiEvent } from "./types";

export type ParsedEvent = ReturnType<typeof parseSeqApiEvent>;

export function seqHttpGet(path: string): Promise<SeqApiEvent[]> {
  const SEQ_URL = (process.env.SEQ_URL || "https://seq-prd.ituran.sp").replace(/\/$/, "");
  return new Promise((resolve, reject) => {
    const u = new URL(SEQ_URL + path);
    const opts: https.RequestOptions = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      port: u.port || 443,
      method: "GET",
      rejectUnauthorized: false,
      headers: { Accept: "application/json" },
      timeout: 20000,
    };
    const req = https.request(opts, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          resolve(Array.isArray(parsed) ? parsed : []);
        } catch { reject(new Error(`Seq: JSON inválido — ${body.slice(0, 120)}`)); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Seq timeout")); });
    req.end();
  });
}

export async function fetchSeq(opts: {
  fromDate?: Date;
  maxTotal?: number;
  filter?: string;
}): Promise<ParsedEvent[]> {
  const PAGE = 1000;
  const MAX = opts.maxTotal ?? 1000;
  const results: ParsedEvent[] = [];
  let afterId: string | undefined;

  while (results.length < MAX) {
    const SEQ_SIGNAL = process.env.SEQ_SIGNAL || "";
    let qs = `?count=${PAGE}&render=true`;
    if (SEQ_SIGNAL)    qs += `&signal=${encodeURIComponent(SEQ_SIGNAL)}`;
    if (opts.filter)   qs += `&filter=${encodeURIComponent(opts.filter)}`;
    if (opts.fromDate) qs += `&fromDateUtc=${encodeURIComponent(opts.fromDate.toISOString())}`;
    if (afterId)       qs += `&afterId=${encodeURIComponent(afterId)}`;

    const raw = await seqHttpGet(`/api/events/${qs}`);
    if (raw.length === 0) break;

    let done = false;
    for (const e of raw) {
      if (opts.fromDate && new Date(e.Timestamp) < opts.fromDate) { done = true; break; }
      results.push(parseSeqApiEvent(e));
    }
    if (done || raw.length < PAGE) break;
    afterId = raw[raw.length - 1]?.Id;
    if (!afterId) break;
  }

  return results.slice(0, MAX);
}

export function prop(e: ParsedEvent, name: string): string | null {
  const raw = e.raw_data as SeqApiEvent;
  const p = (raw.Properties || []).find((x) => x.Name === name);
  return p?.Value != null ? String(p.Value) : null;
}

export function truncHour(ts: string): string {
  return ts.slice(0, 13) + ":00:00.000Z";
}
