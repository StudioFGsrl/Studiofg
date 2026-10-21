// Test end-to-end: finto PROFIS (stesse rotte dello swagger 1.0) + server MCP su stdio e su HTTP.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PWD_HASH = createHash("sha256").update("pw").digest("hex");
const PDF = Buffer.from("%PDF-1.4 finto");
let mock;
let base;
let tokenCounter = 0;
let validToken;
const calls = [];

before(async () => {
  mock = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : undefined;
      calls.push({ method: req.method, url: req.url, headers: req.headers, body: json });
      const send = (status, data) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      };
      if (req.url === "/auth/App-STUDIO/Token") {
        if (json.User !== "mario" || json.Key !== PWD_HASH) return send(401, "credenziali errate");
        validToken = `tok-${++tokenCounter}`;
        return send(200, validToken);
      }
      if (req.headers["x-bc-authorization"] !== validToken) return send(401, "token non valido");
      if (req.url === "/api/GD_DOCUMENTI/App-STUDIO/DownloadFile") {
        return send(200, { Esito: { Esito: 1 }, NomeFile: "f24.pdf", FileStream: { BUFFER: PDF.toString("base64") } });
      }
      if (req.url === "/api/GD_ALLEGATI/App-STUDIO/Download") {
        return send(200, { Esito: { Esito: 2, Errori: [{ Codice: 7, Messaggio: "Allegato inesistente" }] } });
      }
      send(200, { Esito: { Esito: 1 }, Documenti: [{ Guid: "abc", Descrizione: "F24" }] });
    });
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${mock.address().port}`;
});

after(() => mock.close());

const env = (extra = {}) => ({
  ...process.env,
  PROFIS_BASE_URL: base,
  PROFIS_APP_ID: "STUDIO",
  PROFIS_USER: "mario",
  PROFIS_PASSWORD: "pw",
  PROFIS_GRUPPO: "G1",
  ...extra,
});

const clients = [];
after(() => Promise.all(clients.map((c) => c.close())));

async function stdioClient(extra) {
  const client = new Client({ name: "test", version: "0" });
  clients.push(client);
  await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: env(extra) }));
  return client;
}

test("stdio: login, ricerca, header e validazione", async () => {
  const client = await stdioClient();
  const { tools } = await client.listTools();
  assert.equal(tools.length, 14);
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));

  const ok = await client.callTool({
    name: "profis_documenti_cerca",
    arguments: { Tipologia: 1, AnnoRif: 2026, CodiceDitta: 42 },
  });
  assert.ok(!ok.isError, ok.content[0].text);
  assert.match(ok.content[0].text, /F24/);
  const last = calls.at(-1);
  assert.equal(last.url, "/api/GD_DOCUMENTI/App-STUDIO/Ricerca");
  assert.equal(last.headers["x-bc-gruppo"], "G1");
  assert.deepEqual(last.body, { Tipologia: 1, Take: 20, AnnoRif: 2026, CodiceDitta: 42 });

  const noDitta = await client.callTool({ name: "profis_documenti_cerca", arguments: { Tipologia: 1, AnnoRif: 2026 } });
  assert.equal(noDitta.isError, true);
  const troppiGiorni = await client.callTool({
    name: "profis_documenti_cerca",
    arguments: { Tipologia: 1, CodiceDitta: 1, CreazioneDataDa: "2024-01-01", CreazioneDataA: "2025-06-01" },
  });
  assert.equal(troppiGiorni.isError, true);

  await client.callTool({ name: "profis_ditte_documenti_variati", arguments: { VariazioneDataDa: "2026-10-01" } });
  assert.deepEqual(calls.at(-1).body, { Parametri: { VariazioneDataDa: "2026-10-01" } });

  await client.callTool({ name: "profis_report_esegui", arguments: { name: "Elenco ditte" } });
  assert.equal(calls.at(-1).url, "/report/App-STUDIO/RunReport/Elenco%20ditte");
  assert.deepEqual(calls.at(-1).body, { Skip: 0, Take: 100 });

  await client.callTool({ name: "profis_anni", arguments: {} });
  assert.equal(calls.at(-1).method, "GET");
  assert.equal(calls.at(-1).url, "/System/App-STUDIO/GetAnni");
  await client.close();
});

test("stdio: token scaduto viene rinnovato", async () => {
  const client = await stdioClient();
  await client.callTool({ name: "profis_documento_leggi", arguments: { GuidUnivoco: "abc" } });
  validToken = "revocato";
  const r = await client.callTool({ name: "profis_documento_leggi", arguments: { GuidUnivoco: "abc" } });
  assert.ok(!r.isError, r.content[0].text);
  await client.close();
});

test("stdio: download come risorsa, su disco ed errore PROFIS", async () => {
  const client = await stdioClient();
  const r = await client.callTool({ name: "profis_documento_scarica", arguments: { GuidUnivoco: "abc" } });
  assert.ok(!r.isError, r.content[0].text);
  assert.equal(r.content[1].resource.mimeType, "application/pdf");
  assert.equal(Buffer.from(r.content[1].resource.blob, "base64").toString(), PDF.toString());

  const ko = await client.callTool({
    name: "profis_allegato_scarica",
    arguments: { GuidUnivoco: "abc", NumeroAllegato: 3 },
  });
  assert.equal(ko.isError, true);
  assert.match(ko.content[0].text, /Allegato inesistente/);
  await client.close();

  const dir = await mkdtemp(path.join(tmpdir(), "profis-"));
  const client2 = await stdioClient({ PROFIS_DOWNLOAD_DIR: dir });
  const saved = await client2.callTool({ name: "profis_documento_scarica", arguments: { GuidUnivoco: "abc" } });
  assert.match(saved.content[0].text, /File salvato/);
  assert.equal((await readFile(path.join(dir, "abc_f24.pdf"))).toString(), PDF.toString());
  await client2.close();
});

test("stdio: credenziali errate", async () => {
  const client = await stdioClient({ PROFIS_PASSWORD: "sbagliata" });
  const r = await client.callTool({ name: "profis_anni", arguments: {} });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /401/);
  await client.close();
});

test("http: token MCP obbligatorio", async () => {
  const port = 39000 + Math.floor(Math.random() * 1000);
  const proc = spawn("node", ["dist/index.js"], {
    env: env({ MCP_TRANSPORT: "http", MCP_HTTP_PORT: String(port), MCP_AUTH_TOKEN: "tok-mcp" }),
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
    const r = await client.callTool({ name: "profis_annotazioni_cerca", arguments: { GuidUnivoco: "abc" } });
    assert.ok(!r.isError, r.content[0].text);
    await client.close();
  } finally {
    proc.kill();
  }
});
