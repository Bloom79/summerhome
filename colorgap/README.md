# ColorGap

App Android (Kotlin, Jetpack Compose, CameraX) per persone daltoniche: mostra in
tempo reale **quali zone dell'inquadratura l'utente percepisce diversamente** da
una persona con visione normale. Tutto on-device, nessun accesso alla rete.

## Struttura

| Modulo      | Cosa contiene | Dipendenze |
|-------------|---------------|------------|
| `colorcore` | Tutta la matematica del colore, Kotlin puro (JVM): sRGB ↔ lineare ↔ CIELAB, ΔE2000, simulazione Machado 2009, analizzatore "perdita di colore" + "contrasto perso", renderer CPU degli overlay | nessuna (solo `kotlin-test` per i test) |
| `cli`       | Strumento desktop per provare l'algoritmo su foto reali prima che esista l'app | `colorcore`, JDK (`javax.imageio`) |
| `app`       | App Android (dalla milestone 2) | — |

## Piano e milestone

| # | Milestone | Stato |
|---|-----------|-------|
| 1 | `colorcore` + unit test (+ CLI per provarlo) | ✅ fatto |
| 2 | Analisi su foto statica: modulo `app`, apertura foto dalla galleria, overlay heatmap/righe/split, tap → nome colore (IT/EN) + HEX, zoom, esporta | da fare |
| 3 | Camera live CPU: CameraX `ImageAnalysis` a risoluzione ridotta, stessi overlay, freeze frame | da fare |
| 4 | Shader GPU: OpenGL ES 3.0 su texture esterna della camera, ≥ 24 fps, fallback CPU | da fare |
| 5 | UI e impostazioni: profilo (tipo, gravità 0–100 %) in DataStore, soglia, toggle modalità, UI IT/EN a una mano, pulsanti grandi | da fare |

Dipendenze previste (da confermare milestone per milestone prima di aggiungerle):
Android Gradle Plugin, Jetpack Compose (BOM), Activity Compose, CameraX
(`camera-core`, `camera-camera2`, `camera-lifecycle`, `camera-view`),
DataStore Preferences. Nessuna libreria di rete.

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

Requisiti: JDK 17+. Il wrapper Gradle scarica il resto.

```bash
cd colorgap
./gradlew :colorcore:test          # 29 unit test

# grafico di prova (coppie di confusione, tavola tipo Ishihara, linee)
./gradlew :cli:run --args="chart samples/confusion-chart.png"
./gradlew :cli:run --args="samples/confusion-chart.png --type deutan --severity 100 --threshold 0.35"
# qualunque foto (percorso relativo alla cartella colorgap)
./gradlew :cli:run --args="../3I4A8711.JPG --type protan --severity 60"
```

Le immagini finiscono in `colorgap/out/`: `-heatmap`, `-stripes` (righe diagonali),
`-split` (normale | come vedi tu), `-simulated`, `-score` (mappa in grigi).

### Cosa coprono i test

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
