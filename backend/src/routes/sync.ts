import { Router, Request, Response } from "express";
import https from "https";
import { query } from "../db";
import { SyncRequest, parseSeqEvent, parseSeqApiEvent, SeqApiEvent, RawSeqEvent } from "../types";

const router = Router();

const PAGE_SIZE = 1000; // eventos por requisição ao Seq

function httpsGet(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
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
      res.on("end", () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

function buildUrl(
  baseUrl: string,
  useRaw: boolean,
  signal: string | undefined,
  startDate: string | undefined,
  endDate: string | undefined,
  afterId?: string
): string {
  const endpoint = useRaw ? "api/events/raw" : "api/events/";
  let url = `${baseUrl}/${endpoint}?count=${PAGE_SIZE}&render=true`;
  if (signal) url += `&signal=${encodeURIComponent(signal)}`;
  if (startDate) url += `&fromDateUtc=${encodeURIComponent(startDate)}`;
  if (endDate) url += `&toDateUtc=${encodeURIComponent(endDate)}`;
  if (afterId) url += `&afterId=${encodeURIComponent(afterId)}`;
  return url;
}

async function upsertEvents(events: ReturnType<typeof parseSeqApiEvent>[]) {
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

router.get("/config", async (_req: Request, res: Response) => {
  const result = await query(
    `SELECT seq_url, signal, last_synced_at, last_count FROM sync_config ORDER BY id DESC LIMIT 1`
  );
  res.json(result.rows[0] || null);
});

router.post("/", async (req: Request, res: Response) => {
  const body = req.body as SyncRequest;

  if (!body.seqUrl) {
    res.status(400).json({ error: "seqUrl é obrigatório" });
    return;
  }

  const baseUrl = body.seqUrl.replace(/\/$/, "");
  const maxTotal = body.count || 5000;
  const useRaw = !!body.apiKey;
  const headers: Record<string, string> = {};
  if (body.apiKey) headers["X-Seq-ApiKey"] = body.apiKey;

  let totalImported = 0;
  let totalSkipped = 0;
  let totalFetched = 0;
  let afterId: string | undefined = undefined;
  let pages = 0;

  try {
    while (totalFetched < maxTotal) {
      const url = buildUrl(baseUrl, useRaw, body.signal, body.startDate, body.endDate, afterId);
      const { status, body: responseBody } = await httpsGet(url, headers);

      if (status < 200 || status >= 300) {
        let hint = "";
        if (status === 401) hint = " — Sem autenticação. Verifique as credenciais.";
        if (status === 403) hint = " — Sem permissão.";
        res.status(status).json({ error: `Seq retornou ${status}${hint}`, raw: responseBody.slice(0, 300) });
        return;
      }

      const parsed = JSON.parse(responseBody);
      let pageEvents: ReturnType<typeof parseSeqApiEvent>[];

      if (useRaw) {
        const raw: RawSeqEvent[] = (parsed as { Events?: RawSeqEvent[] }).Events || [];
        pageEvents = raw.map(parseSeqEvent);
      } else {
        const apiEvents: SeqApiEvent[] = Array.isArray(parsed) ? parsed : [];
        pageEvents = apiEvents.map(parseSeqApiEvent);
      }

      if (pageEvents.length === 0) break; // sem mais eventos

      const { imported, skipped } = await upsertEvents(pageEvents);
      totalImported += imported;
      totalSkipped += skipped;
      totalFetched += pageEvents.length;
      pages++;

      // ID do evento mais antigo da página (último na lista — Seq retorna do mais novo para o mais antigo)
      const lastEvent = pageEvents[pageEvents.length - 1];
      const lastId = lastEvent.event_id;

      // Se recebeu menos que PAGE_SIZE, chegou ao fim
      if (pageEvents.length < PAGE_SIZE || !lastId) break;

      afterId = lastId;
    }

    await query(
      `INSERT INTO sync_config (seq_url, api_key, signal, last_synced_at, last_count)
       VALUES ($1, $2, $3, NOW(), $4)`,
      [body.seqUrl, body.apiKey || null, body.signal || null, totalImported]
    ).catch(() =>
      query(
        `UPDATE sync_config SET seq_url=$1, api_key=$2, signal=$3, last_synced_at=NOW(), last_count=$4, updated_at=NOW()
         WHERE id=(SELECT id FROM sync_config ORDER BY id LIMIT 1)`,
        [body.seqUrl, body.apiKey || null, body.signal || null, totalImported]
      )
    );

    res.json({
      imported: totalImported,
      skipped: totalSkipped,
      total: totalFetched,
      pages,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    res.status(500).json({ error: `Falha ao conectar ao Seq: ${message}` });
  }
});

export default router;
