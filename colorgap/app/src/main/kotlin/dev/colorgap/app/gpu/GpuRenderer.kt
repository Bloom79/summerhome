package dev.colorgap.app.gpu

import android.app.ActivityManager
import android.content.Context
import android.content.res.AssetManager
import android.graphics.Bitmap
import android.opengl.GLSurfaceView
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import dev.colorgap.app.ColorProbe
import dev.colorgap.app.ViewMode
import dev.colorgap.app.live.LiveAnalyzer
import dev.colorgap.app.live.LiveSettings
import dev.colorgap.colorcore.CvdProfile
import dev.colorgap.colorcore.CvdSimulator
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.ceil

/** What the UI shows about the GPU path (throttled; the image itself is drawn by GL). */
data class GpuLiveState(
    val frameWidth: Int,
    val frameHeight: Int,
    val mapWidth: Int,
    val mapHeight: Int,
    val fps: Float,
    val criticalFraction: Float,
    val probe: ColorProbe?,
)

/**
 * Live camera on the GPU: receives CameraX RGBA frames (as an
 * [ImageAnalysis.Analyzer]), uploads them on the GL thread, runs the
 * [GpuPipeline] and draws. Frames are held, not copied: CameraX delivers the
 * next one only after the previous is closed, right after its upload.
 */
class GpuRenderer(
    private val assets: AssetManager,
    private val density: Float,
    /** Called on the main thread if this device cannot run the pipeline (fallback to CPU). */
    private val onUnsupported: () -> Unit,
) : GLSurfaceView.Renderer, ImageAnalysis.Analyzer {

    @Volatile
    var settings: LiveSettings = LiveSettings(CvdProfile(), ViewMode.HEATMAP, 0.35f)
        set(value) {
            field = value
            view?.requestRender()
        }

    @Volatile
    var view: GLSurfaceView? = null

    private val _state = MutableStateFlow<GpuLiveState?>(null)
    val state: StateFlow<GpuLiveState?> = _state

    private val main = Handler(Looper.getMainLooper())
    private val lock = Any()
    private var pending: ImageProxy? = null
    @Volatile
    private var ready = false
    private var failed = false

    private var pipeline: GpuPipeline? = null
    private var viewWidth = 0
    private var viewHeight = 0

    private var freezeRequest: ((Bitmap) -> Unit)? = null

    // Statistics (GL thread).
    private var frames = 0
    private var windowStart = 0L
    private var fps = 0f
    private var critical = 0f
    private var probe: ColorProbe? = null
    private var simulator: CvdSimulator? = null
    private var frameCount = 0L

    override fun analyze(image: ImageProxy) {
        val v = view
        if (!ready || v == null) {
            image.close()
            return
        }
        synchronized(lock) {
            pending?.close()
            pending = image
        }
        v.requestRender()
    }

    /** Captures the next drawn frame upright (long side [longSide]); [onFrozen] runs on the main thread. */
    fun requestFreeze(longSide: Int = LiveAnalyzer.DISPLAY_LONG_SIDE, onFrozen: (Bitmap) -> Unit) {
        view?.queueEvent {
            val bitmap = if (ready) pipeline?.uprightBitmap(longSide) else null
            if (bitmap != null) main.post { onFrozen(bitmap) }
        }
        view?.requestRender()
    }

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        // Also called after the EGL context was lost: every GL object must be recreated.
        pipeline = null
        try {
            if (!GpuPipeline.supportsFloatTargets()) throw GlException("no half-float render targets")
            pipeline = GpuPipeline(ShaderSources(assets))
            ready = true
        } catch (e: RuntimeException) {
            fail(e)
        }
    }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        viewWidth = width
        viewHeight = height
    }

    override fun onDrawFrame(gl: GL10?) {
        val p = pipeline ?: return
        val s = settings
        try {
            val image = synchronized(lock) { pending.also { pending = null } }
            if (image != null) {
                try {
                    p.upload(image)
                } finally {
                    image.close()
                }
                p.analyze(s.profile, s.config)
                countFrame()
                if (++frameCount % READBACK_EVERY == 0L) readback(p, s)
            }
            p.draw(viewWidth, viewHeight, s.mode, s.threshold, s.split, density)
        } catch (e: RuntimeException) {
            fail(e)
        }
    }

    private fun countFrame() {
        val now = System.nanoTime()
        if (windowStart == 0L) windowStart = now
        frames++
        val elapsed = now - windowStart
        if (elapsed >= 1_000_000_000L) {
            fps = frames * 1e9f / elapsed
            frames = 0
            windowStart = now
        }
    }

    private fun readback(p: GpuPipeline, s: LiveSettings) {
        if (p.readScoreAsync()) {
            val bytes = p.scoreBytes!!
            val limit = ceil(s.threshold * 255f).toInt() // same test as the shader: byte / 255 >= threshold
            var count = 0
            for (b in bytes) if ((b.toInt() and 0xFF) >= limit) count++
            critical = count.toFloat() / bytes.size
        }
        probe = s.probePoint
            ?.takeIf { (x, y) -> x in 0 until p.frameWidth && y in 0 until p.frameHeight }
            ?.let { (x, y) ->
                val sim = simulator?.takeIf { it.profile == s.profile } ?: CvdSimulator(s.profile).also { simulator = it }
                ColorProbe.of(x, y, p.probeColor(x, y), sim, p.scoreAt(x, y), s.threshold, s.config)
            }
        _state.value = GpuLiveState(p.frameWidth, p.frameHeight, p.mapWidth, p.mapHeight, fps, critical, probe)
    }

    private fun fail(e: RuntimeException) {
        Log.w(TAG, "GPU pipeline unavailable, falling back to CPU", e)
        ready = false
        synchronized(lock) {
            pending?.close()
            pending = null
        }
        if (!failed) {
            failed = true
            main.post(onUnsupported)
        }
    }

    /**
     * The GL view is going away (its context dies with it): stop accepting
     * frames until a new view's [onSurfaceCreated] rebuilds the pipeline.
     */
    fun detach(from: GLSurfaceView) {
        if (view !== from) return
        view = null
        ready = false
        dropPending()
    }

    /** Closes a frame still waiting for the GL thread (call when unbinding the camera). */
    fun dropPending() {
        synchronized(lock) {
            pending?.close()
            pending = null
        }
    }

    companion object {
        private const val TAG = "ColorGapGpu"
        /** Critical area, probe and fps are refreshed every this many frames. */
        private const val READBACK_EVERY = 4L

        /** OpenGL ES 3.0 is required (checked before creating any GL view). */
        fun deviceSupportsEs3(context: Context): Boolean {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            return am.deviceConfigurationInfo.reqGlEsVersion >= 0x30000
        }
    }
}
