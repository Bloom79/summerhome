package dev.colorgap.colorcore

import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.roundToInt
import kotlin.random.Random

/** One plate of the calibration test: what to draw and which answers to offer. */
data class PlateSpec(
    val figure: Int,
    val background: Int,
    val digit: Int,
    /** Four digits to choose from (the right one among them), besides "no number". */
    val options: List<Int>,
    val seed: Long,
    /** The profile this plate is built to hide the digit from; null for a control plate everyone reads. */
    val target: CvdProfile?,
)

/** Outcome of the calibration test. */
sealed class CalibrationResult {
    /**
     * The estimated profile. [typeCertain] is false when the plates could not
     * tell protan from deutan (usual below ~90 %: their confusions are then
     * too similar for plates) and deutan, the most frequent, was assumed.
     */
    data class Profile(val profile: CvdProfile, val typeCertain: Boolean = true) : CalibrationResult()

    /** Every plate was read: color vision looks typical (or milder than the test can measure). */
    data object Typical : CalibrationResult()

    /** Control plates, visible to everyone, were missed: the answers can't be trusted. */
    data object Unreliable : CalibrationResult()
}

/**
 * Adaptive self-test, in the spirit of Ishihara plates, that estimates the
 * deficiency type and severity.
 *
 * Each plate hides a digit along the confusion direction of a target profile
 * (see [Confusion]): someone with that deficiency at that severity *or
 * stronger* can't read it; milder or typical vision can.
 *
 * 1. Type: two plates per type at [TYPE_SEVERITY]; the type whose plates the
 *    user fails most wins (ties get two more plates each, then fall back to
 *    deutan, the most frequent). All read → [CalibrationResult.Typical]
 *    (typical vision, or milder than the test can measure).
 * 2. Severity: bisection between [TYPE_SEVERITY] (failed) and 100 %: a failed
 *    level means "at least this severe", a read one "milder". Two plates per
 *    level (a third breaks a tie), [BISECTION_STEPS] steps; the estimate is
 *    the middle of the final interval, rounded to 5 %.
 * Two control plates (a lightness difference everyone sees) guard against
 * random or careless answers.
 *
 * Not a medical diagnosis: screens and lighting change what is shown.
 */
class CalibrationSession(seed: Long = System.nanoTime()) {
    private val rnd = Random(seed)
    private val queue = ArrayDeque<PlateSpec>()
    private var phase = Phase.TYPE
    // EnumMap: a fixed iteration order keeps a session reproducible from its seed.
    private val failsByType = java.util.EnumMap<CvdType, Int>(CvdType::class.java)
    private val record = mutableListOf<Pair<PlateSpec, Boolean>>()
    private var candidates: Set<CvdType> = emptySet()
    private val tieFails = java.util.EnumMap<CvdType, Int>(CvdType::class.java)
    private var controlsMissed = 0
    private var type = CvdType.DEUTAN
    private var lo = TYPE_SEVERITY // failed: at least this severe
    private var hi = 1.05 // read: milder than this (above 100 % so a dichromat can reach 100 %)
    private var levelAnswers = mutableListOf<Boolean>() // true = read
    private var level = 0.0
    private var step = 0

    /** Plates answered so far, and a rough total for a progress bar. */
    var answered = 0
        private set
    val expectedTotal = 2 + 2 * CvdType.entries.size + 6 + 2 * BISECTION_STEPS + 1

    var result: CalibrationResult? = null
        private set

    private enum class Phase { TYPE, SEVERITY, DONE }

    init {
        queue += control()
        val typePlates = CvdType.entries.flatMap { t -> List(2) { plateFor(CvdProfile(t, TYPE_SEVERITY)) } }.filterNotNull().shuffled(rnd)
        queue += typePlates
        queue += control()
    }

    /** The plate to show now, or null when [result] is ready. */
    val current: PlateSpec? get() = queue.firstOrNull()

    /** Records the answer to [current]: the digit chosen, or null for "I see no number". */
    fun answer(choice: Int?) {
        val plate = queue.removeFirstOrNull() ?: return
        answered++
        val read = choice == plate.digit
        val target = plate.target
        if (target != null) record += plate to read
        when {
            target == null -> if (!read) controlsMissed++
            phase == Phase.TYPE -> if (!read) (if (tieBroken) tieFails else failsByType).merge(target.type, 1, Int::plus)
            else -> levelAnswers += read
        }
        if (queue.none { it.target != null }) advance()
    }

