// Strumenti MCP esposti a Claude. Tutti in sola lettura: le API di scrittura (Archivia, Aggiorna,
// Inserisci, Elimina) esistono in PROFIS ma volutamente non sono esposte.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { ProfisClient, ProfisError } from "./profis-client.js";

const guid = z.string().min(1).describe("GuidUnivoco del documento PROFIS");
const dataIso = (d: string) => z.string().describe(`${d} (ISO 8601, es. 2026-01-31)`);
const oraHHMMSS = (d: string) => z.number().int().min(0).max(235959).describe(`${d}, formato HHMMSS (es. 162526)`);

const chiave = z.object({
  IdChiave: z.number().int().describe("Id della chiave di archiviazione"),
  Criterio: z.union([z.literal(1), z.literal(2), z.literal(6)]).describe("1 = Uguale, 2 = Da/A, 6 = Diverso"),
  ValoreStringaDa: z.string().optional(),
  ValoreStringaA: z.string().optional(),
  ValoreNumeroDa: z.number().int().optional(),
  ValoreNumeroA: z.number().int().optional(),
  ValoreImportoDa: z.number().optional(),
  ValoreImportoA: z.number().optional(),
  ValoreDataDa: z.string().optional(),
  ValoreDataA: z.string().optional(),
  ValoreAnnoDa: z.number().int().optional(),
  ValoreAnnoA: z.number().int().optional(),
});

const ricercaShape = {
  Tipologia: z.number().int().describe("Tipologia documentale PROFIS (obbligatoria)"),
  Take: z.number().int().min(1).max(100).default(20).describe("Numero massimo di documenti (1-100)"),
  Skip: z.number().int().min(0).optional().describe("Documenti da saltare, per la paginazione"),
  AnnoRif: z.number().int().optional().describe("Anno di riferimento"),
  CodiceDitta: z.number().int().optional().describe("Codice ditta in PROFIS"),
  PIva: z.string().optional().describe("Partita IVA della ditta"),
  CodFiscale: z.string().optional().describe("Codice fiscale della ditta"),
  CodGruppo: z.string().optional().describe("Codice gruppo (contesto azienda)"),
  Descrizione: z.string().optional().describe("Testo contenuto nella descrizione"),
  CreazioneDataDa: dataIso("Data creazione da").optional(),
  CreazioneDataA: dataIso("Data creazione a").optional(),
  VariazioneDataDa: dataIso("Data variazione da").optional(),
  VariazioneDataA: dataIso("Data variazione a").optional(),
  VariazioneOraDa: oraHHMMSS("Ora variazione da").optional(),
  VariazioneOraA: oraHHMMSS("Ora variazione a").optional(),
  SoloUltimaVersione: z.union([z.literal(0), z.literal(1)]).optional().describe("1 = solo l'ultima versione attiva"),
  Chiavi: z.array(chiave).optional().describe("Filtri sulle chiavi di archiviazione della tipologia"),
};

type Ricerca = z.infer<z.ZodObject<typeof ricercaShape>>;

const GIORNO_MS = 24 * 60 * 60 * 1000;

export function validaRicerca(r: Ricerca): string | undefined {
  if (r.AnnoRif === undefined && !r.CreazioneDataDa && !r.VariazioneDataDa) {
    return "Indica almeno uno tra AnnoRif, CreazioneDataDa o VariazioneDataDa.";
  }
  if (r.CodiceDitta === undefined && !r.PIva && !r.CodFiscale && !r.CodGruppo) {
    return "Indica almeno uno tra CodiceDitta, PIva, CodFiscale o CodGruppo.";
  }
  // PROFIS rifiuta intervalli oltre 365 giorni; se manca la data "A" usa oggi.
  for (const [da, a, nome] of [
    [r.CreazioneDataDa, r.CreazioneDataA, "creazione"],
    [r.VariazioneDataDa, r.VariazioneDataA, "variazione"],
  ] as const) {
    if (!da) continue;
    const giorni = (Date.parse(a ?? new Date().toISOString()) - Date.parse(da)) / GIORNO_MS;
    if (giorni > 365) return `L'intervallo sulla data di ${nome} non può superare 365 giorni.`;
  }
  return undefined;
}

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".xml": "application/xml",
  ".p7m": "application/pkcs7-mime",
  ".htm": "text/html",
  ".html": "text/html",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
};

