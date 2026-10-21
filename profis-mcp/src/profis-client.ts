// Client HTTP verso i servizi REST di PROFIS su SISTEMINRETE (swagger/docs/1.0).

import type { Config } from "./config.js";

export class ProfisError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
  }
}

type Method = "GET" | "POST";

export class ProfisClient {
  private token?: string;

  constructor(private readonly cfg: Config) {
    this.token = cfg.staticToken;
  }

  /** Percorso relativo all'applicazione, es. "/api/GD_DOCUMENTI/App-{AppId}/Ricerca" con area e azione. */
  appPath(area: string, action = ""): string {
    const app = `App-${encodeURIComponent(this.cfg.appId)}`;
    return action ? `/${area}/${app}/${action}` : `/${area}/${app}`;
  }

  async request(method: Method, path: string, body?: unknown): Promise<unknown> {
    let res = await this.send(method, path, body, await this.getToken());
    // Token scaduto: se possiamo rifare il login, ne chiediamo uno nuovo e riproviamo una volta.
    if (res.status === 401 && this.canLogin()) {
      this.token = undefined;
      res = await this.send(method, path, body, await this.getToken());
    }
    return this.parse(res);
  }

  private canLogin(): boolean {
    return Boolean(this.cfg.user && this.cfg.passwordSha256);
  }

  private async getToken(): Promise<string> {
    if (this.token) return this.token;

    const res = await this.fetch(this.cfg.baseUrl + this.appPath("auth", "Token"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ User: this.cfg.user, Key: this.cfg.passwordSha256 }),
    });
    const data = await this.parse(res);
    const token = extractToken(data);
    if (!token) throw new ProfisError("PROFIS non ha restituito un token valido", res.status);
    this.token = token;
    return token;
  }

  /** Esegue una chiamata e restituisce la risposta grezza, anche se è un errore. Serve alla diagnosi. */
  async raw(
    method: Method,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string | undefined> = {},
  ): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: string }> {
    const res = await this.send(method, path, body, await this.getToken(), extraHeaders);
    return {
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries([...res.headers].filter(([k]) => k !== "set-cookie")),
      body: (await res.text()).slice(0, 4000),
    };
  }

  // In extraHeaders un valore undefined toglie l'header: così la diagnosi può provare senza gruppo.
  private async send(
    method: Method,
    path: string,
    body: unknown,
    token: string,
    extraHeaders: Record<string, string | undefined> = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json", "X-BC-Authorization": token };
    if (this.cfg.gruppo) headers["X-BC-Gruppo"] = this.cfg.gruppo;
    if (this.cfg.gruppoPwdSha256) headers["X-BC-GruppoPwd"] = this.cfg.gruppoPwdSha256;
    for (const [k, v] of Object.entries(extraHeaders)) {
      if (v === undefined) delete headers[k];
      else headers[k] = v;
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return this.fetch(this.cfg.baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private async fetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(this.cfg.timeoutMs) });
    } catch (err) {
      throw new ProfisError(`Impossibile contattare PROFIS: ${(err as Error).message}`);
    }
  }

  private async parse(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!res.ok) {
      throw new ProfisError(`PROFIS ha risposto ${res.status} ${res.statusText}`, res.status, text.slice(0, 2000));
    }
    if (text === "") return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

// Il servizio Token dichiara di restituire una stringa: accettiamo anche un oggetto con il token dentro.
function extractToken(data: unknown): string | undefined {
  if (typeof data === "string") return data.trim() || undefined;
  if (data && typeof data === "object") {
    for (const key of ["Token", "token", "access_token"]) {
      const v = (data as Record<string, unknown>)[key];
      if (typeof v === "string" && v) return v;
    }
  }
  return undefined;
}
