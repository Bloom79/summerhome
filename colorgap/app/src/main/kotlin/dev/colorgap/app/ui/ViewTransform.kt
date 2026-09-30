package dev.colorgap.app.ui

import kotlin.math.floor
import kotlin.math.min

/** Where an image of [imageWidth]×[imageHeight] lands when fitted (letterboxed) in a container. */
data class FitRect(val left: Float, val top: Float, val width: Float, val height: Float, val imageWidth: Int, val imageHeight: Int) {
    val right get() = left + width
    val bottom get() = top + height

    companion object {
        fun of(containerWidth: Float, containerHeight: Float, imageWidth: Int, imageHeight: Int): FitRect {
            val s = min(containerWidth / imageWidth, containerHeight / imageHeight)
            val w = imageWidth * s
            val h = imageHeight * s
            return FitRect((containerWidth - w) / 2f, (containerHeight - h) / 2f, w, h, imageWidth, imageHeight)
        }
    }
}

/**
 * Pan/zoom state: screen = offset + scale × content, where content coordinates
 * are those of the un-zoomed container.
 */
data class Zoom(val scale: Float = 1f, val offsetX: Float = 0f, val offsetY: Float = 0f) {

    /** Applies a pinch/pan gesture, keeping the content under [centroidX],[centroidY] fixed. */
    fun transformed(
        centroidX: Float, centroidY: Float,
        panX: Float, panY: Float,
        zoomChange: Float,
        containerWidth: Float, containerHeight: Float,
    ): Zoom {
        val newScale = (scale * zoomChange).coerceIn(MIN_SCALE, MAX_SCALE)
        val z = newScale / scale
        val ox = centroidX - (centroidX - offsetX) * z + panX
        val oy = centroidY - (centroidY - offsetY) * z + panY
        return Zoom(newScale, ox, oy).clamped(containerWidth, containerHeight)
    }

    /** Toggle used by double tap: zoom in around the point, or reset. */
    fun toggled(atX: Float, atY: Float, containerWidth: Float, containerHeight: Float): Zoom =
        if (scale > 1.01f) Zoom() else transformed(atX, atY, 0f, 0f, DOUBLE_TAP_SCALE, containerWidth, containerHeight)

    /** Keeps the zoomed content covering the container (no empty borders beyond the letterbox). */
    fun clamped(containerWidth: Float, containerHeight: Float): Zoom = copy(
        offsetX = offsetX.coerceIn(containerWidth * (1 - scale), 0f),
        offsetY = offsetY.coerceIn(containerHeight * (1 - scale), 0f),
    )

    fun screenToContentX(x: Float) = (x - offsetX) / scale
    fun screenToContentY(y: Float) = (y - offsetY) / scale

    companion object {
        const val MIN_SCALE = 1f
        const val MAX_SCALE = 10f
        const val DOUBLE_TAP_SCALE = 3f
    }
}

/** Screen point → image pixel, or null when the point falls outside the image. */
fun screenToImagePixel(x: Float, y: Float, fit: FitRect, zoom: Zoom): Pair<Int, Int>? {
    val cx = zoom.screenToContentX(x)
    val cy = zoom.screenToContentY(y)
    if (cx < fit.left || cx >= fit.right || cy < fit.top || cy >= fit.bottom) return null
    val ix = floor((cx - fit.left) / fit.width * fit.imageWidth).toInt().coerceIn(0, fit.imageWidth - 1)
    val iy = floor((cy - fit.top) / fit.height * fit.imageHeight).toInt().coerceIn(0, fit.imageHeight - 1)
    return ix to iy
}