interface DownloadOut {
  Esito?: { Esito?: number; Errori?: { Codice?: number; Messaggio?: string }[] };
  FileStream?: { BUFFER?: string };
  NomeFile?: string;
}

/** Salva un file scaricato e restituisce dove è finito (solo su Node, con PROFIS_DOWNLOAD_DIR). */
export type SaveFile = (nome: string, bytes: Uint8Array) => Promise<string>;

const estensione = (nome: string) => {
  const i = nome.lastIndexOf(".");
  return i > 0 ? nome.slice(i).toLowerCase() : "";
};

export function registerTools(
  server: McpServer,
  cfg: Config,
  client = new ProfisClient(cfg),
  saveFile?: SaveFile,
): void {
  const text = (t: string, isError = false): CallToolResult => ({ isError, content: [{ type: "text", text: t }] });

  const errore = (err: unknown): CallToolResult =>
    text(
      err instanceof ProfisError
        ? `${err.message}${err.body ? `\n${err.body}` : ""}`
        : `Errore inatteso: ${(err as Error).message}`,
      true,
    );

  const call = async (method: "GET" | "POST", p: string, body?: unknown): Promise<CallToolResult> => {
    try {
      const data = await client.request(method, p, body);
      let out = typeof data === "string" ? data : JSON.stringify(data, null, 2);
      if (out.length > cfg.maxResponseChars) {
        out =
          out.slice(0, cfg.maxResponseChars) +
          `\n\n[Risposta troncata a ${cfg.maxResponseChars} caratteri. Restringi la ricerca o usa Skip/Take.]`;
      }
      return text(out);
    } catch (err) {
      return errore(err);
    }
  };

  const download = async (p: string, body: Record<string, unknown>, guidDoc: string): Promise<CallToolResult> => {
    let data: DownloadOut;
    try {
      data = (await client.request("POST", p, body)) as DownloadOut;
    } catch (err) {
      return errore(err);
    }
    const buffer = data?.FileStream?.BUFFER;
    if (data?.Esito?.Esito !== 1 || !buffer) {
      const msg = data?.Esito?.Errori?.map((e) => `${e.Codice ?? ""} ${e.Messaggio ?? ""}`.trim()).join("; ");
      return text(`Download non riuscito${msg ? `: ${msg}` : ""}\n${JSON.stringify(data?.Esito ?? data)}`, true);
    }

    const nome = (data.NomeFile || "documento").split(/[\\/]/).pop()!.replace(/[^\w.\- ]/g, "_");
    const bytes = Buffer.from(buffer, "base64");
    const mimeType = MIME[estensione(nome)] ?? "application/octet-stream";

    if (saveFile) {
      const dest = await saveFile(`${guidDoc.replace(/[^\w-]/g, "_")}_${nome}`, bytes);
      return text(`File salvato: ${dest}\nNome: ${nome}\nTipo: ${mimeType}\nDimensione: ${bytes.length} byte`);
    }
    if (bytes.length > cfg.maxFileBytes) {
      return text(
        `Il file ${nome} pesa ${bytes.length} byte, oltre il limite di ${cfg.maxFileBytes}. ` +
          "Restringi la richiesta o, sul PC, imposta PROFIS_DOWNLOAD_DIR per salvarlo su disco.",
        true,
      );
    }
    return {
      content: [
        { type: "text", text: `File: ${nome} (${mimeType}, ${bytes.length} byte)` },
        {
          type: "resource",
          resource: { uri: `profis://documenti/${encodeURIComponent(guidDoc)}/${encodeURIComponent(nome)}`, mimeType, blob: buffer },
        },
      ],
    };
  };

  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
  const gd = (area: string, action: string) => client.appPath(`api/${area}`, action);

  // --- Gestione documentale: documenti ---

  server.registerTool(
    "profis_documenti_cerca",
    {
      title: "Cerca documenti",
      description:
        "Cerca documenti nella Gestione Documentale di PROFIS. Obbligatori: Tipologia; almeno uno tra AnnoRif, " +
        "CreazioneDataDa, VariazioneDataDa; almeno uno tra CodiceDitta, PIva, CodFiscale, CodGruppo. " +
        "Gli intervalli di date non possono superare 365 giorni. Massimo 100 risultati per chiamata (Take).",
      inputSchema: ricercaShape,
      annotations: readOnly,
    },
    async (args) => {
      const msg = validaRicerca(args);
      return msg ? text(msg, true) : call("POST", gd("GD_DOCUMENTI", "Ricerca"), args);
    },
  );

  server.registerTool(
    "profis_documento_leggi",
    {
      title: "Leggi documento",
      description: "Legge i dati di un documento (tipologia, descrizione, chiavi, presenza di allegati e note) dal GuidUnivoco.",
      inputSchema: { GuidUnivoco: guid },
      annotations: readOnly,
    },
    async (args) => call("POST", gd("GD_DOCUMENTI", "LeggiDaGuid"), args),
  );

  server.registerTool(
    "profis_documento_cronologia",
    {
      title: "Cronologia documento",
      description: "Restituisce la cronologia (versioni e operazioni) di un documento.",
      inputSchema: { GuidUnivoco: guid },
      annotations: readOnly,
    },
    async (args) => call("POST", gd("GD_DOCUMENTI", "Cronologia"), args),
  );

  server.registerTool(
    "profis_documento_scarica",
    {
      title: "Scarica file documento",
      description:
        "Scarica il file del documento. TipoFile: 0 originale, 1 firmato, 2 marcato temporalmente, " +
        "3 HTML (solo fatture elettroniche), 4 modificabile, 5 PDF generato (solo fatture elettroniche).",
      inputSchema: {
        GuidUnivoco: guid,
        TipoFile: z.number().int().min(0).max(5).default(0).describe("Versione del file da scaricare"),
      },
      annotations: readOnly,
    },
    async (args) => download(gd("GD_DOCUMENTI", "DownloadFile"), args, args.GuidUnivoco),
  );

  server.registerTool(
    "profis_ditte_documenti_variati",
    {
      title: "Ditte con documenti variati",
      description:
        "Elenca le ditte (codice, P.IVA, ragione sociale, tipologie) con almeno un documento variato nel periodo indicato.",
      inputSchema: {
        VariazioneDataDa: dataIso("Data variazione da"),
        VariazioneDataA: dataIso("Data variazione a").optional(),
        VariazioneOraDa: oraHHMMSS("Ora variazione da").optional(),
        VariazioneOraA: oraHHMMSS("Ora variazione a").optional(),
      },
      annotations: readOnly,
    },
    async (args) => call("POST", gd("GD_DOCUMENTI", "LeggiDitteDocVariati"), { Parametri: args }),
  );

  // --- Gestione documentale: allegati ---

  server.registerTool(
    "profis_allegati_cerca",
    {
      title: "Elenco allegati",
      description: "Elenca gli allegati di un documento (numero, descrizione, nome file, firma).",
      inputSchema: { GuidUnivoco: guid },
      annotations: readOnly,
    },
    async (args) => call("POST", gd("GD_ALLEGATI", "LeggiElenco"), args),
  );

  server.registerTool(
    "profis_allegato_leggi",
    {
      title: "Leggi allegato",
      description: "Legge i dati di un allegato (numero preso da profis_allegati_cerca).",
      inputSchema: { GuidUnivoco: guid, NumeroAllegato: z.number().int().describe("Numero dell'allegato") },
      annotations: readOnly,
    },
    async (args) => call("POST", gd("GD_ALLEGATI", "Leggi"), args),
  );

  server.registerTool(
    "profis_allegato_scarica",
    {
      title: "Scarica file allegato",
      description:
        "Scarica il file di un allegato, oppure la copia di cortesia del documento. " +
        "TipoFile: 0 originale, 1 firmato, 2 marcato temporalmente, 3 HTML (solo fatture elettroniche).",
      inputSchema: {
        GuidUnivoco: guid,
        NumeroAllegato: z.number().int().optional().describe("Numero dell'allegato"),
        ScaricaCopiaCortesia: z.union([z.literal(0), z.literal(1)]).optional().describe("1 = scarica la copia di cortesia"),
        TipoFile: z.number().int().min(0).max(3).default(0).describe("Versione del file da scaricare"),
      },
      annotations: readOnly,
    },
    async (args) => {
      if (args.NumeroAllegato === undefined && args.ScaricaCopiaCortesia !== 1) {
        return text("Indica NumeroAllegato oppure ScaricaCopiaCortesia = 1.", true);
      }
      return download(gd("GD_ALLEGATI", "Download"), args, args.GuidUnivoco);
    },
  );

  // --- Gestione documentale: annotazioni ---

  server.registerTool(
    "profis_annotazioni_cerca",
    {
      title: "Elenco annotazioni",
      description: "Elenca le annotazioni (note) di un documento.",
      inputSchema: { GuidUnivoco: guid },
      annotations: readOnly,
    },
    async (args) => call("POST", gd("GD_ANNOTAZIONI", "LeggiElenco"), args),
  );

  server.registerTool(
    "profis_annotazione_leggi",
    {
      title: "Leggi annotazione",
      description: "Legge una singola annotazione (numero preso da profis_annotazioni_cerca).",
      inputSchema: { GuidUnivoco: guid, NumeroNota: z.number().int().describe("Numero della nota") },
      annotations: readOnly,
    },
    async (args) => call("POST", gd("GD_ANNOTAZIONI", "Leggi"), args),
  );

  // --- Report PROFIS abilitati per il Web ---

  const nomeReport = z.string().min(1).describe("Nome del report PROFIS (deve avere il flag 'Abilita per il Web')");

  server.registerTool(
    "profis_report_info",
    {
      title: "Struttura report",
      description:
        "Restituisce colonne, filtri e campi digitati di un report PROFIS. Da chiamare prima di profis_report_esegui " +
        "per conoscere i nomi dei filtri.",
      inputSchema: { name: nomeReport },
      annotations: readOnly,
    },
    async ({ name }) => call("GET", client.appPath("report", `Info/${encodeURIComponent(name)}`)),
  );

  server.registerTool(
    "profis_report_esegui",
    {
      title: "Esegui report",
      description:
        "Esegue un report PROFIS e restituisce i dati. Operators dei filtri: 1 Uguale, 2 Non uguale, 3 Compreso fra " +
        "(Values [da, a]), 4 Maggiore, 5 Maggiore uguale, 6 Minore, 7 Minore uguale, 8 Inizia con, 9 Finisce con, " +
        "10 Contiene, 11 Presente in, 12 Non presente in.",
      inputSchema: {
        name: nomeReport,
        Skip: z.number().int().min(0).default(0).describe("Righe da saltare"),
        Take: z.number().int().min(0).default(100).describe("Righe da restituire (0 = tutte)"),
        Filters: z
          .array(
            z.object({
              Name: z.string().optional().describe("Nome del filtro"),
              Label: z.string().optional().describe("Etichetta del filtro, utile in caso di omonimie"),
              Operators: z.number().int().min(1).max(12),
              Values: z.array(z.string()),
            }),
          )
          .optional(),
        Digits: z
          .array(z.object({ Name: z.string(), Value: z.union([z.string(), z.number()]) }))
          .optional()
          .describe("Valori dei campi digitati del report"),
      },
      annotations: readOnly,
    },
    async ({ name, ...body }) => call("POST", client.appPath("report", `RunReport/${encodeURIComponent(name)}`), body),
  );

  // --- Tabelle di sistema ---

  server.registerTool(
    "profis_anni",
    {
      title: "Anni disponibili",
      description: "Elenco degli anni gestiti in PROFIS.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => call("GET", client.appPath("System", "GetAnni")),
  );

  // --- Diagnosi ---

  server.registerTool(
    "profis_diagnostica",
    {
      title: "Diagnostica connessione PROFIS",
      description:
        "Mostra la configurazione del server (senza password) e la risposta completa di PROFIS, con status e " +
        "intestazioni, per alcune chiamate di prova. Permette di provare un altro gruppo o di aggiungere X-BC-Anno. " +
        "Da usare quando gli altri strumenti danno errore.",
      inputSchema: {
        Gruppo: z
          .string()
          .optional()
          .describe("Gruppo da usare al posto di quello configurato; stringa vuota per provare senza gruppo"),
        Anno: z.number().int().optional().describe("Se indicato, aggiunge l'header X-BC-Anno"),
      },
      annotations: readOnly,
    },
    async ({ Gruppo, Anno }) => {
      const headers: Record<string, string | undefined> = {};
      if (Gruppo !== undefined) {
        headers["X-BC-Gruppo"] = Gruppo === "" ? undefined : Gruppo;
        if (Gruppo === "") headers["X-BC-GruppoPwd"] = undefined;
      }
      if (Anno !== undefined) headers["X-BC-Anno"] = String(Anno);

      const oggi = new Date();
      const settimanaFa = new Date(oggi.getTime() - 7 * GIORNO_MS);
      const giorno = (d: Date) => `${d.toISOString().slice(0, 10)}T00:00:00`;
      const prove: [string, "GET" | "POST", string, unknown][] = [
        ["Gruppi (di sistema)", "GET", client.appPath("System", "GetGruppi"), undefined],
        [
          "Ditte con documenti variati (ultimi 7 giorni)",
          "POST",
          gd("GD_DOCUMENTI", "LeggiDitteDocVariati"),
          { Parametri: { VariazioneDataDa: giorno(settimanaFa), VariazioneDataA: giorno(oggi) } },
        ],
        [
          "Lettura documento inesistente",
          "POST",
          gd("GD_DOCUMENTI", "LeggiDaGuid"),
          { GuidUnivoco: "00000000-0000-0000-0000-000000000000" },
        ],
      ];

      const righe = [
        "Configurazione:",
        `- URL: ${cfg.baseUrl}`,
        `- AppId: ${cfg.appId === "Sistemi" ? "Sistemi" : `chiave SIR (${cfg.appId.length} caratteri)`}`,
        `- Utente: ${cfg.user ?? "(token statico)"}`,
        `- Gruppo configurato: ${cfg.gruppo ?? "nessuno"}${cfg.gruppoPwdSha256 ? " (con password)" : ""}`,
        `- Header di prova: ${JSON.stringify(headers)}`,
        "",
      ];
      for (const [nome, method, p, body] of prove) {
        try {
          const r = await client.raw(method, p, body, headers);
          righe.push(
            `## ${nome}`,
            `${method} ${p}`,
            `Status: ${r.status} ${r.statusText}`,
            `Intestazioni: ${JSON.stringify(r.headers)}`,
            `Corpo: ${r.body || "(vuoto)"}`,
            "",
          );
        } catch (err) {
          righe.push(`## ${nome}`, `Errore: ${(err as Error).message}`, "");
        }
      }
      return text(righe.join("\n"));
    },
  );

  server.registerTool(
    "profis_gruppi",
    {
      title: "Gruppi",
      description: "Elenco dei gruppi configurati in PROFIS.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => call("GET", client.appPath("System", "GetGruppi")),
  );
}
