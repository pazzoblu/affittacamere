# AffittaCamere

Sito per una **casa vacanze** (uno o più alloggi): **vetrina pubblica** (alloggi, foto, disponibilità, prenotazioni)
e **area di gestione** (calendario, prenotazioni, messaggi dei clienti, camere e foto, prezzi, testi, utenti con ruoli,
sincronizzazione con Booking/Airbnb). Dei clienti si conservano solo **email e codice prenotazione**.

- Frontend statico in `docs/` (HTML + JavaScript, nessuna compilazione) → GitHub Pages
- Dati, login e foto su **Supabase** (piano gratuito)
- Sync calendari via **iCal** con due Edge Functions Supabase
- Pagamenti online con **Stripe Checkout** (carte, Apple Pay, Google Pay, PayPal, Klarna...)

```
docs/                 sito pubblicato
  index.html          home: alloggio (presentazione se è uno solo, elenco se sono più), chi siamo, contatti
  camera.html         scheda alloggio: galleria, calendario, prezzo, pagamento o richiesta
  pagamento.html      esito del pagamento
  prenotazione.html   "La mia prenotazione": stato, messaggi e richiesta di cancellazione con codice + email
  privacy.html        informativa privacy (GDPR)
  termini.html        termini e condizioni (testo modificabile + cancellazione + clausola sul recesso)
  regolamento.html    regolamento della casa (testo modificabile)
  fonts/              caratteri serviti dal sito (nessuna richiesta a Google Fonts)
  admin/              area riservata (login Supabase)
  js/config.js        URL e chiave del progetto Supabase  ← da compilare
supabase/
  schema.sql          tabelle, policy di sicurezza, bucket foto
  cron.sql            sincronizzazione automatica ogni 20 minuti
  functions/          ical-import (portali → sito), ical-export (sito → portali),
                      payments (Stripe Checkout e link), stripe-webhook (conferma pagamenti),
                      users (gestione utenti dell'area riservata, solo amministratori)
tests/
  *.test.ts           test di iCal e Stripe (firma webhook, parametri)
  dev/                anteprima locale con dati finti
```

## Prova subito in locale (modalità demo)

Non serve Supabase: un finto database nel browser simula tutto.

```bash
node tests/dev/server.mjs
```

Apri http://localhost:8080. Area riservata: http://localhost:8080/admin/ con una qualsiasi password e una di queste email,
per provare i diversi ruoli: `admin@demo.test`, `camere@demo.test`, `prenotazioni@demo.test`, `prezzi@demo.test`.
La verifica in due passaggi è simulata: il codice giusto è sempre `123456`.
Per "La mia prenotazione" c'è la prenotazione demo `DEMO2345` con email `cliente@example.com`.
In demo i pagamenti sono simulati: "Paga e prenota" conferma subito senza passare da Stripe.
I dati demo restano nel browser; per ripartire da zero svuota il localStorage del sito.

## Messa in produzione

### 1. Progetto Supabase
1. Crea un progetto su https://supabase.com (regione **EU – Frankfurt** per i dati degli ospiti).
2. **SQL Editor** → incolla ed esegui `supabase/schema.sql`.
3. **Authentication → Users → Add user**: crea il tuo utente (email + password).
4. **Authentication → Sign In / Providers**: disattiva *Allow new users to sign up*.
5. Rendi amministratore il tuo utente:
   ```sql
   insert into staff(user_id, email, roles)
   select id, email, '{admin}' from auth.users where email = 'la-tua-email@esempio.it';
   ```
6. Pubblica la funzione per gestire gli altri utenti dall'area riservata (scheda **Utenti**):
   ```bash
   npx supabase login
   npx supabase link --project-ref IL-TUO-PROJECT-REF
   npx supabase functions deploy users
   ```
   In alternativa: Dashboard → **Edge Functions → Deploy a new function → Via editor**, nome `users`,
   incolla `supabase/functions/users/index.ts` e disattiva *Verify JWT* (la funzione controlla da sola che chi chiama sia admin).
7. **Authentication → URL Configuration → Redirect URLs**: aggiungi `https://TUO-SITO/admin/**` (es. `https://pazzoblu.github.io/affittacamere/**`),
   così i link di attivazione dei nuovi utenti e di "password dimenticata" riportano all'area riservata.

**Nuovi utenti**: nella scheda Utenti si crea l'utente con una password oppure, lasciandola vuota, si ottiene un
**link di attivazione** da inoltrare (WhatsApp, email): aprendolo l'utente sceglie la sua password. Il link lo genera
Supabase senza spedire email, quindi non serve un server SMTP. "Password dimenticata?" invece manda un'email:
senza SMTP Supabase consegna solo agli indirizzi del team del progetto (in alternativa l'admin crea un nuovo link dall'elenco utenti).

**Aggiornare un progetto esistente**: riesegui `supabase/schema.sql` nel SQL Editor. È rieseguibile e porta
le modifiche (dalla versione con la tabella `admins`: gli admin diventano utenti con ruolo Amministratore,
nome e telefono dei clienti vengono eliminati).

### 2. Collega il sito
In **Project Settings → API** copia *Project URL* e *anon public key* in `docs/js/config.js`.

