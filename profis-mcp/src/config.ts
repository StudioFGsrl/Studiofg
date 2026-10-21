// Configurazione letta da variabili d'ambiente (vedi .env.example).

import { createHash } from "node:crypto";

export interface Config {
  baseUrl: string;
  appId: string;
  user?: string;
  passwordSha256?: string;
  staticToken?: string;
  gruppo?: string;
  gruppoPwdSha256?: string;
  downloadDir?: string;
  maxFileBytes: number;
  timeoutMs: number;
  maxResponseChars: number;
  transport: "stdio" | "http";
  httpHost: string;
  httpPort: number;
  mcpAuthToken?: string;
  allowedHosts?: string[];
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? undefined : v.trim();
}

function required(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Variabile d'ambiente mancante: ${name}`);
  return v;
}

// PROFIS vuole le password già cifrate SHA256: si può fornire la password in chiaro o l'hash pronto.
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashed(plainVar: string, hashVar: string): string | undefined {
  const hash = env(hashVar);
  if (hash) return hash;
  const plain = env(plainVar);
  return plain ? sha256Hex(plain) : undefined;
}

export function loadConfig(): Config {
  const cfg: Config = {
    baseUrl: (env("PROFIS_BASE_URL") ?? "https://serviziprofis.sisteminrete.com").replace(/\/+$/, ""),
    appId: required("PROFIS_APP_ID"),
    user: env("PROFIS_USER"),
    passwordSha256: hashed("PROFIS_PASSWORD", "PROFIS_PASSWORD_SHA256"),
    staticToken: env("PROFIS_TOKEN"),
    gruppo: env("PROFIS_GRUPPO"),
    gruppoPwdSha256: hashed("PROFIS_GRUPPO_PWD", "PROFIS_GRUPPO_PWD_SHA256"),
    downloadDir: env("PROFIS_DOWNLOAD_DIR"),
    maxFileBytes: Number(env("PROFIS_MAX_FILE_BYTES") ?? 10 * 1024 * 1024),
    timeoutMs: Number(env("PROFIS_TIMEOUT_MS") ?? 60000),
    maxResponseChars: Number(env("PROFIS_MAX_RESPONSE_CHARS") ?? 100000),
    transport: (env("MCP_TRANSPORT") ?? "stdio") === "http" ? "http" : "stdio",
    httpHost: env("MCP_HTTP_HOST") ?? "127.0.0.1",
    httpPort: Number(env("MCP_HTTP_PORT") ?? 3000),
    mcpAuthToken: env("MCP_AUTH_TOKEN"),
    allowedHosts: env("MCP_ALLOWED_HOSTS")?.split(",").map((h) => h.trim()),
  };

  if (!cfg.staticToken && (!cfg.user || !cfg.passwordSha256)) {
    throw new Error("Indica PROFIS_USER e PROFIS_PASSWORD (o PROFIS_PASSWORD_SHA256), oppure un PROFIS_TOKEN");
  }

  // In HTTP il server è raggiungibile in rete: senza token chiunque leggerebbe i dati dello studio.
  if (cfg.transport === "http" && !cfg.mcpAuthToken) {
    throw new Error("MCP_AUTH_TOKEN obbligatorio con MCP_TRANSPORT=http");
  }

  return cfg;
}
