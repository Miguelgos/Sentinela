import { Router, Request, Response } from "express";
import { query } from "../db";
import { lookupPessoas } from "../db/mssql";

const router = Router();

// GET /api/pessoa/lookup?userIds=1,2,3  →  { "1": "João", "2": "Maria" }
router.get("/lookup", async (req: Request, res: Response) => {
  const raw = (req.query.userIds as string) || "";
  const userIds = raw.split(",").map((s) => s.trim()).filter(Boolean);

  if (userIds.length === 0) {
    res.json({});
    return;
  }

  try {
    const map = await lookupPessoas(userIds);
    res.json(map);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    res.status(500).json({ error: `Falha ao consultar ituranweb: ${message}` });
  }
});

// GET /api/pessoa/stats  →  top users com nm_pessoa resolvido
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT user_id, COUNT(*) as total,
              SUM(CASE WHEN level = 'Error' THEN 1 ELSE 0 END) as errors,
              SUM(CASE WHEN guid_cotacao = '00000000-0000-0000-0000-000000000000' THEN 1 ELSE 0 END) as empty_guid
       FROM seq_events
       WHERE user_id IS NOT NULL
       GROUP BY user_id
       ORDER BY errors DESC
       LIMIT 50`
    );

    const userIds = result.rows.map((r) => r.user_id);
    const names = await lookupPessoas(userIds);

    const rows = result.rows.map((r) => ({
      user_id: r.user_id,
      nm_pessoa: names[r.user_id] || null,
      total: parseInt(r.total),
      errors: parseInt(r.errors),
      empty_guid: parseInt(r.empty_guid),
    }));

    res.json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    res.status(500).json({ error: message });
  }
});

export default router;