### 3. Funzioni di sincronizzazione
```bash
npx supabase login
npx supabase link --project-ref IL-TUO-PROJECT-REF
npx supabase functions deploy ical-import
npx supabase functions deploy ical-export
npx supabase secrets set CRON_SECRET=una-stringa-lunga-a-caso
```
Poi apri `supabase/cron.sql`, sostituisci `YOUR-PROJECT` e `YOUR-SECRET` ed eseguilo nel SQL Editor.

### 4. Pubblicazione su GitHub Pages
Crea un repository, fai push, poi **Settings → Pages → Deploy from a branch → `main` / `docs`**.
In Supabase, **Authentication → URL Configuration → Site URL**: metti l'indirizzo del sito.

### 5. Pagamenti online con Stripe
Stripe gestisce la pagina di pagamento: i dati delle carte non passano mai dal sito.
Commissioni indicative per carte europee: 1,5% + 0,25 € a transazione, nessun canone.

1. Crea un account su https://stripe.com e lascia attiva la **modalità di test** finché non hai provato tutto.
2. **Settings → Payment methods**: attiva i metodi che vuoi (carte, Apple Pay, Google Pay, PayPal, Klarna...).
   Il sito non elenca i metodi: Stripe mostra a ogni ospite quelli attivi e adatti al suo paese.
