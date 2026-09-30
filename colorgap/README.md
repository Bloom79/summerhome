# ColorGap

App Android (Kotlin, Jetpack Compose, CameraX) per persone daltoniche: mostra in
tempo reale **quali zone dell'inquadratura l'utente percepisce diversamente** da
una persona con visione normale. Tutto on-device, nessun accesso alla rete.

## Struttura

| Modulo      | Cosa contiene | Dipendenze |
|-------------|---------------|------------|
| `colorcore` | Tutta la matematica del colore, Kotlin puro (JVM): sRGB ↔ lineare ↔ CIELAB, ΔE2000, simulazione Machado 2009, analizzatore "perdita di colore" + "contrasto perso", renderer CPU degli overlay | nessuna (solo `kotlin-test` per i test) |
| `cli`       | Strumento desktop per provare l'algoritmo su foto reali prima che esista l'app | `colorcore`, JDK (`javax.imageio`) |
| `app`       | App Android: Compose, minSdk 26, targetSdk 35 | `colorcore`, AndroidX core-ktx, activity-compose, Compose BOM (ui, foundation, material3), ExifInterface |

## Piano e milestone

| # | Milestone | Stato |
|---|-----------|-------|
| 1 | `colorcore` + unit test (+ CLI per provarlo) | ✅ fatto |
| 2 | Analisi su foto statica: modulo `app`, apertura foto dalla galleria, overlay heatmap/righe/split, tap → nome colore (IT/EN) + HEX, zoom, esporta | ✅ fatto |
| 3 | Camera live CPU: CameraX `ImageAnalysis` a risoluzione ridotta, stessi overlay, freeze frame | da fare |
| 4 | Shader GPU: OpenGL ES 3.0 su texture esterna della camera, ≥ 24 fps, fallback CPU | da fare |
| 5 | UI e impostazioni: profilo (tipo, gravità 0–100 %) in DataStore, soglia, toggle modalità, UI IT/EN a una mano, pulsanti grandi | da fare |

Dipendenze ancora da confermare: CameraX (milestone 3), DataStore Preferences
(milestone 5). Nessuna libreria di rete; il manifest rimuove esplicitamente
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

## Algoritmo (`colorcore`)

Per ogni fotogramma (`PerceptionAnalyzer.analyze`):

1. **sRGB → RGB lineare** (curva IEC 61966-2-1, tabella a 256 valori).
2. **Simulazione** con le matrici di Machado, Oliveira & Fernandes 2009 su RGB
   lineare; gravità 0–1 interpolata linearmente tra i passi tabulati 0.0, 0.1, …, 1.0.
3. **Perdita di colore**: ΔE2000 (Sharma 2005) tra il pixel originale e quello
   simulato, in CIELAB D65.
   `colorLoss = clamp((ΔE − 3) / 20)`.
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
./gradlew :colorcore:test          # 36 unit test

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
  gravità 0, anomalia lieve < dicromasia, overlay che toccano solo i pixel critici.
