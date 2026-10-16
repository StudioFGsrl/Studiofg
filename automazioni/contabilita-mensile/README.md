# Contabilità mensile → Google Drive (Google Apps Script)

Sostituisce lo scenario Make **"Contabilità mensile → Google Drive"**. Gira gratis
dentro l'account Google dello studio, senza Make.

## Cosa fa (come lo scenario Make)

Ogni ora legge le mail con etichetta Gmail **Contabilità mensile** che hanno allegati,
escludendo quelle inviate da te o da `@studiobrocchi.it`, e ricevute dal 10/10/2026.

- **Mittente riconosciuto**, prima per indirizzo esatto, poi per dominio: salva gli
  allegati in `<cartella società>/AAAA/<Mese>` (es. `2026/Ottobre`) e crea le cartelle
  se mancano.
- **Mittente non riconosciuto**: salva in `<cartella principale>/AAAA-MM Da smistare`.
- Scarta le immagini sotto i 30 KB, cioè i loghi nelle firme.
- I mittenti in `mittentiSempreContabilita` vengono elaborati anche se la mail non ha
  l'etichetta, e ogni loro allegato viene salvato senza filtri.

Rispetto a Make, ogni mail viene ricordata (per 60 giorni) e non viene mai salvata due
volte. Se un salvataggio fallisce, la mail viene ritentata all'esecuzione successiva e
Google ti manda una mail di errore.

## Installazione

1. Vai su <https://script.google.com>, accedi con l'account Gmail/Drive dello studio
   (lo stesso usato in Make) e crea un **Nuovo progetto** chiamato "Contabilità mensile".
2. Incolla il contenuto di `Code.gs` nel file `Code.gs`.
3. Crea un file `Config.gs` (**+** → Script) e incolla la configurazione reale.
   Parti da `Config.example.gs`. **Non pubblicare `Config.gs` su GitHub**, perché il
   repository è pubblico e il file contiene le email dei clienti.
4. In Impostazioni progetto, imposta il fuso orario su **Europe/Rome** (oppure attiva
   "Mostra il file manifest appsscript.json" e incolla `appsscript.json`).
5. **Passaggio da Make, senza doppioni:**
   1. Disattiva lo scenario su Make.
   2. Esegui una volta `segnaGiaElaborate` e autorizza gli accessi a Gmail e Drive.
      Così segna come già fatte le mail che Make ha già salvato.
   3. Esegui una volta `installaTrigger`, che attiva l'esecuzione ogni ora.
6. Se vuoi, esegui subito `elaboraContabilitaMensile` per provarlo. Il log si trova in
   **Esecuzioni**.

## Aggiungere un cliente

In `Config.gs` aggiungi una riga in `mittenti` (indirizzo esatto, minuscolo) oppure in
`domini`, con l'ID della cartella Drive della società. L'ID è la parte finale dell'URL
della cartella.
