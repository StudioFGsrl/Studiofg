// Strumenti MCP esposti a Claude. Tutti in sola lettura.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { ProfisClient, ProfisError } from "./profis-client.js";

const guid = z.string().min(1).describe("GuidUnivoco del documento PROFIS");

const chiave = z.object({
  IdChiave: z.number().int().describe("Id della chiave di ricerca"),
  Criterio: z.union([z.literal(1), z.literal(2), z.literal(6)]).describe("1 = Uguale, 2 = Da/a, 6 = Diverso"),
  ValoreStringaDa: z.string().optional(),
  ValoreStringaA: z.string().optional(),
  ValoreNumeroDa: z.number().int().optional(),
  ValoreNumeroA: z.number().int().optional(),
  ValoreImportoDa: z.number().optional(),
  ValoreImportoA: z.number().optional(),
  ValoreDataDa: z.string().optional().describe("Data ISO 8601"),
  ValoreDataA: z.string().optional().describe("Data ISO 8601"),
  ValoreAnnoDa: z.number().int().optional(),
  ValoreAnnoA: z.number().int().optional(),
});

const ricercaShape = {
  Tipologia: z.number().int().describe("Tipologia documento PROFIS"),
  Take: z.number().int().min(1).max(100).default(20).describe("Numero massimo di risultati (1-100)"),
  Skip: z.number().int().min(0).optional().describe("Risultati da saltare, per la paginazione"),
  AnnoRif: z.number().int().optional().describe("Anno di riferimento"),
  CodiceDitta: z.number().int().optional().describe("Codice ditta in PROFIS"),
  PIva: z.string().optional().describe("Partita IVA del cliente"),
  CodFiscale: z.string().optional().describe("Codice fiscale del cliente"),
  CodGruppo: z.string().optional().describe("Codice gruppo"),
  Descrizione: z.string().optional().describe("Testo da cercare nella descrizione"),
  CreazioneDataDa: z.string().optional().describe("Data creazione da (ISO 8601)"),
  CreazioneDataA: z.string().optional().describe("Data creazione a (ISO 8601)"),
  VariazioneDataDa: z.string().optional().describe("Data variazione da (ISO 8601)"),
  VariazioneDataA: z.string().optional().describe("Data variazione a (ISO 8601)"),
  SoloUltimaVersione: z.union([z.literal(0), z.literal(1)]).optional().describe("1 = solo l'ultima versione"),
  Chiavi: z.array(chiave).optional().describe("Filtri sulle chiavi di archiviazione"),
};

type Ricerca = z.infer<z.ZodObject<typeof ricercaShape>>;

export function validaRicerca(r: Ricerca): string | undefined {
  if (r.AnnoRif === undefined && !r.CreazioneDataDa && !r.VariazioneDataDa) {
    return "Indica almeno uno tra AnnoRif, CreazioneDataDa o VariazioneDataDa.";
  }
  if (r.CodiceDitta === undefined && !r.PIva && !r.CodFiscale && !r.CodGruppo) {
    return "Indica almeno uno tra CodiceDitta, PIva, CodFiscale o CodGruppo.";
  }
  return undefined;
}

export function registerTools(server: McpServer, cfg: Config, client = new ProfisClient(cfg)): void {
  const ep = cfg.endpoints;

  const call = async (path: string, body: unknown): Promise<CallToolResult> => {
    try {
      const data = await client.post(path, body);
      let text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
      if (text.length > cfg.maxResponseChars) {
        text =
          text.slice(0, cfg.maxResponseChars) +
          `\n\n[Risposta troncata a ${cfg.maxResponseChars} caratteri. Restringi la ricerca o usa Skip/Take.]`;
      }
      return { content: [{ type: "text", text }] };
    } catch (err) {
      const msg =
        err instanceof ProfisError
          ? `${err.message}${err.body ? `\n${err.body}` : ""}`
          : `Errore inatteso: ${(err as Error).message}`;
      return { isError: true, content: [{ type: "text", text: msg }] };
    }
  };

  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

  server.registerTool(
    "profis_documenti_cerca",
    {
      title: "Cerca documenti",
      description:
        "Cerca documenti nella Gestione Documentale di PROFIS. Serve almeno un riferimento temporale " +
        "(AnnoRif, CreazioneDataDa o VariazioneDataDa) e almeno un riferimento al cliente " +
        "(CodiceDitta, PIva, CodFiscale o CodGruppo).",
      inputSchema: ricercaShape,
      annotations: readOnly,
    },
    async (args) => {
      const errore = validaRicerca(args);
      if (errore) return { isError: true, content: [{ type: "text", text: errore }] };
      return call(ep.documentiCerca, args);
    },
  );

  server.registerTool(
    "profis_documento_leggi",
    {
      title: "Leggi documento",
      description: "Legge i dati di un documento PROFIS dal suo GuidUnivoco.",
      inputSchema: { GuidUnivoco: guid },
      annotations: readOnly,
    },
    async (args) => call(ep.documentoLeggi, args),
  );

  server.registerTool(
    "profis_documento_cronologia",
    {
      title: "Cronologia documento",
      description: "Restituisce la cronologia (versioni e modifiche) di un documento PROFIS.",
      inputSchema: { GuidUnivoco: guid },
      annotations: readOnly,
    },
    async (args) => call(ep.documentoCronologia, args),
  );

  server.registerTool(
    "profis_allegati_cerca",
    {
      title: "Elenco allegati",
      description: "Elenca gli allegati di un documento PROFIS.",
      inputSchema: { GuidUnivoco: guid },
      annotations: readOnly,
    },
    async (args) => call(ep.allegatiCerca, args),
  );

  server.registerTool(
    "profis_allegato_leggi",
    {
      title: "Leggi allegato",
      description: "Legge un singolo allegato di un documento PROFIS (numero preso da profis_allegati_cerca).",
      inputSchema: { GuidUnivoco: guid, NumeroAllegato: z.number().int().describe("Numero dell'allegato") },
      annotations: readOnly,
    },
    async (args) => call(ep.allegatoLeggi, args),
  );

  server.registerTool(
    "profis_annotazioni_cerca",
    {
      title: "Elenco annotazioni",
      description: "Elenca le annotazioni (note) di un documento PROFIS.",
      inputSchema: { GuidUnivoco: guid },
      annotations: readOnly,
    },
    async (args) => call(ep.annotazioniCerca, args),
  );

  server.registerTool(
    "profis_annotazione_leggi",
    {
      title: "Leggi annotazione",
      description: "Legge una singola annotazione di un documento PROFIS (numero preso da profis_annotazioni_cerca).",
      inputSchema: { GuidUnivoco: guid, NumeroNota: z.number().int().describe("Numero della nota") },
      annotations: readOnly,
    },
    async (args) => call(ep.annotazioneLeggi, args),
  );
}