    private fun advance() {
        when (phase) {
            Phase.TYPE -> {
                if (queue.isNotEmpty()) return // the closing control plate
                if (controlsMissed >= 2) return finish(CalibrationResult.Unreliable)
                val best = failsByType.values.maxOrNull() ?: 0
                if (best == 0) return finish(CalibrationResult.Typical)
                var leaders = failsByType.filterValues { it == best }.keys.sorted().toSet()
                if (leaders.size > 1 && !tieBroken) {
                    // At 40 % the protan and deutan confusions are close. Discriminating plates hide
                    // the digit from one type while the other type still sees it clearly; they only
                    // exist near 100 %, so milder cases may stay tied (see typeCertain).
                    tieBroken = true
                    queue += leaders.flatMap { t ->
                        val rival = leaders.first { it != t }
                        List(3) { plateFor(CvdProfile(t, 1.0), visibleTo = CvdProfile(rival, 1.0)) }
                    }.filterNotNull().shuffled(rnd)
                    if (queue.isNotEmpty()) return
                }
                if (tieBroken) {
                    val tieBest = leaders.maxOf { tieFails[it] ?: 0 }
                    val narrowed = leaders.filter { (tieFails[it] ?: 0) == tieBest }.sorted().toSet()
                    if (tieBest > 0) leaders = narrowed
                }
                candidates = leaders
                // Still tied after the extra plates: deutan (the most frequent) if it is among the leaders.
                type = if (leaders.size == 1 || CvdType.DEUTAN !in leaders) leaders.first() else CvdType.DEUTAN
                phase = Phase.SEVERITY
                nextLevel()
            }
            Phase.SEVERITY -> {
                val reads = levelAnswers.count { it }
                val fails = levelAnswers.size - reads
                if (reads == fails && levelAnswers.size < 3) {
                    // Split decision: a third plate breaks the tie.
                    val p = plateFor(CvdProfile(type, level))
                    if (p != null) { queue += p; return }
                }
                if (reads > fails) hi = level else lo = level
                step++
                if (step >= BISECTION_STEPS) return finish(fit())
                nextLevel()
            }
            Phase.DONE -> Unit
        }
    }

    private var tieBroken = false

    private fun nextLevel() {
        level = minOf((lo + hi) / 2, 1.0)
        levelAnswers = mutableListOf()
        val plates = List(2) { plateFor(CvdProfile(type, level)) }.filterNotNull()
        if (plates.isEmpty()) {
            // No plate can hide a digit at this level: count it as read.
            levelAnswers += true
            advance()
        } else {
            queue += plates
        }
    }

    /**
     * The profile whose simulated eye most likely gave the user's answers.
     * Every answered plate counts, not only the bisection boundary (which sits
     * above the true severity: a plate hidden at s is hidden from slightly
     * milder eyes too). Reading is modelled as a psychometric curve around
     * [READ_DELTA], so a clearly visible plate that was missed weighs more
     * than a borderline one. Near-ties between types are settled by how common
     * each is ([LOG_PRIOR]); the type is certain when the best other type is at
     * least 4× less likely; otherwise the severity is the probability-weighted
     * mean of the candidate types' best fits.
     */
    private fun fit(): CalibrationResult.Profile {
        fun logLikelihood(observer: CvdProfile) = record.sumOf { (plate, read) ->
            val pRead = 1 / (1 + exp(-(perceivedContrast(plate, observer) - READ_DELTA) / READ_SLOPE))
            ln((if (read) pRead else 1 - pRead).coerceAtLeast(1e-6))
        }
        val bestPerType = candidates.associateWith { t ->
            FIT_LEVELS.map { sev -> sev to logLikelihood(CvdProfile(t, sev)) + LOG_PRIOR.getValue(t) }.maxBy { it.second }
        }
        val (type, best) = bestPerType.maxBy { it.value.second }
        val runnerUp = bestPerType.filterKeys { it != type }.values.maxOfOrNull { it.second } ?: Double.NEGATIVE_INFINITY
        val certain = best.second - runnerUp >= ln(4.0)
        // When types compete, average their best severities by probability.
        val weights = bestPerType.mapValues { exp(it.value.second - best.second) }
        val raw = bestPerType.entries.sumOf { (t, v) -> v.first * weights.getValue(t) } / weights.values.sum()
        val severity = ((raw * 20).roundToInt() / 20.0).coerceIn(0.0, 1.0)
        return CalibrationResult.Profile(CvdProfile(type, severity), certain)
    }

