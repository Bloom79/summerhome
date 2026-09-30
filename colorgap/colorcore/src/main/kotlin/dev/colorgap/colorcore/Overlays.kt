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

    /**
     * Half width of the graded marking around the threshold, in score units:
     * marking fades in linearly from `threshold - RAMP_HALF_WIDTH` (nothing)
     * to `threshold + RAMP_HALF_WIDTH` (full). At the default threshold this
     * spans color changes of about ΔE 5 … 15, so an area whose change varies a
     * little (a lawn at ΔE 8–12) is marked evenly, never cut by a hard line.
     */
    const val RAMP_HALF_WIDTH = 0.25f

    /** 0..1 marking strength for a [score]: proportional to it, no hard cut at [threshold]. */
    fun strength(score: Float, threshold: Float): Float =
        ((score - (threshold - RAMP_HALF_WIDTH)) / (2 * RAMP_HALF_WIDTH)).coerceIn(0f, 1f)

    /**
     * The heatmap tint: one color the user perceives well, strongly different
     * from grass, sand and skin (blue for protan/deutan, red for tritan). A
     * two-color ramp would pass through a gray that vanishes on natural scenes.
     */
    fun heatColor(type: CvdType): Int = heatRamp(type).first

    /** a) Semi-transparent heatmap, graded: the more a zone differs, the more opaque the tint. */
    fun heatmap(
        src: IntArray,
        score: FloatArray,
        threshold: Float,
        type: CvdType,
        maxAlpha: Float = HEAT_MAX_ALPHA,
    ): IntArray {
        val tint = heatColor(type)
        return IntArray(src.size) { i ->
            val st = strength(score[i], threshold)
            if (st <= 0f) src[i] else blend(src[i], tint, maxAlpha * st)
        }
    }

    const val HEAT_MAX_ALPHA = 0.75f

    fun heatmap(src: IntArray, map: PerceptionMap, threshold: Float, type: CvdType, maxAlpha: Float = HEAT_MAX_ALPHA) =
        heatmap(src, map.score, threshold, type, maxAlpha)

    /**
     * b) Diagonal black/white stripes, graded: their thickness grows with the
     * marking strength (thin where the difference is small, thick where it is
     * large). Pixels between the stripes are untouched, so the original colors
     * stay visible.
     */
    fun stripes(
        src: IntArray,
        score: FloatArray,
        width: Int,
        threshold: Float,
        period: Int = stripePeriod(width, src.size / width),
    ): IntArray {
        val maxBand = max(1, period / 5).toFloat()
        val black = Argb.pack(0, 0, 0)
        val white = Argb.pack(255, 255, 255)
        return IntArray(src.size) { i ->
            val band = maxBand * strength(score[i], threshold)
            if (band <= 0f) return@IntArray src[i]
            val phase = ((i % width) + (i / width)) % period
            when {
                phase < band -> black
                phase < 2 * band -> white
                else -> src[i]
            }
        }
    }

    fun stripes(src: IntArray, map: PerceptionMap, threshold: Float) =
        stripes(src, map.score, map.width, threshold)

    /** Stripe spacing proportional to the image, so it looks the same at any resolution. */
    fun stripePeriod(width: Int, height: Int): Int = max(8, min(width, height) / 40)

    /** c) Split view: [src] on the left of [split] (0..1), [simulated] on the right. */
    fun split(src: IntArray, simulated: IntArray, width: Int, split: Float = 0.5f): IntArray {
        val cut = (split.coerceIn(0f, 1f) * width).toInt()
        val lineHalf = max(1, width / 400)
        val white = Argb.pack(255, 255, 255)
        return IntArray(src.size) { i ->
            val x = i % width
            when {
                x in (cut - lineHalf) until (cut + lineHalf) -> white
                x < cut -> src[i]
                else -> simulated[i]
            }
        }
    }

    fun split(src: IntArray, map: PerceptionMap, split: Float = 0.5f) = split(src, map.simulated, map.width, split)

    /**
     * The heatmap as a standalone translucent layer (non-premultiplied ARGB).
     * Drawing it over the frame gives the same pixels as [heatmap]; used where
     * the layer is scaled up by the GPU.
     */
    fun heatLayer(score: FloatArray, threshold: Float, type: CvdType, maxAlpha: Float = HEAT_MAX_ALPHA, dst: IntArray = IntArray(score.size)): IntArray {
        val tint = heatColor(type) and 0x00FFFFFF
        for (i in score.indices) {
            val st = strength(score[i], threshold)
            dst[i] = if (st <= 0f) 0 else {
                val a = (maxAlpha * st * 255f + 0.5f).toInt().coerceIn(0, 255)
                tint or (a shl 24)
            }
        }
        return dst
    }

    /** White with alpha = marking strength: a mask whose opacity grades the stripes drawn through it. */
    fun maskLayer(score: FloatArray, threshold: Float, dst: IntArray = IntArray(score.size)): IntArray {
        for (i in score.indices) {
            val a = (strength(score[i], threshold) * 255f + 0.5f).toInt().coerceIn(0, 255)
            dst[i] = (a shl 24) or 0x00FFFFFF
        }
        return dst
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
