/**
 * Copia questo file come Config.gs nel progetto Apps Script e inserisci i dati reali.
 * NON pubblicare Config.gs su GitHub: contiene gli indirizzi dei clienti.
 */
var CONFIG = {
  // Etichetta Gmail da cui leggere le mail.
  etichetta: 'Contabilità mensile',

  // Ignora le mail ricevute prima di questa data (AAAA-MM-GG).
  dataInizio: '2026-10-10',

  // Mittenti di questi domini non vengono elaborati (oltre al proprio indirizzo).
  dominiEsclusi: ['studiobrocchi.it'],

  // Cartella principale per i mittenti non riconosciuti ("AAAA-MM Da smistare").
  cartellaDaSmistare: 'ID_CARTELLA_PRINCIPALE',

  // Indirizzo esatto del mittente (minuscolo) → ID cartella Drive della società.
  mittenti: {
    'cliente@example.com': 'ID_CARTELLA_SOCIETA'
  },

  // Mittenti (minuscolo) i cui allegati sono sempre contabilità: le loro mail vengono
  // elaborate anche senza l'etichetta e ogni allegato viene salvato, senza filtri.
  // Devono comparire anche in "mittenti" o "domini" per sapere in quale cartella salvare.
  mittentiSempreContabilita: ['cliente@example.com'],

  // Dominio del mittente → ID cartella (usato se l'indirizzo esatto non è in "mittenti").
  domini: {
    'example.it': 'ID_CARTELLA_SOCIETA'
  }
};
