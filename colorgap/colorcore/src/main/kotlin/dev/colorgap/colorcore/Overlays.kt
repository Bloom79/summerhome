package dev.colorgap.colorcore

import kotlin.math.max
import kotlin.math.min

/**
 * CPU renderers for the three visualization modes, on packed ARGB buffers.
 * Used by the CPU fallback path and for exporting images; the GPU path
 * reimplements the same formulas in GLSL.
 */
object Overlays {
    /**
     * Two-stop heat ramp chosen to stay readable for the given deficiency:
     * blue→yellow for protan/deutan (their intact axis), red→cyan for tritan.
     * Both stops also differ strongly in lightness.
     */
    fun heatRamp(type: CvdType): Pair<Int, Int> = when (type) {
        CvdType.PROTAN, CvdType.DEUTAN -> Argb.fromHex("#1D3FBF") to Argb.fromHex("#FFE14D")
        CvdType.TRITAN -> Argb.fromHex("#B0103A") to Argb.fromHex("#9FF5FF")
    }

    /** a) Semi-transparent heatmap over the zones whose score reaches [threshold]. */
    fun heatmap(
        src: IntArray,
        map: PerceptionMap,
        threshold: Float,
        type: CvdType,
        maxAlpha: Float = 0.7f,
    ): IntArray {
        val (lo, hi) = heatRamp(type)
        val span = max(1f - threshold, 1e-3f)
        return IntArray(src.size) { i ->
            val s = map.score[i]
            if (s < threshold) return@IntArray src[i]
            val t = ((s - threshold) / span).coerceIn(0f, 1f)
            val heat = lerpColor(lo, hi, t)
            // Fade in just above the threshold so noisy scores near it don't speckle.
            val fade = PerceptionAnalyzer.smoothstep(threshold, threshold + 0.08f, s)
            blend(src[i], heat, maxAlpha * fade * (0.6f + 0.4f * t))
        }
    }

    /**
     * b) Diagonal black/white stripes over critical zones. Pixels between the
     * stripes are untouched, so the original colors stay visible.
     */
    fun stripes(src: IntArray, map: PerceptionMap, threshold: Float, period: Int = stripePeriod(map)): IntArray {
        val w = map.width
        val band = max(1, period / 5)
        val black = Argb.pack(0, 0, 0)
        val white = Argb.pack(255, 255, 255)
        return IntArray(src.size) { i ->
            if (map.score[i] < threshold) return@IntArray src[i]
            val phase = ((i % w) + (i / w)) % period
            when {
                phase < band -> black
                phase < 2 * band -> white
                else -> src[i]
            }
        }
    }

    /** Stripe spacing proportional to the image, so it looks the same at any resolution. */
    fun stripePeriod(map: PerceptionMap): Int = max(8, min(map.width, map.height) / 40)

    /** c) Split view: original on the left of [split] (0..1), the user's view on the right. */
    fun split(src: IntArray, map: PerceptionMap, split: Float = 0.5f): IntArray {
        val w = map.width
        val cut = (split.coerceIn(0f, 1f) * w).toInt()
        val lineHalf = max(1, w / 400)
        val white = Argb.pack(255, 255, 255)
        return IntArray(src.size) { i ->
            val x = i % w
            when {
                x in (cut - lineHalf) until (cut + lineHalf) -> white
                x < cut -> src[i]
                else -> map.simulated[i]
            }
        }
    }

    fun lerpColor(a: Int, b: Int, t: Float): Int = Argb.pack(
        (Argb.red(a) + (Argb.red(b) - Argb.red(a)) * t + 0.5f).toInt(),
        (Argb.green(a) + (Argb.green(b) - Argb.green(a)) * t + 0.5f).toInt(),
        (Argb.blue(a) + (Argb.blue(b) - Argb.blue(a)) * t + 0.5f).toInt(),
    )

    /** Alpha-blends [over] onto [base] (in sRGB space, as displays composite). */
    fun blend(base: Int, over: Int, alpha: Float): Int {
        val a = alpha.coerceIn(0f, 1f)
        return Argb.pack(
            (Argb.red(base) + (Argb.red(over) - Argb.red(base)) * a + 0.5f).toInt(),
            (Argb.green(base) + (Argb.green(over) - Argb.green(base)) * a + 0.5f).toInt(),
            (Argb.blue(base) + (Argb.blue(over) - Argb.blue(base)) * a + 0.5f).toInt(),
            Argb.alpha(base),
        )
    }
}
