import { Router, Request, Response } from "express";
import { lookupPessoas } from "../db/mssql";

const router = Router();

router.get("/lookup", async (req: Request, res: Response) => {
  const raw = (req.query.userIds as string) || "";
  const userIds = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (userIds.length === 0) { res.json({}); return; }
  try {
    res.json(await lookupPessoas(userIds));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
