# profis-mcp

Server MCP che collega Claude a **PROFIS (Sistemi) su SISTEMINRETE**, in sola lettura.
È basato sui servizi REST documentati in `https://serviziprofis.sisteminrete.com/swagger/ui/index` (versione 1.0), di cui c'è una copia in [`docs/swagger-1.0.json`](docs/swagger-1.0.json).

## Strumenti

| Strumento | Servizio PROFIS |
|---|---|
| `profis_documenti_cerca` | `GD_DOCUMENTI/Ricerca`: documenti per ditta, tipologia, anno o date, chiavi |
| `profis_documento_leggi` | `GD_DOCUMENTI/LeggiDaGuid` |
| `profis_documento_cronologia` | `GD_DOCUMENTI/Cronologia` |
| `profis_documento_scarica` | `GD_DOCUMENTI/DownloadFile`: originale, firmato, marcato, HTML/PDF della fattura elettronica |
| `profis_ditte_documenti_variati` | `GD_DOCUMENTI/LeggiDitteDocVariati` |
| `profis_allegati_cerca` / `profis_allegato_leggi` | `GD_ALLEGATI/LeggiElenco`, `Leggi` |
| `profis_allegato_scarica` | `GD_ALLEGATI/Download`, anche per la copia di cortesia |
| `profis_annotazioni_cerca` / `profis_annotazione_leggi` | `GD_ANNOTAZIONI/LeggiElenco`, `Leggi` |
| `profis_report_info` / `profis_report_esegui` | `report/Info/{name}`, `report/RunReport/{name}`: qualsiasi report con il flag "Abilita per il Web" |
| `profis_anni` / `profis_gruppi` | `System/GetAnni`, `System/GetGruppi` |

I servizi di scrittura (`Archivia`, `Aggiorna`, `Inserisci`, `Elimina`, upload) esistono in PROFIS ma volutamente **non** sono esposti.

### Report

I report sono la parte più ricca: ogni report di PROFIS con il flag **Abilita per il Web** diventa interrogabile da Claude. Possono contenere anagrafiche, scadenze, contabilità o qualsiasi altra vista configurata. Claude chiama prima `profis_report_info` per conoscere colonne e filtri, poi `profis_report_esegui`.

## Autenticazione

1. Il server chiama `POST /auth/App-{AppId}/Token` con `{ "User": ..., "Key": SHA256(password) }`.
2. Il token ricevuto viaggia nell'header `X-BC-Authorization` di ogni chiamata e viene rinnovato da solo quando scade.
3. Se è indicato un gruppo, il server aggiunge anche `X-BC-Gruppo` e `X-BC-GruppoPwd` (SHA256).

Da chiedere a Sistemi o al rivenditore:
- il valore **AppId** usato negli URL (`App-{AppId}`);
- un **utente abilitato ai servizi web**, meglio se dedicato e con permessi di sola consultazione;
- se serve, **codice e password del gruppo**.

L'hash SHA256 è calcolato in esadecimale minuscolo. Se PROFIS ne vuole un altro formato, metti l'hash già pronto in `PROFIS_PASSWORD_SHA256`.

## Installazione

```bash
cd profis-mcp
npm install
npm run build
npm test      # test contro un finto PROFIS locale
```

## Configurazione: il file `.env`

Il file `.env` **non è nel repository**, ed è voluto: contiene le password ed è escluso da git. Va creato sul PC dove gira il server, copiando il modello:

```bash
# Windows (prompt dei comandi, nella cartella profis-mcp)
copy .env.example .env
# macOS / Linux
cp .env.example .env
```

Poi apri `.env` con il Blocco note e compila `PROFIS_APP_ID`, `PROFIS_USER`, `PROFIS_PASSWORD`, più eventuali dati del gruppo.
All'avvio il server legge da solo `profis-mcp/.env`. Per usare un altro percorso, indicalo in `PROFIS_ENV_FILE`.
Le variabili già impostate nell'ambiente, ad esempio nel blocco `env` di `claude_desktop_config.json`, hanno la precedenza sul file.

In Esplora risorse di Windows i file che iniziano con il punto si vedono normalmente. Se il Blocco note salva `.env.txt`, scegli "Tutti i file" come tipo al momento del salvataggio.

## Uso con Claude Desktop (sul PC dello studio)

In `claude_desktop_config.json`, con il `.env` già compilato:

```json
{
  "mcpServers": {
    "profis": {
      "command": "node",
      "args": ["C:\\percorso\\profis-mcp\\dist\\index.js"]
    }
  }
}
```

## Uso con Claude Code

```bash
claude mcp add profis -- node /percorso/profis-mcp/dist/index.js
```

## Pubblicazione sul dominio (es. `mcp.studiofgsrl.it`)

In modalità HTTP il server richiede due variabili:
- **`MCP_AUTH_TOKEN`**: almeno 32 caratteri casuali. Si genera con `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
- **`MCP_ALLOWED_HOSTS=mcp.studiofgsrl.it`**: senza questa il server risponde 403 alle richieste che arrivano dal dominio.

L'indirizzo da dare a Claude è **`https://mcp.studiofgsrl.it/mcp/<MCP_AUTH_TOKEN>`**. Il token sta nell'URL perché i connettori personalizzati di claude.ai non permettono di aggiungere header. Va trattato come una password.