3. **Developers → API keys**: copia la *Secret key* (`sk_test_...`).
4. **Developers → Webhooks → Add endpoint**:
   - URL: `https://IL-TUO-PROJECT-REF.supabase.co/functions/v1/stripe-webhook`
   - eventi: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`
   - copia il *Signing secret* (`whsec_...`).
5. Pubblica le funzioni e imposta i segreti:
   ```bash
   npx supabase functions deploy payments
   npx supabase functions deploy stripe-webhook
   npx supabase secrets set STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_... SITE_URL=https://tuonome.github.io/affittacamere
   ```
6. Nell'area riservata: **Camere** → prezzo base, prezzo weekend, soggiorno minimo e prezzi stagionali;
   **Sito e pagamenti** → attiva i pagamenti online, imposta la percentuale di acconto e le condizioni di cancellazione.
7. Prova con la carta di test `4242 4242 4242 4242` (scadenza futura qualsiasi, CVC qualsiasi).
   Quando funziona, ripeti i passi 3–5 con le chiavi *live* (`sk_live_...`) e un nuovo webhook in modalità live.

**Come funziona**
- *Dal sito*: l'ospite sceglie le date, vede il totale calcolato dai listini e sceglie fra acconto e pagamento completo.
  Le date restano bloccate per 35 minuti mentre paga; a pagamento riuscito la prenotazione diventa **confermata**
  da sola. Se torna indietro o non paga, le date si liberano.
- *Link di pagamento*: nella scheda di una prenotazione (anche telefonica o WhatsApp) scegli l'importo e crei
  un link valido 23 ore, da mandare via WhatsApp o email. A pagamento avvenuto l'incassato si aggiorna da solo.
- *Saldo in contanti all'arrivo*: aggiorna a mano il campo *Già incassato*.
- *Rimborsi*: si fanno dalla Dashboard Stripe (Payments → il pagamento → Refund); poi aggiorna la prenotazione.
- Stripe invia all'ospite la ricevuta del pagamento se attivi **Settings → Customer emails → Successful payments**.

### 6. Booking e Airbnb
Nell'area riservata, scheda **Booking / Airbnb**:
- **Importa**: incolla il link iCal di esportazione del portale
  (Booking: *Tariffe e disponibilità → Sincronizza calendari*; Airbnb: *Calendario → Disponibilità → Collega calendari*).
- **Esporta**: copia il link mostrato nella riga di quel portale e incollalo sul portale come calendario da importare.
  Quel link esclude le prenotazioni arrivate dallo stesso portale, così non gli tornano indietro.

I portali leggono i calendari esterni con ritardi propri (da 30 minuti a qualche ora): una prenotazione
presa all'ultimo minuto può ancora sovrapporsi. Il calendario admin evidenzia in rosso le sovrapposizioni.

## Come funziona

- **Ruoli** (un utente può averne più d'uno; li assegna l'amministratore nella scheda Utenti):
  - *Amministratore*: tutto, compresa la gestione degli utenti;
  - *Camere*: anagrafica delle camere, foto e testi del sito;
  - *Prenotazioni*: calendario, prenotazioni, messaggi dei clienti, link di pagamento, Booking/Airbnb;
  - *Prezzi*: prezzi delle camere, stagioni, impostazioni dei pagamenti online.
  I permessi sono imposti dal database (policy RLS e trigger), non solo nascosti nell'interfaccia.
- **Clienti**: nessun account. Ricevono un codice prenotazione e, con codice + email, nella pagina
  *La mia prenotazione* vedono lo stato, scrivono alla struttura e possono chiedere la cancellazione.
- **Aspetti legali**: ogni alloggio ha CIN ed eventuale CIR (scheda Alloggi), mostrati nella sua pagina e in fondo al sito
  insieme al gestore. Prenotare richiede di spuntare l'accettazione di Termini e Regolamento; nella prenotazione si salvano
  data e versione accettata (la versione cambia ogni volta che si modificano termini, regolamento o cancellazione).
- **Notifiche**: richieste, pagamenti, cancellazioni e messaggi arrivano nella scheda *Messaggi* (admin e ruolo
  Prenotazioni). Le notifiche via email richiederanno un servizio di invio (es. Resend) da collegare in seguito.

- **Prenotazioni**: `check_out` è il giorno di partenza (escluso). Stati: *richiesta* (dal sito, da confermare),
  *confermata* (blocca la camera), *annullata*. Le richieste non bloccano il calendario finché non le confermi,
  tranne durante un pagamento online in corso (35 minuti).
- **Prezzi**: per ogni notte vale il prezzo stagionale se la notte cade in un periodo, altrimenti il prezzo base;
  le notti di venerdì e sabato usano il prezzo weekend. Sul totale si applica lo sconto per durata:
  quello "settimana" da 7 notti, quello "mese" da 28 notti (campi della scheda Alloggi, ruolo Prezzi). Il calcolo avviene nel database (`quote_price`),
  quindi l'importo pagato non è manipolabile dal browser.
- **Sicurezza**: la vetrina usa solo la chiave pubblica; le policy RLS permettono di leggere camere, foto e testi,
  di vedere i giorni occupati (senza dati personali), di inviare richieste e di consultare la propria prenotazione con codice + email. Tutto il resto è riservato allo staff, secondo il ruolo.
- **Foto**: ridimensionate nel browser a max 1920 px prima del caricamento, salvate nel bucket pubblico `photos`.
- **Import iCal**: aggiorna le prenotazioni attuali e future del portale, elimina quelle sparite dal feed
  (annullate sul portale); quelle passate restano come storico.

## Test

```bash
node --test "tests/*.test.ts"
```

Controllo della sintassi dei file JavaScript del sito (`node --check` da solo non basta per i moduli con `import`):

```bash
for f in docs/js/*.js docs/admin/*.js; do node --input-type=module --check < "$f" || echo "ERRORE in $f"; done
```

## Privacy e sicurezza
- **Conservazione dei dati**: `schema.sql` programma con pg_cron, ogni notte alle 3:30 UTC, la funzione
  `purge_personal_data()`. Cancella le richieste e le prenotazioni annullate senza incassi 12 mesi dopo la partenza
  e i messaggi dopo 12 mesi. Dopo 10 anni toglie email e note dalle prenotazioni e cancella i dettagli dei pagamenti.
  Sono le regole scritte nell'informativa: se cambi una, cambia anche l'altra.
  Per vedere le ultime esecuzioni: `select * from cron.job_run_details order by start_time desc limit 5;`
- **Nessun servizio esterno nel browser**: caratteri e libreria Supabase sono dentro il sito
  (`docs/js/vendor/supabase-js-2.45.4.js`, versione 2.45.4 impacchettata con esbuild). Per aggiornarla, in una cartella
  di lavoro: `npm i @supabase/supabase-js@<versione> esbuild`, poi
  `npx esbuild entry.mjs --bundle --format=esm --platform=browser --target=es2020 --minify --outfile=...`,
  con `entry.mjs` che contiene `export * from '@supabase/supabase-js';`. Infine aggiorna l'import in `docs/js/common.js`.
- **Content-Security-Policy**: ogni pagina HTML ha un `<meta http-equiv="Content-Security-Policy">`. Script solo dal
  sito stesso, collegamenti e immagini solo dal sito e da `*.supabase.co`. Niente `<script>` scritti dentro le pagine:
  se ne serve uno, va messo in un file `.js`. Se un domani servirà un servizio esterno (es. una mappa), va aggiunto lì.
- **Verifica in due passaggi (obbligatoria)**: dopo email e password l'area riservata chiede il codice di 6 cifre
  di un'app di autenticazione (Google Authenticator, Microsoft Authenticator...). Al primo accesso ognuno inquadra
  il QR code. Il blocco è anche nel database: `has_role()`, `is_staff()` e `is_admin()` sono vere solo se il token
  è di livello `aal2` (`mfa_ok()`); con la sola password si legge soltanto il proprio profilo staff. Anche le Edge
  Functions (`users` e quelle che usano `_shared/admin.ts`) rifiutano i token senza secondo passaggio.
  Chi perde il telefono: un altro amministratore usa "Azzera verifica" nella scheda Utenti. Se tutti gli amministratori
  perdono il telefono: Supabase → Authentication → Users → utente → elimina il fattore MFA.
  In Supabase (Authentication → Multi-Factor) il TOTP dev'essere attivo: lo è di default.

## Da valutare in seguito
- Informativa privacy: `docs/privacy.html` usa i dati del titolare inseriti in "Sito e pagamenti"; è un modello da far verificare a un consulente. Se si aggiungono statistiche o pubblicità servirà anche un banner cookie.
- Notifica email per le nuove richieste e prenotazioni pagate (oggi arriva solo l'email di Stripe del pagamento).
- Dati ospiti per Alloggiati Web e tassa di soggiorno.
