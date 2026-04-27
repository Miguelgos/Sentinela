import { defineNitroPlugin } from "nitropack/runtime";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), "backend/.env") });

export default defineNitroPlugin(async () => {
  const { initAccumulator } = await import("../../../backend/src/accumulator");
  console.log("[nitro] inicializando accumulator...");
  try {
    await initAccumulator();
  } catch (err) {
    console.error("[nitro] falha ao inicializar accumulator:", err);
  }
});