    private fun finish(r: CalibrationResult) {
        phase = Phase.DONE
        result = r
        queue.clear()
    }

    /** A plate hiding a digit from [profile], from a random base color that has a usable twin. */
    private fun plateFor(profile: CvdProfile, visibleTo: CvdProfile? = null): PlateSpec? {
        for (base in BASES.shuffled(rnd)) {
            // A clear gap between "hidden" (≤ 4 ΔE for the target) and "obvious" (≥ 10 for typical vision),
            // so milder or typical eyes read the digit without effort.
            val pair = Confusion.twin(base, profile, maxUserDelta = 4.0, minTypicalDelta = 10.0, minRatio = 2.5, visibleTo = visibleTo)
            if (pair != null) {
                // Randomly swap figure and background, so the digit is not always the "base" color.
                return if (rnd.nextBoolean()) spec(pair.color, pair.twin, profile) else spec(pair.twin, pair.color, profile)
            }
        }
        return null
    }

    /** A digit in a lightness difference only, which every observer reads. */
    private fun control(): PlateSpec {
        val base = BASES[rnd.nextInt(BASES.size)]
        val lin = Srgb.toLinear(base)
        val darker = Srgb.fromLinear(LinearRgb(lin.r * 0.35, lin.g * 0.35, lin.b * 0.35))
        return spec(base, darker, null)
    }

    private fun spec(figure: Int, background: Int, target: CvdProfile?): PlateSpec {
        val digit = Plate.DIGITS[rnd.nextInt(Plate.DIGITS.size)]
        val options = (listOf(digit) + Plate.DIGITS.filter { it != digit }.shuffled(rnd).take(3)).shuffled(rnd)
        return PlateSpec(figure, background, digit, options, rnd.nextLong(), target)
    }

    companion object {
        /**
         * Severity of the type-finding plates and floor of the bisection: below
         * this, twins get too close to their base for a plate to hide anything.
         */
        const val TYPE_SEVERITY = 0.4
        const val BISECTION_STEPS = 4

        /**
         * Model of reading a plate: the digit shows when figure and background
         * look at least this far apart (ΔE2000), i.e. clearly above the ±10–20 %
         * lightness noise of the dots, which masks differences up to about 4.
         */
        const val READ_DELTA = 6.0
        /** Width (ΔE2000) of the transition from "can't read" to "reads" around [READ_DELTA]. */
        private const val READ_SLOPE = 1.0
        private val FIT_LEVELS = (0..20).map { it * 0.05 } // 0 % … 100 %: a stray miss can still fit "very mild"

        /** Relative frequency among color-deficient people: deutan ≈ 3× protan, tritan rare. */
        private val LOG_PRIOR = mapOf(CvdType.DEUTAN to ln(3.0), CvdType.PROTAN to 0.0, CvdType.TRITAN to ln(0.02))

        /** Mid-lightness base colors around the usual confusion regions (greens, browns, reds, grays, pinks, blues). */
        private val BASES = listOf(
            "#417056", "#8E7F67", "#C0392B", "#808080", "#6B8E23", "#A0522D", "#D98C8C",
            "#7F9A5C", "#B8860B", "#5F7F9F", "#9C6B98", "#C9A227", "#6495ED", "#20B2AA",
        ).map(Argb::fromHex)

        /** How far apart (ΔE2000) figure and background look to [observer]: what a plate relies on. */
        fun perceivedContrast(plate: PlateSpec, observer: CvdProfile): Double {
            val sim = CvdSimulator(observer)
            return DeltaE.ciede2000(CieLab.fromArgb(sim.simulateArgb(plate.figure)), CieLab.fromArgb(sim.simulateArgb(plate.background)))
        }
    }
}
