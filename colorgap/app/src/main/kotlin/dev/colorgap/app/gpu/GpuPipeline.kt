package dev.colorgap.app.gpu

import android.graphics.Bitmap
import android.graphics.Rect
import android.opengl.GLES30.GL_COLOR_ATTACHMENT0
import android.opengl.GLES30.GL_COLOR_BUFFER_BIT
import android.opengl.GLES30.GL_EXTENSIONS
import android.opengl.GLES30.GL_FRAMEBUFFER
import android.opengl.GLES30.GL_HALF_FLOAT
import android.opengl.GLES30.GL_LINEAR
import android.opengl.GLES30.GL_MAP_READ_BIT
import android.opengl.GLES30.GL_NEAREST
import android.opengl.GLES30.GL_PIXEL_PACK_BUFFER
import android.opengl.GLES30.GL_READ_FRAMEBUFFER
import android.opengl.GLES30.GL_RGBA
import android.opengl.GLES30.GL_RGBA16F
import android.opengl.GLES30.GL_RGBA8
import android.opengl.GLES30.GL_STREAM_READ
import android.opengl.GLES30.GL_TEXTURE_2D
import android.opengl.GLES30.GL_TRIANGLES
import android.opengl.GLES30.GL_UNPACK_ALIGNMENT
import android.opengl.GLES30.GL_UNPACK_ROW_LENGTH
import android.opengl.GLES30.GL_UNSIGNED_BYTE
import android.opengl.GLES30.glBindBuffer
import android.opengl.GLES30.glBindFramebuffer
import android.opengl.GLES30.glBindTexture
import android.opengl.GLES30.glBindVertexArray
import android.opengl.GLES30.glBufferData
import android.opengl.GLES30.glClear
import android.opengl.GLES30.glClearColor
import android.opengl.GLES30.glDeleteBuffers
import android.opengl.GLES30.glDeleteVertexArrays
import android.opengl.GLES30.glDrawArrays
import android.opengl.GLES30.glGenBuffers
import android.opengl.GLES30.glGenVertexArrays
import android.opengl.GLES30.glGetString
import android.opengl.GLES30.glMapBufferRange
import android.opengl.GLES30.glPixelStorei
import android.opengl.GLES30.glReadBuffer
import android.opengl.GLES30.glReadPixels
import android.opengl.GLES30.glTexSubImage2D
import android.opengl.GLES30.glUnmapBuffer
import android.opengl.GLES30.glViewport
import androidx.camera.core.ImageProxy
import dev.colorgap.app.ViewMode
import dev.colorgap.app.ui.FitRect
import dev.colorgap.colorcore.AnalysisConfig
import dev.colorgap.colorcore.Argb
import dev.colorgap.colorcore.CvdProfile
import dev.colorgap.colorcore.CvdSimulator
import dev.colorgap.colorcore.Overlays
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * The perception pipeline on the GPU (OpenGL ES 3.0), GL thread only.
 *
 * Camera buffer (RGBA8, sensor orientation) → at map resolution: lab (MRT) →
 * blur (MRT) → edges → contrast → score, all half-float except the RGBA8
 * score → display at screen resolution. Same shaders and pass order as
 * tools/gpu-check, which verifies them against colorcore.
 */
class GpuPipeline(sources: ShaderSources) {
    private val config = AnalysisConfig()
    private val lab = GlProgram(sources.vertex, sources.fragment("lab.frag"), "lab")
    private val blur = GlProgram(sources.vertex, sources.fragment("blur.frag"), "blur")
    private val edges = GlProgram(sources.vertex, sources.fragment("edges.frag"), "edges")
    private val contrast = GlProgram(sources.vertex, sources.fragment("contrast.frag"), "contrast")
    private val score = GlProgram(sources.vertex, sources.fragment("score.frag"), "score")
    private val display = GlProgram(sources.vertex, sources.fragment("display.frag"), "display")
    private val probe = GlProgram(sources.vertex, sources.fragment("probe.frag"), "probe")
    private val upright = GlProgram(sources.vertex, sources.fragment("upright.frag"), "upright")
    private val vao = IntArray(1).also { glGenVertexArrays(1, it, 0) }[0]

    // Camera buffer.
    private var source: GlTexture? = null
    private val crop = Rect()
    private var rotation = 0
    val hasFrame get() = source != null

    /** Upright frame size (after rotation and crop). */
    var frameWidth = 0
        private set
    var frameHeight = 0
        private set

