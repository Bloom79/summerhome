package dev.colorgap.app

import android.graphics.Bitmap
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import dev.colorgap.colorcore.AnalysisConfig
import dev.colorgap.colorcore.Argb
import dev.colorgap.colorcore.CieLab
import dev.colorgap.colorcore.ColorMatch
import dev.colorgap.colorcore.ColorNames
import dev.colorgap.colorcore.CvdProfile
import dev.colorgap.colorcore.CvdSimulator
import dev.colorgap.colorcore.DeltaE
import dev.colorgap.colorcore.Overlays
import dev.colorgap.colorcore.PerceptionAnalyzer
import kotlin.math.max
import kotlin.math.min

enum class ViewMode { HEATMAP, STRIPES, SPLIT }

/**
 * A photo analyzed for one profile. The perception map is computed at a
 * reduced resolution (the costly part) and its score upscaled to the display
 * resolution; the simulated image is computed at full display resolution.
 */
class AnalyzedPhoto(
    val width: Int,
    val height: Int,
    val pixels: IntArray,
    val simulated: IntArray,
    val score: FloatArray,
    val original: ImageBitmap,
    val simulatedImage: ImageBitmap,
    val profile: CvdProfile,
    val config: AnalysisConfig,
    val analysisMillis: Long,
) {
    fun criticalFraction(threshold: Float): Float = score.count { it >= threshold }.toFloat() / score.size

    /** Pixels of the image shown for [mode] (split is composed by the canvas on screen, here for export). */
    fun render(mode: ViewMode, threshold: Float, split: Float): IntArray = when (mode) {
        ViewMode.HEATMAP -> Overlays.heatmap(pixels, score, threshold, profile.type)
        ViewMode.STRIPES -> Overlays.stripes(pixels, score, width, threshold)
        ViewMode.SPLIT -> Overlays.split(pixels, simulated, width, split)
    }

    /** Names the color around ([x], [y]). */
    fun probe(x: Int, y: Int, threshold: Float): ColorProbe =
        ColorProbe.at(pixels, width, height, x, y, CvdSimulator(profile), score[y * width + x], threshold, config)

    companion object {
        /** Long side of the image the perception map is computed on. */
        const val ANALYSIS_MAX_SIDE = 640

        fun analyze(bitmap: Bitmap, profile: CvdProfile, config: AnalysisConfig = AnalysisConfig()): AnalyzedPhoto {
            val start = System.nanoTime()
            val w = bitmap.width
            val h = bitmap.height
            val pixels = IntArray(w * h).also { bitmap.getPixels(it, 0, w, 0, 0, w, h) }

            val small = PhotoLoader.scaledDown(bitmap, ANALYSIS_MAX_SIDE)
            val sw = small.width
            val sh = small.height
            val smallPixels = IntArray(sw * sh).also { small.getPixels(it, 0, sw, 0, 0, sw, sh) }
            if (small !== bitmap) small.recycle()
            val map = PerceptionAnalyzer(profile, config).analyze(smallPixels, sw, sh)

            val score = map.scoreResized(w, h)
            val simulated = CvdSimulator(profile).simulateInto(pixels)
            val elapsed = (System.nanoTime() - start) / 1_000_000
            return AnalyzedPhoto(
                w, h, pixels, simulated, score,
                bitmap.asImageBitmap(), toBitmap(simulated, w, h).asImageBitmap(),
                profile, config, elapsed,
            )
        }

        fun toBitmap(argb: IntArray, w: Int, h: Int): Bitmap = Bitmap.createBitmap(argb, w, h, Bitmap.Config.ARGB_8888)
    }
}

/** What the user learns by tapping a point. */
data class ColorProbe(
    val x: Int,
    val y: Int,
    val realArgb: Int,
    val seenArgb: Int,
    val realName: ColorMatch,
    val seenName: ColorMatch,
    /** ΔE2000 between the real color and how the user sees it: always meaningful, whatever the display settings. */
    val colorShift: Float,
    /** The map says an edge between two colors disappears for the user here. */
    val edgeLost: Boolean,
) {
    enum class ColorVerdict { SAME, SLIGHT, DIFFERENT }

    val colorVerdict: ColorVerdict
        get() = when {
            colorShift < SLIGHT_SHIFT -> ColorVerdict.SAME
            colorShift < CLEAR_SHIFT -> ColorVerdict.SLIGHT
            else -> ColorVerdict.DIFFERENT
        }

    val critical: Boolean get() = edgeLost || colorVerdict == ColorVerdict.DIFFERENT

    companion object {
        /** Shared with the map (AnalysisConfig), so card and map agree on what is "different". */
        const val SLIGHT_SHIFT = AnalysisConfig.SLIGHT_SHIFT
        const val CLEAR_SHIFT = AnalysisConfig.CLEAR_SHIFT

        /**
         * Names [real] and its simulation. The color verdict comes from the
         * color itself (so it stays true even when the map highlights edges
         * only); an edge counts as lost when the map [score] is critical and
         * the color-loss part cannot explain it.
         */
        fun of(x: Int, y: Int, real: Int, simulator: CvdSimulator, score: Float, threshold: Float, config: AnalysisConfig): ColorProbe {
            val seen = simulator.simulateArgb(real)
            val shift = DeltaE.ciede2000(CieLab.fromArgb(real), CieLab.fromArgb(seen)).toFloat()
            val colorPart = config.colorScore(shift)
            val edgeLost = score >= threshold && colorPart < threshold
            return ColorProbe(x, y, real, seen, ColorNames.nearest(real), ColorNames.nearest(seen), shift, edgeLost)
        }

        /** Averages a small patch around ([x], [y]) to tame sensor noise, then [of]. */
        fun at(
            pixels: IntArray, width: Int, height: Int, x: Int, y: Int,
            simulator: CvdSimulator, score: Float, threshold: Float, config: AnalysisConfig, radius: Int = 2,
        ): ColorProbe {
            var r = 0; var g = 0; var b = 0; var n = 0
            for (yy in max(0, y - radius)..min(height - 1, y + radius)) {
                for (xx in max(0, x - radius)..min(width - 1, x + radius)) {
                    val c = pixels[yy * width + xx]
                    r += Argb.red(c); g += Argb.green(c); b += Argb.blue(c); n++
                }
            }
            return of(x, y, Argb.pack(r / n, g / n, b / n), simulator, score, threshold, config)
        }
    }
}
