package dev.colorgap.app.ui

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ViewTransformTest {
    @Test
    fun `landscape image is letterboxed vertically in a portrait container`() {
        val fit = FitRect.of(1000f, 2000f, 400, 200)
        assertEquals(0f, fit.left)
        assertEquals(1000f, fit.width)
        assertEquals(500f, fit.height)
        assertEquals(750f, fit.top)
    }

    @Test
    fun `taps map to image pixels and outside taps are ignored`() {
        val fit = FitRect.of(1000f, 2000f, 400, 200)
        val zoom = Zoom()
        assertEquals(0 to 0, screenToImagePixel(0f, 750f, fit, zoom))
        assertEquals(200 to 100, screenToImagePixel(500f, 1000f, fit, zoom))
        assertEquals(399 to 199, screenToImagePixel(999.9f, 1249.9f, fit, zoom))
        assertNull(screenToImagePixel(500f, 100f, fit, zoom))
    }

    @Test
    fun `pinch keeps the point under the fingers fixed`() {
        val z = Zoom().transformed(300f, 900f, 0f, 0f, 2f, 1000f, 2000f)
        assertEquals(2f, z.scale)
        assertEquals(300f, z.screenToContentX(300f), 1e-3f)
        assertEquals(900f, z.screenToContentY(900f), 1e-3f)
    }

    @Test
    fun `tap after zoom hits the right pixel`() {
        val fit = FitRect.of(1000f, 2000f, 400, 200)
        // Zoom 2× around the image center: the center pixel stays under the screen center.
        val z = Zoom().transformed(500f, 1000f, 0f, 0f, 2f, 1000f, 2000f)
        assertEquals(200 to 100, screenToImagePixel(500f, 1000f, fit, z))
        // One image pixel is now 5 screen px wide (2.5 × 2).
        assertEquals(201 to 100, screenToImagePixel(505f, 1000f, fit, z))
    }

    @Test
    fun `zoom and pan are clamped`() {
        val tooFar = Zoom().transformed(0f, 0f, 5000f, 5000f, 20f, 1000f, 2000f)
        assertEquals(Zoom.MAX_SCALE, tooFar.scale)
        assertEquals(0f, tooFar.offsetX)
        assertEquals(0f, tooFar.offsetY)
        val out = Zoom().transformed(0f, 0f, 0f, 0f, 0.2f, 1000f, 2000f)
        assertEquals(Zoom(), out)
    }

    @Test
    fun `double tap zooms in then resets`() {
        val zin = Zoom().toggled(500f, 1000f, 1000f, 2000f)
        assertEquals(Zoom.DOUBLE_TAP_SCALE, zin.scale)
        assertEquals(Zoom(), zin.toggled(1f, 1f, 1000f, 2000f))
    }
}
