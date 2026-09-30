package dev.colorgap.colorcore

import java.nio.ByteBuffer
import kotlin.math.roundToInt

/**
 * Camera YUV_420_888 → sRGB, full-range BT.601 (JFIF), the encoding Android
 * cameras use for YUV_420_888. The GLSL twin is yuvToRgb in common.glsl.
 */
object Yuv {
    /** One YUV_420_888 plane: [buffer] indexed as `row * rowStride + col * pixelStride`. */
    class Plane(val buffer: ByteBuffer, val rowStride: Int, val pixelStride: Int)

    fun toArgb(y: Int, u: Int, v: Int): Int {
        val cb = u - 128f
        val cr = v - 128f
        return Argb.pack(
            channel(y + 1.402f * cr),
            channel(y - 0.344136f * cb - 0.714136f * cr),
            channel(y + 1.772f * cb),
        )
    }

    /** Inverse of [toArgb] (JFIF), used by tests and by tools that synthesize camera frames. */
    fun fromRgb(r: Int, g: Int, b: Int): Triple<Int, Int, Int> {
        val y = 0.299f * r + 0.587f * g + 0.114f * b
        val u = 128f - 0.168736f * r - 0.331264f * g + 0.5f * b
        val v = 128f + 0.5f * r - 0.418688f * g - 0.081312f * b
        return Triple(channel(y), channel(u), channel(v))
    }

    /** Converts a whole frame; chroma planes are subsampled 2×2. */
    fun toArgb(yPlane: Plane, uPlane: Plane, vPlane: Plane, width: Int, height: Int, out: IntArray) {
        require(out.size >= width * height) { "output too small" }
        Parallel.forRange(height) { yFrom, yUntil ->
            for (row in yFrom until yUntil) {
                val yRow = row * yPlane.rowStride
                val uRow = (row / 2) * uPlane.rowStride
                val vRow = (row / 2) * vPlane.rowStride
                for (col in 0 until width) {
                    val yv = yPlane.buffer.get(yRow + col * yPlane.pixelStride).toInt() and 0xFF
                    val uv = uPlane.buffer.get(uRow + (col / 2) * uPlane.pixelStride).toInt() and 0xFF
                    val vv = vPlane.buffer.get(vRow + (col / 2) * vPlane.pixelStride).toInt() and 0xFF
                    out[row * width + col] = toArgb(yv, uv, vv)
                }
            }
        }
    }

    private fun channel(v: Float) = v.roundToInt().coerceIn(0, 255)
}