### Consigliato: Render + DNS su Register.it

Il dominio `studiofgsrl.it` è su Register.it con hosting WordPress, che non esegue Node.js. Il server gira quindi su [Render](https://render.com) e da Register.it si punta lì solo il sottodominio `mcp`. Il sito WordPress non cambia.

1. **Token:** generalo sul PC con
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
   (oppure con qualsiasi generatore di password, purché usi solo lettere, cifre, `-` e `_`, con almeno 32 caratteri).
2. **Render:** crea un account → *New* → *Blueprint* → collega il repository GitHub `studiofgsrl/studiofg`. Render legge `render.yaml` dalla radice del repository e chiede i valori segreti: `MCP_AUTH_TOKEN`, `PROFIS_APP_ID`, `PROFIS_USER`, `PROFIS_PASSWORD`, più il gruppo se serve (altrimenti lascia vuoto).
   Piano **Starter** (circa 7 $/mese): quello gratuito si spegne dopo un periodo di inattività e Claude andrebbe in timeout.
3. **Verifica:** `https://profis-mcp.onrender.com/health` deve rispondere `{"ok":true}`.
4. **DNS su Register.it:** *Dominio & DNS* → gestione DNS di `studiofgsrl.it` → aggiungi un record **CNAME** con nome `mcp` e valore `profis-mcp.onrender.com`.
   Poi in Render → *Settings* → *Custom Domains* attendi la verifica: il certificato HTTPS lo crea Render.
5. **Verifica finale:** `https://mcp.studiofgsrl.it/health`.
6. **Indirizzo IP per Sistemi:** se PROFIS accetta solo IP abilitati, in Render → *Connect* → *Outbound* trovi gli IP in uscita da comunicare a Sistemi.

Se Render assegna un nome diverso da `profis-mcp.onrender.com` (succede quando è già occupato), usa quello nel CNAME e aggiornalo in `MCP_ALLOWED_HOSTS`.

### A) Hosting condiviso con cPanel ("Setup Node.js App")

1. **Sottodominio:** in cPanel → *Domini*, crea `mcp.studiofgsrl.it` e attiva il certificato SSL (AutoSSL / Let's Encrypt).
2. **File:** carica e decomprimi `profis-mcp-hosting.zip` in una cartella fuori da `public_html`, ad esempio `/home/<utente>/profis-mcp`. Lo zip contiene già il codice compilato.
3. **App Node.js:** in cPanel → *Setup Node.js App* → *Create Application*:
   - Node.js version: **20.12 o superiore** (meglio 22)
   - Application mode: Production
   - Application root: `profis-mcp`
   - Application URL: `mcp.studiofgsrl.it`
   - Application startup file: **`app.cjs`**
4. **Variabili** (*Environment variables* nella stessa pagina):
   `MCP_TRANSPORT=http`, `MCP_AUTH_TOKEN=…`, `MCP_ALLOWED_HOSTS=mcp.studiofgsrl.it`,
   `PROFIS_APP_ID=…`, `PROFIS_USER=…`, `PROFIS_PASSWORD=…`, più gruppo se serve.
   In alternativa puoi creare il file `.env` nella cartella dell'app.
5. Clicca **Run NPM Install**, poi **Restart**.
6. **Verifica:** `https://mcp.studiofgsrl.it/health` deve rispondere `{"ok":true}`.

Se *Setup Node.js App* non c'è, l'hosting non esegue Node.js. In quel caso serve un VPS (soluzione B) o un servizio come Render o Railway, con il sottodominio `mcp` puntato lì.

### B) VPS con Docker

```bash
cp .env.example .env      # compila credenziali, MCP_AUTH_TOKEN e MCP_DOMAIN=mcp.studiofgsrl.it
docker compose up -d --build
```

Prima punta il record DNS `mcp.studiofgsrl.it` all'IP del server. Caddy ottiene e rinnova da solo il certificato HTTPS.

### Collegarlo a Claude

- **claude.ai / app Claude:** *Impostazioni → Connettori → Aggiungi connettore personalizzato*, URL `https://mcp.studiofgsrl.it/mcp/<token>`.
- **Claude Code:** `claude mcp add --transport http profis https://mcp.studiofgsrl.it/mcp --header "Authorization: Bearer <token>"`.

## Nota: PROFIS ha anche un endpoint MCP nativo

Lo swagger espone `POST /MCP/App-{AppId}` (sezione "MCP AI"). È un server MCP di Sistemi, protetto dallo stesso token `X-BC-Authorization`. Probabilmente è quello dietro il connettore "Profis" già disponibile su claude.ai.
Questo progetto resta utile perché gestisce da solo login e rinnovo del token, scarica i file ed esegue i report.

## Sicurezza

- Le credenziali restano nelle variabili d'ambiente. Non vanno salvate nel repository (`.env` è in `.gitignore`).
- Il server è in sola lettura. Claude riceve l'istruzione di trattare i contenuti dei documenti come dati e non come istruzioni.
- Le risposte troppo lunghe vengono troncate (`PROFIS_MAX_RESPONSE_CHARS`), e i file oltre `PROFIS_MAX_FILE_BYTES` vanno salvati su disco.
