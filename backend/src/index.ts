import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

import eventsRouter from "./routes/events";
import pessoaRouter from "./routes/pessoa";
import datadogRouter from "./routes/datadog";
import gocacheRouter from "./routes/gocache";
import reportRouter from "./routes/report";
import grafanaRouter from "./routes/grafana";
import { initAccumulator } from "./accumulator";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use("/api/events",  eventsRouter);
app.use("/api/pessoa",  pessoaRouter);
app.use("/api/datadog", datadogRouter);
app.use("/api/gocache", gocacheRouter);
app.use("/api/report",  reportRouter);
app.use("/api/grafana", grafanaRouter);

app.get("/api/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`Backend rodando em http://localhost:${PORT}`);
  initAccumulator().catch((err) => console.error("[accumulator] falha crítica:", err));
});
