/**
 * Contabilità mensile → Google Drive
 *
 * Sostituisce lo scenario Make "Contabilità mensile → Google Drive".
 * Salva gli allegati delle mail con etichetta "Contabilità mensile" in
 *   <cartella società>/AAAA/<Mese>          (es. 2026/Ottobre)
 * Mittenti non riconosciuti finiscono in
 *   <cartella principale>/AAAA-MM Da smistare
 *
 * La configurazione (mappa mittenti → cartelle, ID cartelle) è in Config.gs,
 * che NON va pubblicato su GitHub perché contiene dati dei clienti.
 */

var MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

var FUSO = 'Europe/Rome';
var PREFISSO_ELABORATA = 'm_';
var GIORNI_FINESTRA = 30;
var GIORNI_MEMORIA = 60;
var MAX_THREAD = 100;
var TEMPO_MAX_MS = 5 * 60 * 1000;

/** Funzione eseguita dal trigger orario. */
function elaboraContabilitaMensile() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.log('Esecuzione precedente ancora in corso, salto.');
    return;
  }
  try {
    esegui_(false);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Da eseguire UNA volta al passaggio da Make: segna come già elaborate
 * tutte le mail attuali senza caricare nulla, per evitare doppioni.
 */
function segnaGiaElaborate() {
  esegui_(true);
}

/** Crea il trigger orario (rimuove eventuali duplicati). */
function installaTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'elaboraContabilitaMensile') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('elaboraContabilitaMensile').timeBased().everyHours(1).create();
  console.log('Trigger orario installato.');
}

function esegui_(soloSegna) {
  var inizio = Date.now();
  var props = PropertiesService.getScriptProperties();
  var elaborate = props.getProperties();
  var etichetta = GmailApp.getUserLabelByName(CONFIG.etichetta);
  if (!etichetta) throw new Error('Etichetta Gmail non trovata: ' + CONFIG.etichetta);

  var mioIndirizzo = Session.getEffectiveUser().getEmail().toLowerCase();
  // Le mail più vecchie di GIORNI_FINESTRA vengono ignorate, così la memoria
  // (GIORNI_MEMORIA, più lunga) può essere ripulita senza rischio di doppioni.
  var dataMinima = new Date(Math.max(new Date(CONFIG.dataInizio + 'T00:00:00').getTime(),
    Date.now() - GIORNI_FINESTRA * 24 * 3600 * 1000));
  var errori = [];
  var salvati = 0;

  var threads = etichetta.getThreads(0, MAX_THREAD);
  for (var i = 0; i < threads.length; i++) {
    var messaggi = threads[i].getMessages();
    for (var j = 0; j < messaggi.length; j++) {
      if (Date.now() - inizio > TEMPO_MAX_MS) {
        console.log('Tempo quasi esaurito, riprendo alla prossima esecuzione.');
        return chiudi_(props, errori, salvati);
      }
      var msg = messaggi[j];
      var chiave = PREFISSO_ELABORATA + msg.getId();
      if (elaborate[chiave]) continue;

      var mittente = estraiIndirizzo_(msg.getFrom());
      if (msg.getDate() < dataMinima || daEscludere_(mittente, mioIndirizzo)) continue;

      var allegati = allegatiVeri_(msg);
      if (allegati.length === 0) continue;

      if (!soloSegna) {
        try {
          var cartella = cartellaDestinazione_(mittente, msg.getDate());
          allegati.forEach(function (a) { cartella.createFile(a.copyBlob().setName(a.getName())); });
          salvati += allegati.length;
          console.log('Salvati ' + allegati.length + ' allegati da ' + mittente + ' in "' + cartella.getName() + '"');
        } catch (e) {
          errori.push(mittente + ' – "' + msg.getSubject() + '": ' + e.message);
          continue; // non segnata: verrà ritentata alla prossima esecuzione
        }
      }
      props.setProperty(chiave, String(Date.now()));
    }
  }
  chiudi_(props, errori, salvati);
}

function chiudi_(props, errori, salvati) {
  pulisciMemoria_(props);
  console.log('Allegati salvati: ' + salvati);
  if (errori.length) {
    // Lanciare l'errore fa partire la mail di notifica di Apps Script.
    throw new Error('Errori su ' + errori.length + ' mail:\n' + errori.join('\n'));
  }
}

/** Indirizzi propri e del dominio dello studio (equivale a -from:me -from:studiobrocchi.it). */
function daEscludere_(mittente, mioIndirizzo) {
  if (mittente === mioIndirizzo) return true;
  var dominio = mittente.split('@').pop();
  return CONFIG.dominiEsclusi.indexOf(dominio) !== -1;
}

/** Solo allegati veri: esclude le immagini piccole (loghi nelle firme). */
function allegatiVeri_(msg) {
  return msg.getAttachments({ includeInlineImages: false, includeAttachments: true })
    .filter(function (a) {
      return !/^image\//i.test(a.getContentType()) || a.getSize() > 30000;
    });
}

function estraiIndirizzo_(from) {
  var m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

/** Prima l'indirizzo esatto, poi il dominio; null se non riconosciuto. */
function cartellaSocieta_(mittente) {
  if (CONFIG.mittenti[mittente]) return CONFIG.mittenti[mittente];
  var dominio = mittente.split('@').pop();
  return CONFIG.domini[dominio] || null;
}

function cartellaDestinazione_(mittente, data) {
  var idSocieta = cartellaSocieta_(mittente);
  if (!idSocieta) {
    var principale = DriveApp.getFolderById(CONFIG.cartellaDaSmistare);
    return trovaOCrea_(principale, Utilities.formatDate(data, FUSO, 'yyyy-MM') + ' Da smistare');
  }
  var anno = trovaOCrea_(DriveApp.getFolderById(idSocieta), Utilities.formatDate(data, FUSO, 'yyyy'));
  var mese = MESI[Number(Utilities.formatDate(data, FUSO, 'M')) - 1];
  return trovaOCrea_(anno, mese);
}

function trovaOCrea_(padre, nome) {
  var it = padre.getFoldersByName(nome);
  while (it.hasNext()) {
    var f = it.next();
    if (!f.isTrashed()) return f;
  }
  return padre.createFolder(nome);
}

/** Dimentica i messaggi elaborati da più di GIORNI_MEMORIA giorni. */
function pulisciMemoria_(props) {
  var limite = Date.now() - GIORNI_MEMORIA * 24 * 3600 * 1000;
  var tutte = props.getProperties();
  Object.keys(tutte).forEach(function (k) {
    if (k.indexOf(PREFISSO_ELABORATA) === 0 && Number(tutte[k]) < limite) props.deleteProperty(k);
  });
}
