package dev.colorgap.colorcore

import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Tuning of the perception-difference map. All distances are ΔE2000;
 * edge strengths are normalized so that a sharp step between two colors
 * reads as their ΔE2000.
 */
data class AnalysisConfig(
    /** ΔE2000 below this is treated as "same color" (camera noise, JND). */
    val colorFloor: Float = 3f,
    /** ΔE2000 above [colorFloor] at which color loss saturates to 1. */
    val colorScale: Float = 20f,
    /** Weight of color loss in the combined score (contrast loss has weight 1). */
    val colorWeight: Float = 0.6f,
    /** Edge strength lost below this is ignored (sensor noise). */
    val contrastFloor: Float = 2f,
    /** Edge strength lost above [contrastFloor] at which the drop saturates. */
    val contrastScale: Float = 12f,
    /** Simulated edge ≤ this is considered invisible to the user… */
    val edgeInvisible: Float = 3f,
    /** …and ≥ this clearly visible (smoothstep in between). */
    val edgeVisible: Float = 20f,
    /** 3×3 box blur before the gradients, to suppress sensor noise. */
    val preBlur: Boolean = true,
    /** Radius (px) of the max filter that widens lost edges into visible bands. */
    val contrastSpread: Int = 2,
) {
    init {
        require(colorScale > 0f && contrastScale > 0f) { "scales must be > 0" }
        require(edgeVisible > edgeInvisible) { "edgeVisible must exceed edgeInvisible" }
        require(contrastSpread >= 0) { "contrastSpread must be >= 0" }
    }
}

/** Per-pixel result of [PerceptionAnalyzer.analyze]; all arrays are row-major, size width×height. */
class PerceptionMap(
    val width: Int,
    val height: Int,
    /** Raw ΔE2000 between each original pixel and its simulated appearance. */
    val colorDelta: FloatArray,
    /** Normalized 0..1 "color loss". */
    val colorLoss: FloatArray,
    /** Normalized 0..1 "lost contrast": an edge visible normally but not to the user. */
    val contrastLoss: FloatArray,
    /** Combined 0..1 score: max(contrastLoss, colorWeight × colorLoss). */
    val score: FloatArray,
    /** The frame as the user sees it (ARGB). */
    val simulated: IntArray,
) {
    fun index(x: Int, y: Int): Int = y * width + x

    fun isCritical(x: Int, y: Int, threshold: Float): Boolean = score[index(x, y)] >= threshold

    /** Share of pixels whose score reaches [threshold]. */
    fun criticalFraction(threshold: Float): Float = score.count { it >= threshold }.toFloat() / score.size
}

/**
 * Computes, for a frame, which zones the user perceives differently from a
 * person with normal color vision.
 *
 * 1. sRGB → linear RGB.
 * 2. Simulate the user's vision (Machado 2009, interpolated by severity).
 * 3. Color loss: ΔE2000 between original and simulated pixel.
 * 4. Lost contrast: Sobel-style edge strength (measured in ΔE2000) of the
 *    original minus that of the simulation. An edge counts as lost when it
 *    dropped by a meaningful amount AND what remains is too weak to see.
 *    Lightness is part of the edge on purpose: a red/green edge that still
 *    differs in lightness stays visible to the user, and is not flagged.
 * 5. score = max(contrastLoss, colorWeight × colorLoss), in 0..1.
 *
 * Not thread-safe; use one instance per worker thread.
 */
