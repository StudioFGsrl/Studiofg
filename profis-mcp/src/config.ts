// Configurazione letta da variabili d'ambiente (vedi .env.example).

export type AuthMode = "bearer" | "apikey" | "oauth_client_credentials" | "basic";

export interface Endpoints {
  documentiCerca: string;
  documentoLeggi: string;
  documentoCronologia: string;
  allegatiCerca: string;
  allegatoLeggi: string;
  annotazioniCerca: string;
  annotazioneLeggi: string;
}

export interface Config {
  baseUrl: string;
  authMode: AuthMode;
  token?: string;
  apiKeyHeader: string;
  apiKey?: string;
  username?: string;
  password?: string;
  oauthTokenUrl?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthScope?: string;
  extraHeaders: Record<string, string>;
  endpoints: Endpoints;
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

function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("PROFIS_EXTRA_HEADERS deve essere un oggetto JSON");
  }
  return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
}

export function loadConfig(): Config {
  const authMode = (env("PROFIS_AUTH_MODE") ?? "bearer") as AuthMode;
  if (!["bearer", "apikey", "oauth_client_credentials", "basic"].includes(authMode)) {
    throw new Error(`PROFIS_AUTH_MODE non valido: ${authMode}`);
  }

  const cfg: Config = {
    baseUrl: required("PROFIS_BASE_URL").replace(/\/+$/, ""),
    authMode,
    token: env("PROFIS_TOKEN"),
    apiKeyHeader: env("PROFIS_API_KEY_HEADER") ?? "X-BC-GruppoPwd",
    apiKey: env("PROFIS_API_KEY"),
    username: env("PROFIS_USERNAME"),
    password: env("PROFIS_PASSWORD"),
    oauthTokenUrl: env("PROFIS_OAUTH_TOKEN_URL"),
    oauthClientId: env("PROFIS_OAUTH_CLIENT_ID"),
    oauthClientSecret: env("PROFIS_OAUTH_CLIENT_SECRET"),
    oauthScope: env("PROFIS_OAUTH_SCOPE"),
    extraHeaders: parseHeaders(env("PROFIS_EXTRA_HEADERS")),
    endpoints: {
      documentiCerca: env("PROFIS_EP_DOCUMENTI_CERCA") ?? "/GestioneDocumentale/Documenti/Ricerca",
      documentoLeggi: env("PROFIS_EP_DOCUMENTO_LEGGI") ?? "/GestioneDocumentale/Documenti/LeggiDaGuid",
      documentoCronologia: env("PROFIS_EP_DOCUMENTO_CRONOLOGIA") ?? "/GestioneDocumentale/Documenti/Cronologia",
      allegatiCerca: env("PROFIS_EP_ALLEGATI_CERCA") ?? "/GestioneDocumentale/Allegati/LeggiElenco",
      allegatoLeggi: env("PROFIS_EP_ALLEGATO_LEGGI") ?? "/GestioneDocumentale/Allegati/Leggi",
      annotazioniCerca: env("PROFIS_EP_ANNOTAZIONI_CERCA") ?? "/GestioneDocumentale/Annotazioni/LeggiElenco",
      annotazioneLeggi: env("PROFIS_EP_ANNOTAZIONE_LEGGI") ?? "/GestioneDocumentale/Annotazioni/Leggi",
    },
    timeoutMs: Number(env("PROFIS_TIMEOUT_MS") ?? 30000),
    maxResponseChars: Number(env("PROFIS_MAX_RESPONSE_CHARS") ?? 100000),
    transport: (env("MCP_TRANSPORT") ?? "stdio") === "http" ? "http" : "stdio",
    httpHost: env("MCP_HTTP_HOST") ?? "127.0.0.1",
    httpPort: Number(env("MCP_HTTP_PORT") ?? 3000),
    mcpAuthToken: env("MCP_AUTH_TOKEN"),
    allowedHosts: env("MCP_ALLOWED_HOSTS")?.split(",").map((h) => h.trim()),
  };

  switch (cfg.authMode) {
    case "bearer":
      if (!cfg.token) throw new Error("PROFIS_TOKEN obbligatorio con PROFIS_AUTH_MODE=bearer");
      break;
    case "apikey":
      if (!cfg.apiKey) throw new Error("PROFIS_API_KEY obbligatorio con PROFIS_AUTH_MODE=apikey");
      break;
    case "basic":
      if (!cfg.username || !cfg.password) {
        throw new Error("PROFIS_USERNAME e PROFIS_PASSWORD obbligatori con PROFIS_AUTH_MODE=basic");
      }
      break;
    case "oauth_client_credentials":
      if (!cfg.oauthTokenUrl || !cfg.oauthClientId || !cfg.oauthClientSecret) {
        throw new Error(
          "PROFIS_OAUTH_TOKEN_URL, PROFIS_OAUTH_CLIENT_ID e PROFIS_OAUTH_CLIENT_SECRET obbligatori con oauth_client_credentials",
        );
      }
      break;
  }

  // In HTTP il server è raggiungibile in rete: senza token chiunque leggerebbe i dati dello studio.
  if (cfg.transport === "http" && !cfg.mcpAuthToken) {
    throw new Error("MCP_AUTH_TOKEN obbligatorio con MCP_TRANSPORT=http");
  }

  return cfg;
}
