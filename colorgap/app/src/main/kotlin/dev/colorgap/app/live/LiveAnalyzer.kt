package dev.colorgap.app.live

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import dev.colorgap.app.ColorProbe
import dev.colorgap.app.ViewMode
import dev.colorgap.colorcore.AnalysisConfig
import dev.colorgap.colorcore.CvdProfile
import dev.colorgap.colorcore.CvdSimulator
import dev.colorgap.colorcore.Overlays
import dev.colorgap.colorcore.PerceptionAnalyzer
import dev.colorgap.colorcore.Resample
import dev.colorgap.colorcore.Yuv
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlin.math.max
import kotlin.math.roundToInt

/** What the UI controls about the live analysis. */
data class LiveSettings(
    val profile: CvdProfile,
    val mode: ViewMode,
    val threshold: Float,
    /** Point to name continuously, in frame pixels; null for none. */
    val probePoint: Pair<Int, Int>? = null,
    /** Split-view divider, 0..1 of the frame width. */
    val split: Float = 0.5f,
    val config: AnalysisConfig = AnalysisConfig(),
)

/** One processed camera frame, ready to draw. */
class LiveFrame(
    /** Upright camera frame at display resolution (a ring buffer: copy before keeping it). */
    val frame: Bitmap,
    val frameImage: ImageBitmap,
    /** Heat layer or stripe mask at analysis resolution, to be scaled over [frame]. */
    val layer: ImageBitmap,
    /** The frame as the user sees it, only in split mode. */
    val simulated: ImageBitmap?,
    val mode: ViewMode,
    val criticalFraction: Float,
    val probe: ColorProbe?,
    val analysisWidth: Int,
    val analysisHeight: Int,
    val fps: Float,
    val processingMillis: Float,
) {
    val width get() = frame.width
    val height get() = frame.height
}

/**
 * CPU pipeline for CameraX frames (YUV_420_888):
 * convert to RGB, rotate/scale into an upright display frame → box-downscale by an adaptive
 * integer factor → perception map → heat layer or stripe mask.
 *
 * The downscale factor adapts to keep processing near [TARGET_MILLIS], so slow
 * phones get a coarser map instead of a stuttering one. Output bitmaps rotate
 * through small ring buffers to avoid allocating megabytes per frame.
 */
class LiveAnalyzer : ImageAnalysis.Analyzer {
    @Volatile
    var settings: LiveSettings = LiveSettings(CvdProfile(), ViewMode.HEATMAP, 0.35f)

    private val _frames = MutableStateFlow<LiveFrame?>(null)
    val frames: StateFlow<LiveFrame?> = _frames

    private var analyzer: PerceptionAnalyzer? = null
    private var simulator: CvdSimulator? = null
    private val filterPaint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val matrix = Matrix()

    private var source: Bitmap? = null
    private val frameRing = BitmapRing()
    private val layerRing = BitmapRing()
    private val simulationRing = BitmapRing()
    private var framePixels = IntArray(0)
    private var simulatedPixels = IntArray(0)
    private var layerPixels = IntArray(0)
    private var smallPixels = IntArray(0)
    private var yuvPixels = IntArray(0)

    private val resolution = AdaptiveFactor(targetMillis = TARGET_MILLIS)
    private var avgInterval = 0f
    private var lastFrameNanos = 0L

    override fun analyze(image: ImageProxy) {
        image.use { process(it) }
    }

