# ColorGap

App Android (Kotlin, Jetpack Compose, CameraX) per persone daltoniche: mostra in
tempo reale **quali zone dell'inquadratura l'utente percepisce diversamente** da
una persona con visione normale. Tutto on-device, nessun accesso alla rete.

## Struttura

| Modulo      | Cosa contiene | Dipendenze |
|-------------|---------------|------------|
| `colorcore` | Tutta la matematica del colore, Kotlin puro (JVM): sRGB ↔ lineare ↔ CIELAB, ΔE2000, simulazione Machado 2009, analizzatore "perdita di colore" + "contrasto perso", renderer CPU degli overlay | nessuna (solo `kotlin-test` per i test) |
| `cli`       | Strumento desktop per provare l'algoritmo su foto reali (e `dump` per `tools/gpu-check`) | `colorcore`, JDK (`javax.imageio`) |
| `app`       | App Android: Compose, minSdk 26, targetSdk 35 | `colorcore`, AndroidX core-ktx, activity-compose, Compose BOM (ui, foundation, material3), ExifInterface, CameraX (core, camera2, lifecycle), DataStore Preferences |

## Piano e milestone

| # | Milestone | Stato |
|---|-----------|-------|
| 1 | `colorcore` + unit test (+ CLI per provarlo) | ✅ fatto |
| 2 | Analisi su foto statica: modulo `app`, apertura foto dalla galleria, overlay heatmap/righe/split, tap → nome colore (IT/EN) + HEX, zoom, esporta | ✅ fatto |
| 3 | Camera live CPU: CameraX `ImageAnalysis` a risoluzione ridotta, stessi overlay, freeze frame | ✅ fatto |
| 4 | Shader GPU: OpenGL ES 3.0, ≥ 24 fps, fallback CPU | ✅ fatto |
| 5 | UI e impostazioni: profilo (tipo, gravità 0–100 %) in DataStore, soglia, toggle modalità, UI IT/EN a una mano, pulsanti grandi | ✅ fatto |

Tutte le dipendenze sono state confermate milestone per milestone. Nessuna libreria di rete; il manifest rimuove esplicitamente
`INTERNET` e `ACCESS_NETWORK_STATE`, e backup/trasferimento dati sono disattivati.

## App (milestone 2)

- **Apri una foto**: selettore di sistema (Photo Picker, nessun permesso), oppure
  "Condividi → ColorGap" da qualunque galleria.
- **Pipeline**: la foto è decodificata con lato lungo ≤ 1600 px (rotazione EXIF
  applicata); la mappa si calcola a 640 px (la parte costosa), poi lo score è
  ingrandito in bilineare a 1600 px e la simulazione è fatta a piena risoluzione.
  Tutto in background (`Dispatchers.Default`); il cursore della soglia ridisegna
  l'overlay scartando i render superati.
- **Modalità**: Heatmap · Righe · Confronto (normale | come vedi tu, divisore
  regolabile con lo slider).
- **Tap su un punto**: colore reale e colore come lo vedi tu, entrambi con nome
  (IT/EN secondo la lingua del telefono, dizionario di 139 colori, match per
  ΔE2000) e HEX, media su un'area 5×5 px; dice anche in parole se in quel punto
  percepisci il colore diversamente.
- **Zoom**: pizzico, trascinamento, doppio tocco (3× / reset); il tap funziona
  anche con zoom.
- **Esporta**: PNG a 1600 px con l'overlay attivo, dove scegli tu (nessun
  permesso di memoria).
- **Profilo**: Deutan/Protan/Tritan + gravità a passi del 5 %, dal pulsante in
  alto a destra (per ora in memoria; DataStore arriva nella milestone 5).
- UI italiano/inglese, controlli in basso e alti ≥ 60 dp.
- **Lingua**: segue il telefono, oppure si sceglie dentro l'app (⚙ in alto a
  destra → Lingua: Sistema · English · Italiano). Su Android 13+ la scelta è
  anche in Impostazioni → App → ColorGap → Lingua. Su Android < 13 è salvata
  nell'app. Il bundle non divide le lingue, così il cambio funziona anche da Play.

## Dettaglio del colore e tavola del numero

Tocca un punto e poi **Dettagli** nella scheda del colore:

- **I due colori in grande**, reale e come lo vedi tu. Toccandoli si aprono a
  tutto schermo, uno sopra l'altro.
