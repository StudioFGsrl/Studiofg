// Versione Cloudflare Workers del server MCP PROFIS (vedi wrangler.toml).
// Configurazione da variabili e segreti del Worker, con gli stessi nomi del file .env.

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { loadConfig, type Config } from "./config.js";
import { ProfisClient } from "./profis-client.js";
import { buildServer, tokenFrom, tokenMatches } from "./server.js";

type Env = Record<string, unknown>;

// Il client resta in memoria finché l'istanza del Worker è viva: così il token PROFIS viene riusato.
let cached: { cfg: Config; client: ProfisClient } | undefined;

function setup(env: Env) {
  if (!cached) {
    const cfg = loadConfig({ ...env, MCP_TRANSPORT: "http" });
    cached = { cfg, client: new ProfisClient(cfg) };
  }
  return cached;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json(200, { ok: true });

    const match = url.pathname.match(/^\/mcp(?:\/([^/]+))?\/?$/);
    if (!match) return json(404, { error: "not found" });

    let ctx: ReturnType<typeof setup>;
    try {
      ctx = setup(env);
    } catch (err) {
      // Configurazione incompleta: il messaggio nomina solo la variabile mancante, mai i valori.
      console.error(err);
      return json(500, { error: (err as Error).message });
    }

    const token = tokenFrom(match[1], request.headers.get("Authorization"));
    if (!tokenMatches(ctx.cfg.mcpAuthToken!, token)) return json(401, { error: "unauthorized" });

    if (request.method !== "POST") {
      return json(405, { jsonrpc: "2.0", error: { code: -32000, message: "Metodo non consentito" }, id: null });
    }

    // Modalità stateless: un server e un transport nuovi per ogni richiesta, risposte JSON senza SSE.
    const server = buildServer(ctx.cfg, ctx.client, { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};
