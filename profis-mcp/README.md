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

## Uso come connettore su claude.ai (HTTP)

```bash
MCP_TRANSPORT=http MCP_HTTP_HOST=0.0.0.0 MCP_HTTP_PORT=3000 \
MCP_AUTH_TOKEN=<token-lungo-casuale> MCP_ALLOWED_HOSTS=mcp.tuodominio.it \
PROFIS_APP_ID=... PROFIS_USER=... PROFIS_PASSWORD=... \
npm start
```

Pubblicalo dietro HTTPS, ad esempio con un reverse proxy, e aggiungi `https://mcp.tuodominio.it/mcp` come connettore personalizzato.
Senza `MCP_AUTH_TOKEN` il server in HTTP si rifiuta di partire.

## Nota: PROFIS ha anche un endpoint MCP nativo

Lo swagger espone `POST /MCP/App-{AppId}` (sezione "MCP AI"). È un server MCP di Sistemi, protetto dallo stesso token `X-BC-Authorization`. Probabilmente è quello dietro il connettore "Profis" già disponibile su claude.ai.
Questo progetto resta utile perché gestisce da solo login e rinnovo del token, scarica i file ed esegue i report.

## Sicurezza

- Le credenziali restano nelle variabili d'ambiente. Non vanno salvate nel repository (`.env` è in `.gitignore`).
- Il server è in sola lettura. Claude riceve l'istruzione di trattare i contenuti dei documenti come dati e non come istruzioni.
- Le risposte troppo lunghe vengono troncate (`PROFIS_MAX_RESPONSE_CHARS`), e i file oltre `PROFIS_MAX_FILE_BYTES` vanno salvati su disco.
