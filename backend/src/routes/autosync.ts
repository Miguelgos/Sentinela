import { Router, Request, Response } from "express";
import { startAutoSync, stopAutoSync, getAutoSyncStatus } from "../autosync";

const router = Router();

router.post("/start", (req: Request, res: Response) => {
  const { seqUrl, signal, apiKey, intervalMs } = req.body as {
    seqUrl?: string;
    signal?: string;
    apiKey?: string;
    intervalMs?: number;
  };
  startAutoSync({ seqUrl, signal, apiKey, intervalMs });
  res.json({ message: "Auto-sync iniciado", status: getAutoSyncStatus() });
});

router.post("/stop", (_req: Request, res: Response) => {
  stopAutoSync();
  res.json({ message: "Auto-sync parado", status: getAutoSyncStatus() });
});

router.get("/status", (_req: Request, res: Response) => {
  res.json(getAutoSyncStatus());
});

export default router;
