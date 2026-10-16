# Etichette automatiche Gmail (Google Apps Script)

Sostituisce lo scenario Make **"Etichette automatiche Gmail"** (ID 7881364) con
uno script che gira direttamente nell'account Google: nessuna operazione Make
consumata, stessa logica.

## Regole

Uguali allo scenario Make, tranne che le mail con `F24` nell'oggetto non
ricevono più l'etichetta Fisco & PEC.

| Etichetta | Condizione |
|---|---|
| Contabilità mensile | oggetto contiene `contabilit`, `estratto conto`, `fatture attive/passive`, `presenze` |
| Fisco & PEC | oggetto contiene `agenzia delle entrate`, `cartella`, `ritenuta`, `dichiarazion…`, `PEC`, **ma non** `F24` |
| Interno studio | mittente `@studiobrocchi.it` |
| Clienti | mittente in elenco clienti (domini e indirizzi in `Codice.gs`) |
| Altro | nessuna delle regole precedenti |

Come nel router Make, una mail può ricevere più etichette. Ricerca:
`in:inbox -from:me newer_than:3d`, ogni 10 minuti. Le mail che hanno già una
di queste 5 etichette vengono saltate, quindi ogni mail è elaborata una volta.

## Installazione

1. Aprire <https://script.google.com> con l'account Gmail dello studio → **Nuovo progetto**,
   chiamarlo "Etichette automatiche Gmail".
2. Impostazioni progetto (⚙️) → spuntare **Mostra il file manifest "appsscript.json"**.
3. Copiare il contenuto di `appsscript.json` e `Codice.gs` nei file omonimi
   (il file `Codice.gs` sostituisce `Codice.gs`/`Code.gs` di default).
4. Selezionare la funzione `applicaEtichette` → **Esegui** e autorizzare l'accesso.
   Controllare il log e le etichette in Gmail.
5. Selezionare `installaTrigger` → **Esegui**: crea il trigger ogni 10 minuti.
6. Solo dopo aver verificato che funziona, **disattivare lo scenario su Make**
   (altrimenti le due automazioni girano in parallelo; non fanno danni, ma
   Make continua a consumare operazioni).

Per aggiungere un cliente basta inserire l'indirizzo nell'elenco della regola
`Clienti` in `Codice.gs`.
