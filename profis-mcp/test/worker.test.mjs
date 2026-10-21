// Test della versione Cloudflare Workers: wrangler dev (runtime workerd) contro un finto PROFIS locale.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_TOKEN = "w".repeat(40);
const PORT = 8787 + Math.floor(Math.random() * 500);
let mock;
let wrangler;
const calls = [];

before(async () => {
  mock = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push({ url: req.url, headers: req.headers, body: body ? JSON.parse(body) : undefined });
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url === "/auth/App-STUDIO/Token") return res.end(JSON.stringify("tok-worker"));
      if (req.url === "/api/GD_DOCUMENTI/App-STUDIO/DownloadFile") {
        return res.end(
          JSON.stringify({ Esito: { Esito: 1 }, NomeFile: "a.pdf", FileStream: { BUFFER: Buffer.from("PDF").toString("base64") } }),
        );
      }
      res.end(JSON.stringify({ Esito: { Esito: 1 }, Documenti: [{ Guid: "abc", Descrizione: "F24" }] }));
    });
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const vars = {
    PROFIS_BASE_URL: `http://127.0.0.1:${mock.address().port}`,
    PROFIS_APP_ID: "STUDIO",
    PROFIS_USER: "mario",
    PROFIS_PASSWORD: "pw",
    MCP_AUTH_TOKEN: MCP_TOKEN,
  };
  const args = ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--log-level", "warn"];
  for (const [k, v] of Object.entries(vars)) args.push("--var", `${k}:${v}`);
  // detached: a fine test si chiude l'intero gruppo (npx, wrangler e workerd).
  wrangler = spawn("npx", args, { stdio: "ignore", detached: true, env: { ...process.env, CI: "1" } });
  // Attende che il Worker risponda.
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("wrangler dev non si è avviato");
});

after(() => {
  if (wrangler) process.kill(-wrangler.pid, "SIGTERM");
  mock?.close();
});

test("worker: token, elenco strumenti, chiamata e download", async () => {
  const base = `http://127.0.0.1:${PORT}`;
  assert.equal((await fetch(`${base}/mcp/${"x".repeat(40)}`, { method: "POST", body: "{}" })).status, 401);

  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${MCP_TOKEN}`)));
  const { tools } = await client.listTools();
  assert.equal(tools.length, 14);

  const r = await client.callTool({
    name: "profis_documenti_cerca",
    arguments: { Tipologia: 1, AnnoRif: 2026, CodiceDitta: 42 },
  });
  assert.ok(!r.isError, r.content[0].text);
  assert.match(r.content[0].text, /F24/);
  const login = calls.find((c) => c.url === "/auth/App-STUDIO/Token");
  assert.equal(login.body.Key, "30c952fab122c3f9759f02a6d95c3758b246b4fee239957b2d4fee46e26170c4");
  assert.equal(calls.at(-1).headers["x-bc-authorization"], "tok-worker");

  const d = await client.callTool({ name: "profis_documento_scarica", arguments: { GuidUnivoco: "abc" } });
  assert.ok(!d.isError, d.content[0].text);
  assert.equal(d.content[1].resource.mimeType, "application/pdf");
  await client.close();
});