    // Map-resolution targets.
    private var factor = 1
    var mapWidth = 0
        private set
    var mapHeight = 0
        private set
    private var labFbo: GlFramebuffer? = null
    private var blurFbo: GlFramebuffer? = null
    private var edgesFbo: GlFramebuffer? = null
    private var contrastFbo: GlFramebuffer? = null
    private var scoreFbo: GlFramebuffer? = null
    private val probeFbo = GlFramebuffer(GlTexture(1, 1, GL_RGBA8, GL_RGBA, GL_UNSIGNED_BYTE, GL_NEAREST))

    // Asynchronous score readback: two pixel-pack buffers used in turn.
    private val pbos = IntArray(2).also { glGenBuffers(2, it, 0) }
    private var pboSize = 0
    private var pboPending = BooleanArray(2)
    private var pboIndex = 0

    /** Last score read back (R channel of RGBA8, map resolution), or null. */
    var scoreBytes: ByteArray? = null
        private set
    var scoreBytesWidth = 0
        private set

    private var profile: CvdProfile? = null
    private var simMatrix = FloatArray(9)
    private var heatLo = floatArrayOf(0f, 0f, 0f)
    private var heatHi = floatArrayOf(0f, 0f, 0f)

    /** Uploads a camera frame (RGBA_8888 ImageProxy) into the source texture. */
    fun upload(image: ImageProxy) {
        val plane = image.planes[0]
        val w = image.width
        val h = image.height
        val src = source?.takeIf { it.width == w && it.height == h }
            ?: GlTexture(w, h, GL_RGBA8, GL_RGBA, GL_UNSIGNED_BYTE, GL_LINEAR).also { source?.release(); source = it }
        glBindTexture(GL_TEXTURE_2D, src.id)
        glPixelStorei(GL_UNPACK_ROW_LENGTH, plane.rowStride / plane.pixelStride)
        glPixelStorei(GL_UNPACK_ALIGNMENT, 4)
        glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, plane.buffer.rewind())
        glPixelStorei(GL_UNPACK_ROW_LENGTH, 0)