    private fun process(image: ImageProxy) {
        val start = System.nanoTime()
        val s = settings
        if (analyzer?.profile != s.profile || analyzer?.config != s.config) {
            analyzer = PerceptionAnalyzer(s.profile, s.config)
            simulator = CvdSimulator(s.profile)
        }

        // 1. Upright frame at display resolution.
        val frame = uprightFrame(image) ?: return
        val w = frame.width
        val h = frame.height
        if (framePixels.size != w * h) framePixels = IntArray(w * h)
        frame.getPixels(framePixels, 0, w, 0, 0, w, h)

        // 2. Perception map on the box-downscaled frame.
        val f = resolution.factor
        val sw = w / f
        val sh = h / f
        if (smallPixels.size != sw * sh) smallPixels = IntArray(sw * sh)
        Resample.boxDownscale(framePixels, w, h, f, smallPixels)
        val map = analyzer!!.analyze(smallPixels, sw, sh)

        // 3. What to draw on top.
        if (layerPixels.size != sw * sh) layerPixels = IntArray(sw * sh)
        if (s.mode == ViewMode.STRIPES) {
            Overlays.maskLayer(map.score, s.threshold, layerPixels)
        } else {
            Overlays.heatLayer(map.score, s.threshold, s.profile.type, dst = layerPixels)
        }
        val layer = layerRing.next(sw, sh)
        layer.setPixels(layerPixels, 0, sw, 0, 0, sw, sh)

        val simulated = if (s.mode == ViewMode.SPLIT) {
            if (simulatedPixels.size != w * h) simulatedPixels = IntArray(w * h)
            simulator!!.simulateInto(framePixels, simulatedPixels)
            simulationRing.next(w, h).also { it.setPixels(simulatedPixels, 0, w, 0, 0, w, h) }
        } else {
            null
        }

        val probe = s.probePoint
            ?.takeIf { (x, y) -> x in 0 until w && y in 0 until h }
            ?.let { (x, y) ->
                val mx = (x / f).coerceAtMost(sw - 1)
                val my = (y / f).coerceAtMost(sh - 1)
                ColorProbe.at(framePixels, w, h, x, y, simulator!!, critical = map.score[my * sw + mx] >= s.threshold)
            }

        val critical = map.criticalFraction(s.threshold)
        val millis = (System.nanoTime() - start) / 1e6f
        resolution.record(millis)
        val interval = if (lastFrameNanos == 0L) 0f else (start - lastFrameNanos) / 1e6f
        lastFrameNanos = start
        avgInterval = if (avgInterval == 0f) interval else avgInterval * 0.9f + interval * 0.1f

        _frames.value = LiveFrame(
            frame = frame,
            frameImage = frame.asImageBitmap(),
            layer = layer.asImageBitmap(),
            simulated = simulated?.asImageBitmap(),
            mode = s.mode,
            criticalFraction = critical,
            probe = probe,
            analysisWidth = sw,
            analysisHeight = sh,
            fps = if (avgInterval > 0f) 1000f / avgInterval else 0f,
            processingMillis = resolution.medianMillis,
        )
    }

    /** Converts the YUV frame to RGB and draws it rotated upright and scaled to [DISPLAY_LONG_SIDE]. */
    private fun uprightFrame(image: ImageProxy): Bitmap? {
        val planes = image.planes
        if (planes.size < 3) return null
        val w = image.width
        val h = image.height
        if (yuvPixels.size != w * h) yuvPixels = IntArray(w * h)
        Yuv.toArgb(plane(planes[0]), plane(planes[1]), plane(planes[2]), w, h, yuvPixels)
        val src = source?.takeIf { it.width == w && it.height == h }
            ?: Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also { source = it }
        src.setPixels(yuvPixels, 0, w, 0, 0, w, h)

        val crop = image.cropRect
        val rotation = image.imageInfo.rotationDegrees
        val sideways = rotation % 180 != 0
        val uprightW = if (sideways) crop.height() else crop.width()
        val uprightH = if (sideways) crop.width() else crop.height()
        val scale = DISPLAY_LONG_SIDE.toFloat() / max(uprightW, uprightH)
        // Width/height must stay multiples of any downscale factor we may use.
        val outW = roundDown((uprightW * scale).roundToInt())
        val outH = roundDown((uprightH * scale).roundToInt())

        matrix.reset()
        matrix.postTranslate(-crop.exactCenterX(), -crop.exactCenterY())
        matrix.postRotate(rotation.toFloat())
        matrix.postScale(outW.toFloat() / uprightW, outH.toFloat() / uprightH)
        matrix.postTranslate(outW / 2f, outH / 2f)
        val out = frameRing.next(outW, outH)
        Canvas(out).drawBitmap(src, matrix, filterPaint)
        return out
    }

    private fun plane(p: ImageProxy.PlaneProxy) = Yuv.Plane(p.buffer, p.rowStride, p.pixelStride)

    private fun roundDown(v: Int) = (v / LCM_FACTORS) * LCM_FACTORS

    /** Three bitmaps used in turn: the UI draws one while the next is written. */
    private class BitmapRing {
        private val slots = arrayOfNulls<Bitmap>(3)
        private var index = 0

        fun next(w: Int, h: Int): Bitmap {
            index = (index + 1) % slots.size
            val current = slots[index]
            if (current != null && current.width == w && current.height == h) return current
            return Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also { slots[index] = it }
        }
    }

    companion object {
        /** Long side of the frame shown on screen and used for freeze. */
        const val DISPLAY_LONG_SIDE = 960
        /** Processing budget per frame (≈ 20 fps). */
        const val TARGET_MILLIS = 50f
        /** lcm(2..6) = 60: frame sizes divisible by every factor [AdaptiveFactor] may pick. */
        private const val LCM_FACTORS = 60
    }
}
