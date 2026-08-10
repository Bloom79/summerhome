# "Cerca qui" senza GitHub: il micro-backend (Cloudflare Worker)

Il portale è un sito statico: non può creare da solo la richiesta per l'agente,
perché non può custodire credenziali. Questo worker è il pezzettino di backend
che risolve il problema: riceve la richiesta dal bottone **🤖 Trova nuove case
qui** e crea lui la issue `Cerca qui:` usando un token GitHub custodito come
secret. Per chi usa il portale l'esperienza diventa: un tap → «Richiesta
inviata ✅» — niente login, niente pagina GitHub.

Il codice è in [`../worker/worker.js`](../worker/worker.js). Il worker valida
i dati (coordinate UK/Irlanda, zoom minimo), scarta i doppioni (richiesta già
aperta entro ~3 km) e poi crea la issue con label `cerca-qui`. L'agente
giornaliero la gestisce come sempre.

## Setup (una volta sola, ~10 minuti)

### 1. Token GitHub (fine-grained)

1. GitHub → **Settings → Developer settings → Fine-grained personal access
   tokens → Generate new token**.
2. Nome: `casatrova-cerca-qui` · scadenza a piacere (rinnovabile).
3. **Repository access**: *Only select repositories* → `Bloom79/summerhome`.
4. **Permissions → Repository permissions → Issues: Read and write** (Metadata
   viene aggiunta da sola). Nient'altro.
5. Genera e copia il token (inizia con `github_pat_…`).

### 2. Deploy del worker su Cloudflare

Con la CLI (consigliato — serve solo Node):

```bash
cd worker
npx wrangler login          # apre il browser, accedi/crea l'account gratuito
npx wrangler secret put GITHUB_TOKEN   # incolla il token del passo 1
npx wrangler deploy
```

L'ultimo comando stampa l'URL, tipo
`https://casatrova-cerca-qui.<tuo-account>.workers.dev`.

In alternativa dal dashboard: **Workers & Pages → Create Worker**, incolla il
contenuto di `worker/worker.js`, poi in **Settings → Variables and Secrets**
aggiungi il secret `GITHUB_TOKEN`.

### 3. Collega il portale

Metti l'URL del worker in [`../src/config.js`](../src/config.js):

```js
export const CERCA_QUI_ENDPOINT = 'https://casatrova-cerca-qui.<tuo-account>.workers.dev'
```

e committa su `main` (oppure passa l'URL a Claude e lo fa lui). Da quel
momento il bottone invia direttamente; se il worker non risponde, il pannello
mostra il vecchio percorso GitHub come ripiego.

## Note

- Il token vive **solo** come secret nel worker: mai nel repository o nel sito.
- Il worker accetta richieste solo dalle origini del portale (CORS) e rifiuta
  aree fuori UK/Irlanda o troppo larghe: può creare issue, nient'altro.
- Piano gratuito Cloudflare: 100.000 richieste/giorno — più che sufficiente.
