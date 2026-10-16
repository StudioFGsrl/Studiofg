/**
 * Etichette automatiche Gmail
 *
 * Sostituisce lo scenario Make "Etichette automatiche Gmail" (ID 7881364).
 * Applica le etichette Contabilità mensile, Fisco & PEC, Interno studio,
 * Clienti e Altro ai messaggi in arrivo. Come nel router di Make, un messaggio
 * riceve TUTTE le etichette delle regole che corrispondono; "Altro" solo se
 * nessuna regola corrisponde.
 *
 * Installazione: eseguire una volta installaTrigger() (vedi README.md).
 */

// Stessa ricerca del modulo "Watch emails" di Make.
const QUERY = 'in:inbox -from:me newer_than:3d';
const MAX_MESSAGGI = 100;

// Regole: nome etichetta Gmail, campo da controllare e regex (case-insensitive),
// copiate dai filtri dello scenario Make. "escludi" (facoltativo): se il campo
// corrisponde, la regola non si applica.
const REGOLE = [
  {
    etichetta: 'Contabilità mensile',
    campo: 'oggetto',
    regex: /contabilit|estratto conto|fatture (attive|passive)|presenze/i,
  },
  {
    etichetta: 'Fisco & PEC',
    campo: 'oggetto',
    regex: /agenzia delle entrate|cartella|ritenuta|dichiarazion|\bpec\b/i,
    // Le mail sugli F24 non vanno in Fisco & PEC.
    escludi: /\bf24\b/i,
  },
  {
    etichetta: 'Interno studio',
    campo: 'mittente',
    regex: /@studiobrocchi\.it$/i,
  },
  {
    etichetta: 'Clienti',
    campo: 'mittente',
    regex: new RegExp(
      '@(fdcservices\\.it|coissrl\\.com|housetohome\\.it)$|^(' + [
        'smog76@gmail\\.com',
        'mail@studiodinicola\\.com',
        'andreafalasca77@libero\\.it',
        'antonio\\.rinaldi@nanofaber\\.com',
        'c\\.santia@libero\\.it',
        'info@studiolegaletofani\\.com',
        'f\\.vitalidebonda@nmlex\\.it',
        'f\\.maggio@nmlex\\.it',
        'la\\.faia@gmail\\.com',
        'dlcdiam@libero\\.it',
        'pio\\.bastoni@gmail\\.com',
        'fapaedili@alice\\.it',
        'mail\\.glassociates@gmail\\.com',
        'varisimona@gmail\\.com',
        'stefanopiccioli2014@gmail\\.com',
        'st@cmrecycling\\.it',
      ].join('|') + ')$',
      'i'
    ),
  },
];
const ETICHETTA_ALTRO = 'Altro';

/** Funzione eseguita dal trigger ogni 10 minuti. */
function applicaEtichette() {
  const idEtichette = caricaIdEtichette_();
  const idGestite = Object.values(idEtichette);

  const elenco = Gmail.Users.Messages.list('me', { q: QUERY, maxResults: MAX_MESSAGGI });
  const messaggi = elenco.messages || [];
  let etichettati = 0;

  messaggi.forEach(function (m) {
    const msg = Gmail.Users.Messages.get('me', m.id, {
      format: 'metadata',
      metadataHeaders: ['From', 'Subject'],
    });

    // Già elaborato (o etichettato a mano): non toccarlo, come faceva Make
    // che elaborava ogni mail una sola volta.
    const labelAttuali = msg.labelIds || [];
    if (labelAttuali.some(function (id) { return idGestite.indexOf(id) !== -1; })) return;

    const valori = {
      oggetto: intestazione_(msg, 'Subject'),
      mittente: estraiIndirizzo_(intestazione_(msg, 'From')),
    };

    const daAggiungere = REGOLE
      .filter(function (r) {
        const v = valori[r.campo];
        return r.regex.test(v) && !(r.escludi && r.escludi.test(v));
      })
      .map(function (r) { return idEtichette[r.etichetta]; });
    if (daAggiungere.length === 0) daAggiungere.push(idEtichette[ETICHETTA_ALTRO]);

    Gmail.Users.Messages.modify({ addLabelIds: daAggiungere }, 'me', m.id);
    etichettati++;
  });

  console.log('Messaggi esaminati: %s, etichettati: %s', messaggi.length, etichettati);
}

/** Crea (una sola volta) il trigger ogni 10 minuti, come lo scenario Make. */
function installaTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'applicaEtichette'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('applicaEtichette').timeBased().everyMinutes(10).create();
}

/** Mappa nome etichetta -> ID; crea le etichette mancanti. */
function caricaIdEtichette_() {
  const nomi = REGOLE.map(function (r) { return r.etichetta; }).concat(ETICHETTA_ALTRO);
  const esistenti = Gmail.Users.Labels.list('me').labels || [];
  const mappa = {};
  nomi.forEach(function (nome) {
    const trovata = esistenti.filter(function (l) { return l.name === nome; })[0];
    mappa[nome] = trovata
      ? trovata.id
      : Gmail.Users.Labels.create({ name: nome }, 'me').id;
  });
  return mappa;
}

function intestazione_(msg, nome) {
  const h = (msg.payload.headers || []).filter(function (x) {
    return x.name.toLowerCase() === nome.toLowerCase();
  })[0];
  return h ? h.value : '';
}

/** "Mario Rossi <mario@esempio.it>" -> "mario@esempio.it" */
function estraiIndirizzo_(from) {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}
