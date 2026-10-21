// Test end-to-end: finto PROFIS locale + server MCP avviato su stdio e su HTTP.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

let mock;
let base;
const calls = [];

before(async () => {
  mock = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body || "null") });
      if (req.headers.authorization !== "Bearer segreto") {
        res.writeHead(401).end("no");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ Documenti: [{ GuidUnivoco: "abc", Descrizione: "F24" }] }));
    });
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${mock.address().port}`;
});

after(() => mock.close());

const env = () => ({ ...process.env, PROFIS_BASE_URL: base, PROFIS_AUTH_MODE: "bearer", PROFIS_TOKEN: "segreto" });

test("stdio: elenco strumenti, ricerca e validazione", async () => {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: env() }));

  const { tools } = await client.listTools();
  assert.equal(tools.length, 7);
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));

  const ok = await client.callTool({
    name: "profis_documenti_cerca",
    arguments: { Tipologia: 1, AnnoRif: 2026, CodiceDitta: 42 },
  });
  assert.ok(!ok.isError);
  assert.match(ok.content[0].text, /F24/);
  const last = calls.at(-1);
  assert.equal(last.url, "/GestioneDocumentale/Documenti/Ricerca");
  assert.deepEqual(last.body, { Tipologia: 1, Take: 20, AnnoRif: 2026, CodiceDitta: 42 });

  const ko = await client.callTool({ name: "profis_documenti_cerca", arguments: { Tipologia: 1, AnnoRif: 2026 } });
  assert.equal(ko.isError, true);

  const all = await client.callTool({ name: "profis_allegato_leggi", arguments: { GuidUnivoco: "abc", NumeroAllegato: 1 } });
  assert.ok(!all.isError);
  assert.deepEqual(calls.at(-1).body, { GuidUnivoco: "abc", NumeroAllegato: 1 });

  await client.close();
});

test("stdio: errore PROFIS restituito come isError", async () => {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: { ...env(), PROFIS_TOKEN: "sbagliato" } }),
  );
  const r = await client.callTool({ name: "profis_documento_leggi", arguments: { GuidUnivoco: "abc" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /401/);
  await client.close();
});

test("http: token MCP obbligatorio", async () => {
  const port = 39000 + Math.floor(Math.random() * 1000);
  const proc = spawn("node", ["dist/index.js"], {
    env: { ...env(), MCP_TRANSPORT: "http", MCP_HTTP_PORT: String(port), MCP_AUTH_TOKEN: "tok-mcp" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  await new Promise((r) => proc.stderr.on("data", (d) => String(d).includes("in ascolto") && r()));
  try {
    const url = new URL(`http://127.0.0.1:${port}/mcp`);
    const noAuth = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(noAuth.status, 401);

    const client = new Client({ name: "test", version: "0" });
    await client.connect(
      new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: "Bearer tok-mcp" } } }),
    );
    const { tools } = await client.listTools();
    assert.equal(tools.length, 7);
    const r = await client.callTool({ name: "profis_annotazioni_cerca", arguments: { GuidUnivoco: "abc" } });
    assert.ok(!r.isError);
    await client.close();
  } finally {
    proc.kill();
  }
});
