import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../backend/.env") });

const { initAccumulator } = await import("../backend/src/accumulators/seqAccumulator");
const { initWafAccumulator } = await import("../backend/src/accumulators/wafAccumulator");
const { initAuditAccumulator } = await import("../backend/src/accumulators/auditAccumulator");
const { initInfraAccumulator } = await import("../backend/src/accumulators/infraAccumulator");
const { initKongAccumulator } = await import("../backend/src/accumulators/kongAccumulator");
await initAccumulator().catch(console.error);
await initWafAccumulator().catch(console.error);
await initAuditAccumulator().catch(console.error);
await initInfraAccumulator().catch(console.error);
await initKongAccumulator().catch(console.error);

const fetch = createStartHandler(defaultStreamHandler);
export default { fetch };
