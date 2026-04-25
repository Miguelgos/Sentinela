import https from "https";
import { query } from "./db";
import { parseSeqApiEvent } from "./types";

export function httpsGetJson(url: string, headers: Record<string, string> = {}): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      port: parsed.port || 443,
      method: "GET",
      headers: { Accept: "application/json", ...headers },
      rejectUnauthorized: false,
    };
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode || 0, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode || 0, data: body });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

export async function upsertEvents(events: ReturnType<typeof parseSeqApiEvent>[]) {
  let imported = 0;
  let skipped = 0;
  for (const e of events) {
    try {
      const result = await query(
        `INSERT INTO seq_events (event_id, timestamp, message_template, message, level, trace_id, span_id, user_id, guid_cotacao, service, environment, request_path, source_context, raw_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          e.event_id, e.timestamp, e.message_template, e.message,
          e.level, e.trace_id, e.span_id, e.user_id,
          e.guid_cotacao, e.service, e.environment,
          e.request_path, e.source_context, JSON.stringify(e.raw_data),
        ]
      );
      if (result.rowCount && result.rowCount > 0) imported++;
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { imported, skipped };
}

export async function deleteOldEvents(retentionHours: number) {
  const result = await query(
    `DELETE FROM seq_events WHERE timestamp < NOW() - INTERVAL '${retentionHours} hours'`
  );
  return result.rowCount ?? 0;
}

export async function saveConfig(seqUrl: string, apiKey: string | undefined, signal: string | undefined, count: number) {
  await query(
    `INSERT INTO sync_config (seq_url, api_key, signal, last_synced_at, last_count) VALUES ($1,$2,$3,NOW(),$4)`,
    [seqUrl, apiKey || null, signal || null, count]
  ).catch(() =>
    query(
      `UPDATE sync_config SET seq_url=$1, api_key=$2, signal=$3, last_synced_at=NOW(), last_count=$4, updated_at=NOW()
       WHERE id=(SELECT id FROM sync_config ORDER BY id LIMIT 1)`,
      [seqUrl, apiKey || null, signal || null, count]
    )
  );
}