        crop.set(image.cropRect)
        rotation = image.imageInfo.rotationDegrees
        val sideways = rotation % 180 != 0
        frameWidth = if (sideways) crop.height() else crop.width()
        frameHeight = if (sideways) crop.width() else crop.height()
        ensureMapTargets()
    }

    private fun ensureMapTargets() {
        val f = max(1, (max(frameWidth, frameHeight) / MAP_LONG_SIDE.toFloat()).roundToInt())
        val w = frameWidth / f
        val h = frameHeight / f
        if (f == factor && w == mapWidth && h == mapHeight && scoreFbo != null) return
        releaseMapTargets()
        factor = f
        mapWidth = w
        mapHeight = h
        fun half() = GlTexture(w, h, GL_RGBA16F, GL_RGBA, GL_HALF_FLOAT, GL_NEAREST)
        labFbo = GlFramebuffer(half(), half())
        blurFbo = GlFramebuffer(half(), half())
        edgesFbo = GlFramebuffer(half())
        contrastFbo = GlFramebuffer(half())
        scoreFbo = GlFramebuffer(GlTexture(w, h, GL_RGBA8, GL_RGBA, GL_UNSIGNED_BYTE, GL_LINEAR))
        pboSize = w * h * 4
        for (pbo in pbos) {
            glBindBuffer(GL_PIXEL_PACK_BUFFER, pbo)
            glBufferData(GL_PIXEL_PACK_BUFFER, pboSize, null, GL_STREAM_READ)
        }
        glBindBuffer(GL_PIXEL_PACK_BUFFER, 0)
        pboPending.fill(false)
        scoreBytes = null
    }

    private fun setProfile(p: CvdProfile) {
        if (p == profile) return
        profile = p
        val m = CvdSimulator(p).matrix
        simMatrix = FloatArray(9) { m[it].toFloat() }
        val (lo, hi) = Overlays.heatRamp(p.type)
        heatLo = rgb(lo)
        heatHi = rgb(hi)
    }

    /** Runs the analysis passes on the current source frame. */
    fun analyze(p: CvdProfile) {
        val src = source ?: return
        setProfile(p)
        glBindVertexArray(vao)
        pass(lab, labFbo!!) {
            sampler("uSrc", 0, src.id)
            ivec4("uCrop", crop.left, crop.top, crop.width(), crop.height())
            int("uRotation", rotation)
            int("uFactor", factor)
            mat3("uSim", simMatrix)
            float("uColorFloor", config.colorFloor)
            float("uColorScale", config.colorScale)
        }
        pass(blur, blurFbo!!) {
            sampler("uLabO", 0, labFbo!!.targets[0].id)
            sampler("uLabS", 1, labFbo!!.targets[1].id)
        }
        pass(edges, edgesFbo!!) {
            sampler("uBlurO", 0, blurFbo!!.targets[0].id)
            sampler("uBlurS", 1, blurFbo!!.targets[1].id)
            float("uGain", if (config.preBlur) 1.5f else 1f)
        }
        pass(contrast, contrastFbo!!) {
            sampler("uEdges", 0, edgesFbo!!.targets[0].id)
            float("uContrastFloor", config.contrastFloor)
            float("uContrastScale", config.contrastScale)
            float("uEdgeInvisible", config.edgeInvisible)
            float("uEdgeVisible", config.edgeVisible)
        }
        pass(score, scoreFbo!!) {
            sampler("uContrast", 0, contrastFbo!!.targets[0].id)
            int("uSpread", config.contrastSpread)
            float("uColorWeight", config.colorWeight)
        }
    }

    private inline fun pass(program: GlProgram, target: GlFramebuffer, setup: GlProgram.() -> Unit) {
        glBindFramebuffer(GL_FRAMEBUFFER, target.id)
        glViewport(0, 0, target.width, target.height)
        program.use()
        program.setup()
        glDrawArrays(GL_TRIANGLES, 0, 3)
    }

    /** Draws the frame with the chosen visualization, letterboxed in a [viewWidth]×[viewHeight] window. */
    fun draw(viewWidth: Int, viewHeight: Int, mode: ViewMode, threshold: Float, split: Float, density: Float) {
        glBindFramebuffer(GL_FRAMEBUFFER, 0)
        glViewport(0, 0, viewWidth, viewHeight)
        glClearColor(0f, 0f, 0f, 1f)
        glClear(GL_COLOR_BUFFER_BIT)
        val src = source ?: return
        val scoreTex = scoreFbo?.targets?.get(0) ?: return
        val fit = FitRect.of(viewWidth.toFloat(), viewHeight.toFloat(), frameWidth, frameHeight)
        val vx = fit.left.roundToInt()
        val vy = (viewHeight - fit.bottom).roundToInt() // GL window origin is bottom-left
        val vw = fit.width.roundToInt()
        val vh = fit.height.roundToInt()
        glViewport(vx, vy, vw, vh)
        glBindVertexArray(vao)
        display.use()
        display.sampler("uSrc", 0, src.id)
        display.sampler("uScore", 1, scoreTex.id)
        display.vec4("uCrop", crop.left.toFloat(), crop.top.toFloat(), crop.width().toFloat(), crop.height().toFloat())
        display.int("uRotation", rotation)
        display.vec2("uSrcSize", src.width.toFloat(), src.height.toFloat())
        display.int("uMode", mode.ordinal)
        display.float("uThreshold", threshold)
        display.float("uSplit", split)
        display.float("uMaxAlpha", 0.7f)
        display.vec3("uHeatLo", heatLo[0], heatLo[1], heatLo[2])
        display.vec3("uHeatHi", heatHi[0], heatHi[1], heatHi[2])
        display.mat3("uSim", simMatrix)
        display.vec4("uViewport", vx.toFloat(), vy.toFloat(), vw.toFloat(), vh.toFloat())
        display.float("uStripePeriod", (18f * density).roundToInt().toFloat())
        display.float("uLineHalf", 3f * density)
        glDrawArrays(GL_TRIANGLES, 0, 3)
    }

    /**
     * Starts reading the score into one pixel-pack buffer and collects the
     * other one, started on a previous call, without stalling the pipeline.
     * Returns true when [scoreBytes] was refreshed.
     */
    fun readScoreAsync(): Boolean {
        val fbo = scoreFbo ?: return false
        glBindFramebuffer(GL_READ_FRAMEBUFFER, fbo.id)
        glReadBuffer(GL_COLOR_ATTACHMENT0)
        glBindBuffer(GL_PIXEL_PACK_BUFFER, pbos[pboIndex])
        glReadPixels(0, 0, mapWidth, mapHeight, GL_RGBA, GL_UNSIGNED_BYTE, 0)
        pboPending[pboIndex] = true
        pboIndex = 1 - pboIndex
        var refreshed = false
        if (pboPending[pboIndex]) {
            glBindBuffer(GL_PIXEL_PACK_BUFFER, pbos[pboIndex])
            val mapped = glMapBufferRange(GL_PIXEL_PACK_BUFFER, 0, pboSize, GL_MAP_READ_BIT) as ByteBuffer?
            if (mapped != null) {
                val n = mapWidth * mapHeight
                val out = scoreBytes?.takeIf { it.size == n } ?: ByteArray(n)
                for (i in 0 until n) out[i] = mapped.get(i * 4)
                glUnmapBuffer(GL_PIXEL_PACK_BUFFER)
                scoreBytes = out
                scoreBytesWidth = mapWidth
                refreshed = true
            }
            pboPending[pboIndex] = false
        }
        glBindBuffer(GL_PIXEL_PACK_BUFFER, 0)
        glBindFramebuffer(GL_READ_FRAMEBUFFER, 0)
        return refreshed
    }

    /** Score (0..1) at an upright frame pixel, from the last readback. */
    fun scoreAt(x: Int, y: Int): Float {
        val bytes = scoreBytes ?: return 0f
        val mx = (x / factor).coerceIn(0, scoreBytesWidth - 1)
        val my = (y / factor).coerceIn(0, bytes.size / scoreBytesWidth - 1)
        return (bytes[my * scoreBytesWidth + mx].toInt() and 0xFF) / 255f
    }

    /** Average color of the 5×5 upright pixels around ([x], [y]) (a tiny synchronous read). */
    fun probeColor(x: Int, y: Int): Int {
        val src = source ?: return 0
        glBindVertexArray(vao)
        pass(probe, probeFbo) {
            sampler("uSrc", 0, src.id)
            ivec4("uCrop", crop.left, crop.top, crop.width(), crop.height())
            int("uRotation", rotation)
            ivec2("uProbe", x, y)
            ivec2("uUprightSize", frameWidth, frameHeight)
        }
        val px = ByteBuffer.allocateDirect(4).order(ByteOrder.nativeOrder())
        glBindFramebuffer(GL_READ_FRAMEBUFFER, probeFbo.id)
        glReadPixels(0, 0, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, px)
        glBindFramebuffer(GL_READ_FRAMEBUFFER, 0)
        return Argb.pack(px.get(0).toInt() and 0xFF, px.get(1).toInt() and 0xFF, px.get(2).toInt() and 0xFF)
    }

    /** The current frame upright, long side [longSide] px, for freeze frame. */
    fun uprightBitmap(longSide: Int): Bitmap? {
        val src = source ?: return null
        val s = longSide.toFloat() / max(frameWidth, frameHeight)
        val w = (frameWidth * s).roundToInt()
        val h = (frameHeight * s).roundToInt()
        val target = GlFramebuffer(GlTexture(w, h, GL_RGBA8, GL_RGBA, GL_UNSIGNED_BYTE, GL_NEAREST))
        try {
            glBindVertexArray(vao)
            pass(upright, target) {
                sampler("uSrc", 0, src.id)
                vec4("uCrop", crop.left.toFloat(), crop.top.toFloat(), crop.width().toFloat(), crop.height().toFloat())
                int("uRotation", rotation)
                vec2("uSrcSize", src.width.toFloat(), src.height.toFloat())
                vec2("uTargetSize", w.toFloat(), h.toFloat())
            }
            val buffer = ByteBuffer.allocateDirect(w * h * 4).order(ByteOrder.nativeOrder())
            glBindFramebuffer(GL_READ_FRAMEBUFFER, target.id)
            glReadPixels(0, 0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, buffer)
            glBindFramebuffer(GL_READ_FRAMEBUFFER, 0)
            // Row 0 is the top of the upright frame; RGBA bytes match ARGB_8888's memory layout.
            return Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).apply { copyPixelsFromBuffer(buffer.rewind()) }
        } finally {
            target.release()
        }
    }

    private fun releaseMapTargets() {
        listOf(labFbo, blurFbo, edgesFbo, contrastFbo, scoreFbo).forEach { it?.release() }
        labFbo = null; blurFbo = null; edgesFbo = null; contrastFbo = null; scoreFbo = null
    }

    /** Frees GL objects; call on the GL thread while the context is current. */
    fun release() {
        releaseMapTargets()
        source?.release()
        source = null
        probeFbo.release()
        glDeleteBuffers(2, pbos, 0)
        glDeleteVertexArrays(1, intArrayOf(vao), 0)
    }

    companion object {
        /** Long side of the perception map on the GPU (vs. 160–480 px on the CPU path). */
        const val MAP_LONG_SIDE = 640

        /** Whether this context can render to half-float textures (needed by the map passes). */
        fun supportsFloatTargets(): Boolean {
            val ext = glGetString(GL_EXTENSIONS) ?: return false
            return "GL_EXT_color_buffer_half_float" in ext || "GL_EXT_color_buffer_float" in ext
        }

        private fun rgb(c: Int) = floatArrayOf(Argb.red(c) / 255f, Argb.green(c) / 255f, Argb.blue(c) / 255f)
    }
}
