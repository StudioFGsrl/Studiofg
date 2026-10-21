#!/usr/bin/env node
// Server MCP PROFIS: stdio (Claude Desktop / Claude Code) oppure HTTP (connettore personalizzato claude.ai).

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { Request, Response, NextFunction } from "express";
import { loadConfig, type Config } from "./config.js";
import { ProfisClient } from "./profis-client.js";
import { buildServer, tokenFrom, tokenMatches } from "./server.js";
import type { SaveFile } from "./tools.js";

// Carica il file .env della cartella profis-mcp (o quello indicato in PROFIS_ENV_FILE).
// Le variabili già impostate, ad esempio da claude_desktop_config.json, hanno la precedenza.
function loadEnvFile(): string | undefined {
  const file = process.env.PROFIS_ENV_FILE?.trim() || fileURLToPath(new URL("../.env", import.meta.url));
  if (!existsSync(file)) return undefined;
  process.loadEnvFile(file);
  return file;
}

function diskSaver(cfg: Config): SaveFile | undefined {
  const dir = cfg.downloadDir;
  if (!dir) return undefined;
  return async (nome, bytes) => {
    await mkdir(dir, { recursive: true });
    const dest = path.join(dir, nome);
    await writeFile(dest, bytes);
    return dest;
  };
}

function tokenAuth(expected: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const pathToken = typeof req.params.token === "string" ? req.params.token : undefined;
    if (!tokenMatches(expected, tokenFrom(pathToken, req.headers.authorization))) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}

async function main(): Promise<void> {
  const envFile = loadEnvFile();
  if (envFile) console.error(`Configurazione letta da ${envFile}`);
  const cfg = loadConfig();
  const client = new ProfisClient(cfg);
  const opts = { saveFile: diskSaver(cfg) };

  if (cfg.transport === "stdio") {
    await buildServer(cfg, client, opts).connect(new StdioServerTransport());
    console.error("profis-mcp avviato su stdio");
    return;
  }

  const app = createMcpExpressApp({ host: cfg.httpHost, allowedHosts: cfg.allowedHosts });
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Modalità stateless: un server e un transport nuovi per ogni richiesta.
  app.post(["/mcp", "/mcp/:token"], tokenAuth(cfg.mcpAuthToken!), async (req, res) => {
    const server = buildServer(cfg, client, opts);
    // Risposte JSON semplici invece di stream SSE: passano meglio dai proxy degli hosting condivisi.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("Errore MCP:", err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Errore interno" }, id: null });
      }
    }
  });
  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Metodo non consentito" }, id: null });
  };
  app.get(["/mcp", "/mcp/:token"], methodNotAllowed);
  app.delete(["/mcp", "/mcp/:token"], methodNotAllowed);

  app.listen(cfg.httpPort, cfg.httpHost, () => {
    console.error(`profis-mcp in ascolto su http://${cfg.httpHost}:${cfg.httpPort}/mcp`);
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
