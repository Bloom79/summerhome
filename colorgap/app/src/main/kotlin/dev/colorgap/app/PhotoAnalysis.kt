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

/** Why a tapped point is flagged. */
enum class ProbeReason {
    /** Seen like everyone else. */
    NONE,
    /** The color itself looks different to the user (color loss dominates). */
    COLOR,
    /** An edge between two colors disappears for the user here (lost contrast dominates). */
    EDGE,
}

/** What the user learns by tapping a point. */
data class ColorProbe(
    val x: Int,
    val y: Int,
    val realArgb: Int,
    val seenArgb: Int,
    val realName: ColorMatch,
    val seenName: ColorMatch,
    val reason: ProbeReason,
) {
    val critical: Boolean get() = reason != ProbeReason.NONE

    companion object {
        /**
         * Names [real] and its simulation and tells why the point is flagged:
         * the map [score] says whether it is critical; the color's own shift
         * (the color-loss part of the score, recomputed here) says whether
         * that is because of the color or of a lost edge.
         */
        fun of(x: Int, y: Int, real: Int, simulator: CvdSimulator, score: Float, threshold: Float, config: AnalysisConfig): ColorProbe {
            val seen = simulator.simulateArgb(real)
            val shift = DeltaE.ciede2000(CieLab.fromArgb(real), CieLab.fromArgb(seen)).toFloat()
            val colorPart = config.colorWeight * ((shift - config.colorFloor) / config.colorScale).coerceIn(0f, 1f)
            val reason = when {
                score < threshold -> ProbeReason.NONE
                colorPart >= threshold -> ProbeReason.COLOR
                else -> ProbeReason.EDGE
            }
            return ColorProbe(x, y, real, seen, ColorNames.nearest(real), ColorNames.nearest(seen), reason)
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
