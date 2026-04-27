import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../backend/.env") });

const { initAccumulator } = await import("../backend/src/accumulator");
await initAccumulator().catch(console.error);

export default createStartHandler(defaultStreamHandler);
