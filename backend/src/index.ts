import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import eventsRouter from "./routes/events";
import syncRouter from "./routes/sync";
import pessoaRouter from "./routes/pessoa";
import autosyncRouter from "./routes/autosync";
import datadogRouter from "./routes/datadog";
import gocacheRouter from "./routes/gocache";
import { startAutoSync } from "./autosync";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.use("/api/events", eventsRouter);
app.use("/api/sync", syncRouter);
app.use("/api/pessoa", pessoaRouter);
app.use("/api/autosync", autosyncRouter);
app.use("/api/datadog", datadogRouter);
app.use("/api/gocache", gocacheRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Backend rodando em http://localhost:${PORT}`);
  startAutoSync();
});