- **Quanto sono diversi per una visione tipica**: ΔE2000 e una parola
  (praticamente identici < 2, leggermente diversi < 5, diversi < 10,
  chiaramente diversi < 25, completamente diversi).
- **Cosa cambia per te**: luminosità, saturazione (croma) e tinta, da reale a
  percepita. Per esempio verde felce `#417056` → grigio `#686458` in deutan
  100 %: luminosità invariata, saturazione 24 → 7, tinta spostata di 61°.
- **Test del numero** (stile Ishihara, `Confusion` e `Plate` in `colorcore`):
  - l'app trova il "gemello" del colore toccato: un colore che una visione
    tipica vede chiaramente diverso ma che per il tuo profilo resta quasi
    uguale. Per trovarlo sposta il colore, restando dentro la gamma sRGB, lungo
    la direzione che la matrice di Machado schiaccia di più (autovettore di MᵀM
    con l'autovalore minimo: per i dicromati è la linea di confusione);
  - disegna una tavola a puntini: il numero con il colore toccato, lo sfondo con
    il gemello, e ogni puntino con una luminosità casuale uguale per entrambi,
    così solo il colore può rivelare il numero;
  - la tavola si vede in due versioni, "Tavola reale" e "Come la vedi tu"
    (simulata), con i pulsanti "Mostra il numero" e "Nuova tavola";
  - vincoli sul gemello: differenza per te ≤ 4 (sotto il rumore di luminosità
    della tavola), per la visione tipica ≥ 8 e ≥ 2,5 volte la tua. Se non esiste
    un gemello così, l'app lo dice: quel colore lo distingui bene. Succede per
    esempio in deutan 30 %;
  - è anche una **verifica della gravità**: se riesci a leggere una tavola
    costruita per il tuo profilo, il profilo è più forte della tua visione
    reale, e l'app suggerisce di abbassare la gravità;
  - da desktop: `./gradlew :cli:run --args="plate #417056 --severity 70 --digit 5"`.
- **Il verdetto della scheda dice il perché**: "qui il colore ti appare diverso"
  (prevale la perdita di colore), "qui per te sparisce il bordo tra due colori"
  (prevale il contrasto perso) oppure "qui vedi come tutti gli altri".

## Test di calibrazione (tipo e gravità automatici)

Si apre da Impostazioni, dalla schermata di benvenuto o dal dettaglio del colore.
Mostra circa 20 tavole a puntini; per ognuna si risponde con una di 4 cifre o
"Non vedo nessun numero". Alla fine propone il profilo e lo applica con un tocco.

Algoritmo (`CalibrationSession` in `colorcore`, puro e testato):

- **Principio**: una tavola costruita per il profilo *s* nasconde il numero a
  chi ha quel deficit con gravità *s* **o superiore**, e lo mostra a chi ha una
  visione più lieve o tipica. Il gemello deve restare entro ΔE 4 per il
  profilo bersaglio ed essere ≥ 10 per la visione tipica.
- **Tipo**: 2 tavole per tipo al 40 %. Vince il tipo che si sbaglia di più;
  se si leggono tutte, il risultato è "visione tipica o più lieve del 40 %".
  In caso di parità tra protan e deutan si usano tavole **discriminanti**
  (nascoste a un tipo, ben visibili all'altro), che però esistono solo vicino
  al 100 %: sotto, i due tipi non si separano con le tavole (stesso limite
  delle tavole Ishihara cliniche).
- **Gravità**: una bisezione tra 40 % e 100 %, con 2 tavole per livello (3 in
  caso di pareggio), serve a mettere le tavole dove danno più informazione.
  Poi il **fit di massima verosimiglianza** sceglie il profilo il cui occhio
  simulato risponde più come l'utente. Si leggono le tavole con una curva
  psicometrica attorno a ΔE 6 e si usa un prior per la frequenza: deutan circa
  3 volte protan, tritan raro. Se due tipi sono quasi alla pari, il tipo è
  "incerto" e la gravità è la media pesata.
- **Controlli**: 2 tavole leggibili da tutti (il numero differisce solo in
  luminosità). Mancarle entrambe rende il test "non affidabile".
- **Validazione con osservatori virtuali** (`CalibrationTest`): deutan e protan
  al 100/80/60/50 % su più sequenze di tavole. Su 112 test simulati l'errore
  medio è 3,8 %:
  - deutan: tipo giusto ed errore di gravità ≤ 10 %;
  - protan sotto il 90 %: a volte risultano "deutan?" con gravità sottostimata
    fino al 20 %, sempre segnalata come tipo incerto.

  Inoltre la visione tipica legge tutto; il 20 % risulta tipico; rispondere
  "nessun numero" a tutto viene segnalato come non affidabile; la stessa
  sessione dà sempre lo stesso risultato.

Limiti: è una stima, non una diagnosi. La soglia di lettura (ΔE 6) è
un'ipotesi del modello, e schermo e luce influiscono sul risultato.

## Interfaccia e impostazioni (milestone 5)

- **Primo avvio**: una schermata di benvenuto spiega in una frase cosa fa l'app.
  Poi chiede il tipo, con tre schede grandi e una descrizione semplice ("rossi,
  verdi, marroni e verdi oliva si confondono"), la gravità e la lingua, e ricorda
  che tutto resta sul telefono. Se non sai il tipo, consiglia Deutan 100%, il più
  frequente. Il pulsante "Inizia" sta in basso.
- **Salvato in DataStore** (`settings/`), solo sul dispositivo: backup
  disattivati. Si salvano:
  - profilo (tipo e gravità);
  - ultima modalità e soglia;
  - "evidenzia anche i colori che vedi diversamente";
  - motore GPU/CPU;
  - primo avvio completato.

  La scrittura parte 300 ms dopo l'ultima modifica, così uno slider in movimento
  scrive una volta sola. Un valore letto corrotto o fuori intervallo torna al
  default invece di bloccare l'app. L'interfaccia aspetta la lettura, così non
  lampeggiano valori predefiniti. La lingua la conserva Android (vedi sotto).
- **Impostazioni** a schermo intero: si aprono con ⚙ in basso a sinistra, sotto
  il pollice, o con il profilo in alto. Ogni modifica si applica subito. Contiene:
  - la tua visione (tipo e gravità);
  - visualizzazione: interruttore "Evidenzia anche i colori che vedi
    diversamente", che risponde alla domanda aperta sulla perdita di colore.
    Se è spento restano solo i bordi persi (peso del colore = 0, su CPU, GPU e
    foto). C'è anche "Ripristina la visualizzazione predefinita";
  - motore GPU/CPU;
  - lingua;
  - informazioni: come funziona, privacy, versione.
- **Una mano**: tutte le azioni principali sono in basso e alte almeno 60 dp:
  - camera: ⚙, Galleria, Congela;
  - foto: ←, Galleria, Esporta;
  - benvenuto: Inizia; impostazioni: Fatto.
- **Legenda della heatmap**: una barra da "Colore diverso" (blu) a "Bordo
  perso" (giallo); i colori seguono il tipo di daltonismo.
- **Accessibilità**:
  - etichette TalkBack su slider, pulsanti-icona e immagine;
  - le sezioni sono "heading";
  - interruttori con tutta la riga toccabile;
  - la scheda del colore è una live region, così TalkBack legge il nome quando
    cambia;
  - la selezione non è mai indicata solo dal colore (bordo spesso + radio).
- La **camera dal vivo** tiene lo schermo acceso.

## Camera live, percorso GPU (milestone 4)

È il motore predefinito. Tutta la mappa si calcola in shader OpenGL ES 3.0 a
640×480, contro 160–480 px del percorso CPU, e l'immagine si disegna a piena
risoluzione.

- **Ingresso**: gli stessi fotogrammi CameraX `ImageAnalysis` del percorso CPU,
  nel formato nativo YUV_420_888. Nessuna conversione dentro CameraX: quella in
  RGBA passa da una libreria nativa e su alcuni telefoni fallisce in silenzio.
  I tre piani vengono caricati così come sono (texture R8 larghe quanto il row
  stride, qualunque pixel stride) e convertiti in RGB dal passaggio `yuv`
  (BT.601 full range, JFIF). Rotazione e crop li applicano gli shader. Ho scelto
  questo ingresso invece di una Preview su texture esterna perché ha la stessa
  semantica di orientamento già verificata per la CPU; il limite di fps è quello
  della camera (di solito 30).
- **Passaggi** (`app/src/main/assets/shaders/`):
  0. `yuv`: dai piani YUV della camera a RGB;
  1. `lab`: media a blocchi, Lab di originale e simulato, perdita di colore;
  2. `blur`: sfocatura 3×3;
  3. `edges`: bordi Sobel misurati in ΔE2000;
  4. `contrast`: contrasto perso;
  5. `score`: allargamento dei bordi e mappa finale;
  6. `display`: heatmap, righe o confronto, a risoluzione di schermo.

  I passaggi 1–4 lavorano in half-float. La matematica del colore sta in
  `common.glsl`, il gemello GLSL di `colorcore`.
- **Letture verso la CPU**, senza bloccare la GPU: la mappa torna indietro ogni 4
  fotogrammi tramite pixel-pack buffer asincroni e serve per l'area critica e il
  verdetto del tap; il colore al tap viene da una lettura di 1 pixel.
- **Congela**: ricampiona il fotogramma raddrizzato a 960 px e lo apre nella
  schermata foto, come nel percorso CPU.
- **Fallback automatico su CPU**: senza OpenGL ES 3.0, senza render target
  half-float, se uno shader non compila o fallisce su quel driver, oppure se
  arrivano fotogrammi (20) ma la GPU non produce nulla.
- **Diagnosi a schermo**: se la camera resta buia, dopo 3 secondi l'app dice
  cosa succede (errore della fotocamera con codice, nessun fotogramma, fotogrammi
  non analizzati), con motore, numero di fotogrammi e un pulsante "Riprova". Toccando
  l'indicatore "GPU · fps · mappa" si passa da GPU a CPU e viceversa, per
  confrontarli.

### Verifica degli shader senza telefono (`tools/gpu-check`)

WebGL2 usa GLSL ES 3.00, lo stesso linguaggio di OpenGL ES 3.0. Lo strumento
carica gli shader dell'app così come sono, con la stessa intestazione, e li
esegue in Chromium headless sugli stessi pixel della pipeline CPU:

```bash
cd colorgap
./gradlew -q :cli:run --args="dump samples/confusion-chart.png --out out/dump/chart"
./gradlew -q :cli:run --args="dump ../3I4A8714.JPG --out out/dump/photo --type tritan --severity 70"
node tools/gpu-check/check.mjs out/dump/chart out/dump/photo
```

Controlla:

- ΔE2000 GLSL sulle 34 coppie di Sharma (errore massimo 1,5e-4);
- ΔE per pixel rispetto alla CPU (differenza massima 0,012);
- mappa rispetto alla CPU (differenza media 0,0007; pixel critici in disaccordo ≤ 0,05 %);
- rotazioni 90/180/270 con crop e riduzione 2×: identiche al caso diritto;
- heatmap e righe rispetto agli overlay CPU;
- freeze frame e colore al tap;
- conversione YUV → RGB della camera (righe con padding, crominanza interleaved).

Ho verificato che lo strumento se ne accorge quando un errore viene introdotto
apposta, nella rotazione o in una costante di ΔE2000. Richiede Node e Playwright
con Chromium: è solo uno strumento di sviluppo, non una dipendenza dell'app.

## Camera live, percorso CPU (milestone 3)

- È la schermata iniziale. Usa solo il caso d'uso CameraX `ImageAnalysis` in
  RGBA_8888, senza Preview: a schermo vanno i fotogrammi analizzati, così
  immagine e overlay coincidono sempre, anche quando la camera si muove.
- Per ogni fotogramma:
  1. il buffer RGBA viene raddrizzato e scalato a 960 px di lato lungo, in
     bitmap riusate a rotazione (nessuna allocazione da megabyte per frame);
  2. la mappa si calcola dopo una riduzione a media di blocchi (box filter,
     niente aliasing, quindi niente falsi bordi) di un fattore intero da 2 a 6;
  3. il fattore si adatta da solo: mediana del tempo su 12 frame, con obiettivo
     circa 50 ms (≈ 20 fps); più lento → mappa più grossolana, più veloce → più fine.
- L'overlay è un layer piccolo, scalato dal compositor con filtro bilineare. Le
  righe sono disegnate a risoluzione di schermo dentro la maschera (SrcIn), quindi
  restano nitide. Nel Confronto la simulazione è calcolata sul fotogramma intero.
- Tap: il punto resta "agganciato" e il nome del colore si aggiorna a ogni
  fotogramma mentre muovi il telefono.
- **Congela**: copia il fotogramma visibile e lo apre nella schermata foto, con
  analisi completa a 640 px, zoom, tap ed esportazione. Indietro (o
  "Fotocamera") torna al live.
- In basso l'indicatore mostra motore, fps e risoluzione della mappa, utile per
  confrontarlo con il percorso GPU della milestone 4.
- Permesso fotocamera chiesto al primo avvio; se viene negato: spiegazione,
  pulsante per richiederlo e scorciatoia alle impostazioni. Senza fotocamera
  l'app funziona comunque con la galleria.

### Prestazioni di `colorcore`

L'analizzatore ora divide il lavoro per righe su tutti i core (pool comune della
JVM, nessuna dipendenza) e riusa i buffer tra fotogrammi. Usa inoltre:

- `DeltaE.ciede2000Fast`: stessa formula scritta con vettori unitari di tinta
  invece di angoli, con una sola atan2 e solo vicino al blu. Coincide con la
  versione di riferimento entro 1e-5 su 100.000 coppie casuali e con i dati di Sharma;
- `CieLab.linearToLabFast`: f(t) da tabella interpolata (errore < 0,01).

Tempo per fotogramma misurato su desktop a 4 core:

| | prima | dopo |
|---|---|---|
| Solo analisi, mappa 256×171 | 60 ms | 11 ms |
| Pipeline completa camera, mappa 320×240 | — | 31 ms |
| Pipeline completa camera, mappa 240×180 | — | 19 ms |

## Algoritmo (`colorcore`)

Per ogni fotogramma (`PerceptionAnalyzer.analyze`):

1. **sRGB → RGB lineare** (curva IEC 61966-2-1, tabella a 256 valori).
2. **Simulazione** con le matrici di Machado, Oliveira & Fernandes 2009 su RGB
   lineare; gravità 0–1 interpolata linearmente tra i passi tabulati 0.0, 0.1, …, 1.0.
3. **Perdita di colore**: ΔE2000 (Sharma 2005) tra il pixel originale e quello
   simulato, in CIELAB D65.
   `colorLoss = clamp((ΔE − 3) / 11,99)`: la scala è scelta in modo che, alla
   soglia predefinita 0,35, la mappa marchi un colore esattamente da ΔE 10, cioè
   dove la scheda del colore dice "diverso" (costanti condivise in `AnalysisConfig`).
4. **Contrasto perso** (la metrica principale): forza del bordo con struttura
   Sobel (colonne/righe 1-2-1 attorno al pixel) **misurata in ΔE2000**,
   sull'originale e sul simulato, dopo un box blur 3×3 anti-rumore.
   Un bordo è "perso" se è calato in modo significativo **e** quello che resta
   è troppo debole per essere visto:
   `drop = clamp((E_orig − E_sim − 2) / 12)`,
   `hidden = 1 − smoothstep(3, 20, E_sim)`, `contrastLoss = drop × hidden`,
   poi un max-filter di raggio 2 px per trasformare i bordi in fasce visibili.
5. **Mappa finale**: `score = max(contrastLoss, 0.6 × colorLoss)` in 0–1; la
   soglia è regolabile (default 0.35).
6. **Marcatura graduata** (0.8.2): niente taglio netto alla soglia. L'intensità
   `strength = clamp((score − (soglia − 0,25)) / 0,5)` sale gradualmente attorno
   alla soglia: la tinta della heatmap diventa più coprente e le righe più
   spesse dove la differenza è maggiore. Così una zona uniforme (un prato con
   ΔE 8–12 ovunque) è marcata tutta in modo continuo, senza "linee" dove il
   valore attraversa per poco la soglia.

Due scelte rispetto alla specifica, emerse dai test:

- **ΔE2000 invece della differenza euclidea su a\*b\*** per i gradienti: nei gialli/oliva
  saturi la distanza Lab euclidea sopravvaluta le differenze di croma (due colori
  che un deuteranope distingue a malapena, ΔE2000 ≈ 5, risultavano ΔE76 ≈ 11,
  e il bordo sembrava "ancora visibile").
- **La luminosità fa parte del bordo**: un bordo rosso puro / verde puro perde
  la tinta ma resta ben visibile per la differenza di chiarezza (ΔE2000 ≈ 20
  nel simulato), quindi *non* viene segnalato come contrasto perso (la zona è
  però segnalata come "colore percepito diversamente").

Tutti i parametri sono in `AnalysisConfig`.

## Come provarlo

### App

Al primo avvio concedi la fotocamera; inquadra oggetti marroni e verdi, un
grafico a torta o una cartina. Tocca un punto per agganciare il nome del colore,
**Congela** per zoomare ed esportare.

Requisiti: JDK 17+ e Android SDK (platform 35); scrivi il percorso dell'SDK in
`colorgap/local.properties` (`sdk.dir=...`) o nella variabile `ANDROID_HOME`.

```bash
cd colorgap
./gradlew :app:assembleDebug          # → app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:testDebugUnitTest :app:lintDebug
```

Per una prova rapida: apri `samples/confusion-chart.png` (copialo sul telefono) e
tocca il "7" della tavola a puntini.

### Libreria e CLI

Requisiti: JDK 17+. Il wrapper Gradle scarica il resto.

```bash
cd colorgap
./gradlew :colorcore:test          # 65 unit test

# grafico di prova (coppie di confusione, tavola tipo Ishihara, linee)
./gradlew :cli:run --args="chart samples/confusion-chart.png"
./gradlew :cli:run --args="samples/confusion-chart.png --type deutan --severity 100 --threshold 0.35"
# qualunque foto (percorso relativo alla cartella colorgap)
./gradlew :cli:run --args="../3I4A8711.JPG --type protan --severity 60"
```

Le immagini finiscono in `colorgap/out/`: `-heatmap`, `-stripes` (righe diagonali),
`-split` (normale | come vedi tu), `-simulated`, `-score` (mappa in grigi).

### Cosa coprono i test

- `ColorNamesTest`: dizionario coerente (hex e nomi unici in entrambe le lingue),
  ogni voce trova sé stessa, colori vicini trovano il nome atteso in IT ed EN.
- `BulkSimulationTest`: encoder a tabella entro ±1 livello da quello esatto,
  simulazione in blocco = simulazione per pixel.
- `ConfusionTest`:
  - l'asse di confusione è quasi annullato dalle matrici protan e deutan;
  - il verde felce ha un gemello chiaro per la visione tipica e identico per il deutan;
  - nessun gemello con visione tipica, né in deutan 30 %;
  - in deutan 70 % il gemello rientra nel rumore della tavola;
  - il numero della tavola è visibile per la visione tipica (ΔE > 6) e
    nascosto nella simulazione (ΔE < 1,5);
  - le tavole sono riproducibili.
- `ProbeReasonTest` (app): verdetto nessuno / colore / bordo, anche con "colori diversi" spento.
- `YuvTest`: grigi, valori JFIF noti, andata e ritorno RGB → YUV → RGB, stride e crominanza 2×2.
- `ResampleTest`: media a blocchi, blocchi parziali scartati, scacchiera → grigio (niente aliasing).
- `AdaptiveFactorTest` (app): più lento → più grossolano (solo dopo la finestra),
  più veloce → più fine, limiti, banda di isteresi, picco di warm-up ignorato.
- `ViewTransformTest` (app): letterbox, tap → pixel anche con zoom, pizzico che
  tiene fermo il punto sotto le dita, limiti di zoom/pan, doppio tocco.

- `ColorSpacesTest`: curva sRGB, round-trip di tutti i 256 valori, valori Lab
  di riferimento (bianco, nero, grigio 50 %, primari, giallo).
- `DeltaE2000Test`: le 34 coppie dei dati di test di Sharma (4 decimali), simmetria.
- `CvdSimulatorTest`: le righe di tutte le 33 matrici sommano a 1 (grigi
  invariati), gravità 0 = visione normale, interpolazione, deutan confonde
  marrone/verde oliva, rosso/verde di pari chiarezza e rosa/grigio,
  mantiene blu/giallo; tritan confonde azzurro/verde acqua ma non
  marrone/oliva; la confusione cresce con la gravità.
- `PerceptionAnalyzerTest`: bordo marrone/oliva perso (deutan), bordi di
  luminanza mai segnalati, bordo rosso/verde puro non perso, mappa vuota con
  gravità 0, anomalia lieve < dicromasia, overlay che toccano solo i pixel critici,
  risultati identici riusando l'istanza su fotogrammi di dimensioni diverse,
  layer (heat/maschera) equivalenti agli overlay "cotti".