class PerceptionAnalyzer(
    val profile: CvdProfile,
    val config: AnalysisConfig = AnalysisConfig(),
) {
    private val m = CvdSimulator(profile).matrix

    fun analyze(argb: IntArray, width: Int, height: Int): PerceptionMap {
        require(width > 0 && height > 0 && argb.size >= width * height) { "bad frame size" }
        val n = width * height
        val labO = FloatArray(3 * n)
        val labS = FloatArray(3 * n)
        val simulated = IntArray(n)
        val colorDelta = FloatArray(n)
        val colorLoss = FloatArray(n)

        for (i in 0 until n) {
            val c = argb[i]
            val r = Srgb.channelToLinear(Argb.red(c))
            val g = Srgb.channelToLinear(Argb.green(c))
            val b = Srgb.channelToLinear(Argb.blue(c))
            val sr = (m[0] * r + m[1] * g + m[2] * b).coerceIn(0.0, 1.0)
            val sg = (m[3] * r + m[4] * g + m[5] * b).coerceIn(0.0, 1.0)
            val sb = (m[6] * r + m[7] * g + m[8] * b).coerceIn(0.0, 1.0)
            val k = 3 * i
            CieLab.linearToLab(r, g, b, labO, k)
            CieLab.linearToLab(sr, sg, sb, labS, k)
            simulated[i] = Argb.pack(
                Srgb.linearToChannel(sr), Srgb.linearToChannel(sg), Srgb.linearToChannel(sb), Argb.alpha(c),
            )
            val d = DeltaE.ciede2000(
                labO[k].toDouble(), labO[k + 1].toDouble(), labO[k + 2].toDouble(),
                labS[k].toDouble(), labS[k + 1].toDouble(), labS[k + 2].toDouble(),
            ).toFloat()
            colorDelta[i] = d
            colorLoss[i] = ((d - config.colorFloor) / config.colorScale).coerceIn(0f, 1f)
        }

        // A 3×3 box blur turns a sharp step into a ramp whose 2-px Sobel
        // difference is ~2/3 of the step; compensate so thresholds keep their meaning.
        val (edgeO, edgeS) = if (config.preBlur) {
            edgeStrength(boxBlur3(labO, width, height), width, height, 1.5f) to
                edgeStrength(boxBlur3(labS, width, height), width, height, 1.5f)
        } else {
            edgeStrength(labO, width, height, 1f) to edgeStrength(labS, width, height, 1f)
        }

        // Judge what remains of an edge by its local peak: on the flanks of a
        // (blurred) edge the simulated strength is low merely because it is
        // the tail of the ramp, not because the edge vanished.
        val edgeSPeak = maxFilter(edgeS, width, height, 1)
        var contrastLoss = FloatArray(n)
        for (i in 0 until n) {
            val drop = ((edgeO[i] - edgeSPeak[i] - config.contrastFloor) / config.contrastScale).coerceIn(0f, 1f)
            val hidden = 1f - smoothstep(config.edgeInvisible, config.edgeVisible, edgeSPeak[i])
            contrastLoss[i] = drop * hidden
        }
        if (config.contrastSpread > 0) contrastLoss = maxFilter(contrastLoss, width, height, config.contrastSpread)

        val score = FloatArray(n) { max(contrastLoss[it], config.colorWeight * colorLoss[it]) }
        return PerceptionMap(width, height, colorDelta, colorLoss, contrastLoss, score, simulated)
    }

    companion object {
        fun smoothstep(e0: Float, e1: Float, x: Float): Float {
            val t = ((x - e0) / (e1 - e0)).coerceIn(0f, 1f)
            return t * t * (3f - 2f * t)
        }

        /**
         * Sobel-structured edge strength measured with ΔE2000: the 1-2-1
         * weighted Lab averages of the left and right columns (top and bottom
         * rows) are compared with ΔE2000 instead of subtracted per channel,
         * and the two directions are combined as a vector magnitude.
         *
         * Plain Sobel on a*b* (Euclidean Lab) overstates chroma steps among
         * saturated colors, e.g. two olive-yellows a deutan barely tells
         * apart would still read as a visible edge. A sharp step between
         * colors A and B reads ≈ ΔE2000(A, B) × [gain].
         */
        internal fun edgeStrength(lab: FloatArray, w: Int, h: Int, gain: Float): FloatArray {
            val out = FloatArray(w * h)
            for (y in 0 until h) {
                val y0 = max(y - 1, 0) * w
                val y1 = y * w
                val y2 = min(y + 1, h - 1) * w
                for (x in 0 until w) {
                    val x0 = max(x - 1, 0)
                    val x2 = min(x + 1, w - 1)
                    val tl = 3 * (y0 + x0); val tc = 3 * (y0 + x); val tr = 3 * (y0 + x2)
                    val ml = 3 * (y1 + x0); val mr = 3 * (y1 + x2)
                    val bl = 3 * (y2 + x0); val bc = 3 * (y2 + x); val br = 3 * (y2 + x2)
                    val gx = DeltaE.ciede2000(
                        weighted(lab, tl, ml, bl, 0), weighted(lab, tl, ml, bl, 1), weighted(lab, tl, ml, bl, 2),
                        weighted(lab, tr, mr, br, 0), weighted(lab, tr, mr, br, 1), weighted(lab, tr, mr, br, 2),
                    )
                    val gy = DeltaE.ciede2000(
                        weighted(lab, tl, tc, tr, 0), weighted(lab, tl, tc, tr, 1), weighted(lab, tl, tc, tr, 2),
                        weighted(lab, bl, bc, br, 0), weighted(lab, bl, bc, br, 1), weighted(lab, bl, bc, br, 2),
                    )
                    out[y1 + x] = (sqrt(gx * gx + gy * gy) * gain).toFloat()
                }
            }
            return out
        }

        /** 1-2-1 weighted mean of channel [c] at three interleaved-Lab offsets. */
        private fun weighted(lab: FloatArray, p: Int, q: Int, r: Int, c: Int): Double =
            (lab[p + c] + 2f * lab[q + c] + lab[r + c]) / 4.0

        /** Separable 3×3 box blur of an interleaved 3-channel buffer, clamped borders. */
        internal fun boxBlur3(src: FloatArray, w: Int, h: Int): FloatArray {
            val tmp = FloatArray(src.size)
            val out = FloatArray(src.size)
            for (y in 0 until h) for (x in 0 until w) {
                val a = 3 * (y * w + max(x - 1, 0)); val b = 3 * (y * w + x); val c = 3 * (y * w + min(x + 1, w - 1))
                for (k in 0 until 3) tmp[b + k] = (src[a + k] + src[b + k] + src[c + k]) / 3f
            }
            for (y in 0 until h) for (x in 0 until w) {
                val a = 3 * (max(y - 1, 0) * w + x); val b = 3 * (y * w + x); val c = 3 * (min(y + 1, h - 1) * w + x)
                for (k in 0 until 3) out[b + k] = (tmp[a + k] + tmp[b + k] + tmp[c + k]) / 3f
            }
            return out
        }

        /** Separable square max filter of radius [r]. */
        internal fun maxFilter(src: FloatArray, w: Int, h: Int, r: Int): FloatArray {
            val tmp = FloatArray(src.size)
            val out = FloatArray(src.size)
            for (y in 0 until h) for (x in 0 until w) {
                var v = 0f
                for (dx in max(x - r, 0)..min(x + r, w - 1)) v = max(v, src[y * w + dx])
                tmp[y * w + x] = v
            }
            for (y in 0 until h) for (x in 0 until w) {
                var v = 0f
                for (dy in max(y - r, 0)..min(y + r, h - 1)) v = max(v, tmp[dy * w + x])
                out[y * w + x] = v
            }
            return out
        }
    }
}
