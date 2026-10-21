# profis-mcp

Server MCP che collega Claude a **PROFIS (Sistemi) in cloud**, in sola lettura, sulla Gestione Documentale.

## Strumenti

| Strumento | Cosa fa |
|---|---|
| `profis_documenti_cerca` | Cerca documenti per cliente (CodiceDitta / PIva / CodFiscale / CodGruppo) e periodo (AnnoRif / date) |
| `profis_documento_leggi` | Legge un documento dal `GuidUnivoco` |
| `profis_documento_cronologia` | Cronologia/versioni del documento |
| `profis_allegati_cerca` / `profis_allegato_leggi` | Elenco e lettura degli allegati |
| `profis_annotazioni_cerca` / `profis_annotazione_leggi` | Elenco e lettura delle note |

Non ci sono strumenti di scrittura.

## Prima di usarlo: dati da chiedere a Sistemi

Le API REST di PROFIS non hanno documentazione pubblica. Al rivenditore o all'assistenza Sistemi servono:

1. **URL base** delle API cloud (`PROFIS_BASE_URL`)
2. **Metodo di autenticazione** e credenziali (token, API key, OAuth client credentials…)
3. **Percorsi esatti** degli endpoint della Gestione Documentale. Quelli predefiniti sono ipotesi e si cambiano con le variabili `PROFIS_EP_*`
4. Eventuali **header obbligatori**, come un codice studio (`PROFIS_EXTRA_HEADERS`)

## Installazione

```bash
cd profis-mcp
npm install
npm run build
npm test      # test contro un finto PROFIS locale
```

## Uso con Claude Desktop (sul PC dello studio)

In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "profis": {
      "command": "node",
      "args": ["C:\\percorso\\profis-mcp\\dist\\index.js"],
      "env": {
        "PROFIS_BASE_URL": "https://...",
        "PROFIS_AUTH_MODE": "bearer",
        "PROFIS_TOKEN": "..."
      }
    }
  }
}
```

## Uso con Claude Code

```bash
claude mcp add profis -e PROFIS_BASE_URL=https://... -e PROFIS_TOKEN=... -- node /percorso/profis-mcp/dist/index.js
```

## Uso come connettore su claude.ai (HTTP)

```bash
MCP_TRANSPORT=http MCP_HTTP_HOST=0.0.0.0 MCP_HTTP_PORT=3000 \
MCP_AUTH_TOKEN=<token-lungo-casuale> MCP_ALLOWED_HOSTS=mcp.tuodominio.it \
PROFIS_BASE_URL=https://... PROFIS_TOKEN=... \
npm start
```

Pubblicalo dietro HTTPS, ad esempio con un reverse proxy, e aggiungi `https://mcp.tuodominio.it/mcp` come connettore personalizzato.
Senza `MCP_AUTH_TOKEN` il server in HTTP si rifiuta di partire.

## Sicurezza

- Le credenziali PROFIS restano nelle variabili d'ambiente. Non vanno salvate nel repository (`.env` è in `.gitignore`).
- Il server è in sola lettura. Claude riceve l'istruzione di trattare i contenuti dei documenti come dati e non come istruzioni.
- Le risposte troppo lunghe vengono troncate (`PROFIS_MAX_RESPONSE_CHARS`).
