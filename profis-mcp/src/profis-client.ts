// Client HTTP verso le API di PROFIS in cloud.

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

export class ProfisClient {
  private oauthToken?: { value: string; expiresAt: number };

  constructor(private readonly cfg: Config) {}

  async post(path: string, body: unknown): Promise<unknown> {
    const res = await this.send(path, body);
    // Token OAuth scaduto o revocato lato server: ne chiediamo uno nuovo e riproviamo una volta.
    if (res.status === 401 && this.cfg.authMode === "oauth_client_credentials") {
      this.oauthToken = undefined;
      return this.parse(await this.send(path, body));
    }
    return this.parse(res);
  }

  private async send(path: string, body: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...this.cfg.extraHeaders,
      ...(await this.authHeaders()),
    };
    try {
      return await fetch(this.cfg.baseUrl + path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (err) {
      throw new ProfisError(`Impossibile contattare PROFIS (${path}): ${(err as Error).message}`);
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

  private async authHeaders(): Promise<Record<string, string>> {
    switch (this.cfg.authMode) {
      case "bearer":
        return { Authorization: `Bearer ${this.cfg.token}` };
      case "apikey":
        return { [this.cfg.apiKeyHeader]: this.cfg.apiKey! };
      case "basic":
        return {
          Authorization: "Basic " + Buffer.from(`${this.cfg.username}:${this.cfg.password}`).toString("base64"),
        };
      case "oauth_client_credentials":
        return { Authorization: `Bearer ${await this.getOauthToken()}` };
    }
  }

  private async getOauthToken(): Promise<string> {
    if (this.oauthToken && Date.now() < this.oauthToken.expiresAt) return this.oauthToken.value;

    const form = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.cfg.oauthClientId!,
      client_secret: this.cfg.oauthClientSecret!,
    });
    if (this.cfg.oauthScope) form.set("scope", this.cfg.oauthScope);

    const res = await fetch(this.cfg.oauthTokenUrl!, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });
    if (!res.ok) {
      throw new ProfisError(`Autenticazione OAuth fallita: ${res.status}`, res.status, (await res.text()).slice(0, 500));
    }
    const data = (await res.json()) as { access_token: string; expires_in?: number };
    // Rinnoviamo un minuto prima della scadenza dichiarata.
    const ttl = Math.max((data.expires_in ?? 3600) - 60, 30);
    this.oauthToken = { value: data.access_token, expiresAt: Date.now() + ttl * 1000 };
    return data.access_token;
  }
}
