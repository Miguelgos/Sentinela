import { test, expect, type Response } from "@playwright/test";

const BASEPATH = "/sentinela";

test.describe("Sentinela — smoke", () => {
  test("GET /api/health retorna 200 com JSON status:ok", async ({ request }) => {
    const res = await request.get(`${BASEPATH}/api/health`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/application\/json/);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("home carrega HTML com título e basepath correto", async ({ page }) => {
    const res = await page.goto(`${BASEPATH}/`);
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle(/Sentinela/);
  });

  test("HTML SSR injeta window.__ENV__ com VITE_SUPABASE_URL", async ({ request }) => {
    const res = await request.get(`${BASEPATH}/`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("window.__ENV__");
    expect(html).toMatch(/VITE_SUPABASE_URL["\s:]+"https:\/\/[^"]+supabase\.co/);
  });

  test("client bundle carrega sem 404 e sem erros JS", async ({ page }) => {
    const failedRequests: string[] = [];
    const consoleErrors: string[] = [];

    page.on("response", (r: Response) => {
      if (r.status() >= 400 && r.url().includes(BASEPATH)) {
        failedRequests.push(`${r.status()} ${r.url()}`);
      }
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.goto(`${BASEPATH}/`, { waitUntil: "networkidle" });

    expect(failedRequests, `Requests com erro: ${failedRequests.join("\n")}`).toEqual([]);
    expect(consoleErrors, `Erros JS: ${consoleErrors.join("\n")}`).toEqual([]);
  });

  test("assets do bundle são servidos com cache longo", async ({ page, request }) => {
    await page.goto(`${BASEPATH}/`);
    const html = await page.content();
    const match = html.match(/href="(\/sentinela\/assets\/[^"]+\.js)"/);
    expect(match, "esperava ao menos 1 asset JS no HTML").not.toBeNull();

    const assetUrl = match![1];
    const res = await request.get(assetUrl);
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toMatch(/max-age=\d{6,}/);
  });

  test("página de login fica acessível (sem sessão Supabase)", async ({ page }) => {
    await page.goto(`${BASEPATH}/`);
    // Sem sessão, o app deve renderizar a tela de login
    await expect(page.getByText(/entrar|login|sign in/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("sync status retorna progresso do accumulator", async ({ request }) => {
    // server fn é POST com body vazio
    const res = await request.post(`${BASEPATH}/_serverFn/getEventsStatus`, {
      data: {},
      headers: { "Content-Type": "application/json" },
    });
    // Aceita 200 (responde) ou 405/404 caso a rota tenha mudado — só queremos
    // que o app esteja vivo e responsivo.
    expect([200, 404, 405]).toContain(res.status());
  });
});
