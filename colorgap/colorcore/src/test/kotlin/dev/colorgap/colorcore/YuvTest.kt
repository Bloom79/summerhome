package dev.colorgap.colorcore

import java.nio.ByteBuffer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class YuvTest {
    @Test
    fun `neutral chroma gives grays`() {
        for (y in 0..255 step 15) assertEquals(Argb.pack(y, y, y), Yuv.toArgb(y, 128, 128))
    }

    @Test
    fun `known JFIF values decode to the expected colors`() {
        // Y, Cb, Cr of pure red / green / blue in full-range BT.601.
        assertClose(Argb.pack(255, 0, 0), Yuv.toArgb(76, 85, 255))
        assertClose(Argb.pack(0, 255, 0), Yuv.toArgb(150, 44, 21))
        assertClose(Argb.pack(0, 0, 255), Yuv.toArgb(29, 255, 107))
    }

    @Test
    fun `rgb survives a round trip through YUV within two levels`() {
        for (r in 0..255 step 17) for (g in 0..255 step 17) for (b in 0..255 step 17) {
            val (y, u, v) = Yuv.fromRgb(r, g, b)
            assertClose(Argb.pack(r, g, b), Yuv.toArgb(y, u, v))
        }
    }

    @Test
    fun `frame conversion honours strides and 2x2 chroma subsampling`() {
        val w = 4
        val h = 2
        // Y plane with row padding; interleaved chroma (pixel stride 2) like NV12.
        val yBuf = ByteBuffer.wrap(byteArrayOf(10, 20, 30, 40, 0, 0, 50, 60, 70, 80, 0, 0).map { it }.toByteArray())
        val uv = ByteBuffer.wrap(byteArrayOf(100, 0, (200).toByte(), 0))
        val vv = ByteBuffer.wrap(byteArrayOf((150).toByte(), 0, 128.toByte(), 0))
        val out = IntArray(w * h)
        Yuv.toArgb(Yuv.Plane(yBuf, 6, 1), Yuv.Plane(uv, 4, 2), Yuv.Plane(vv, 4, 2), w, h, out)
        assertEquals(Yuv.toArgb(10, 100, 150), out[0])
        assertEquals(Yuv.toArgb(20, 100, 150), out[1])
        assertEquals(Yuv.toArgb(30, 200, 128), out[2])
        assertEquals(Yuv.toArgb(80, 200, 128), out[7])
    }

    private fun assertClose(expected: Int, actual: Int) {
        for (shift in intArrayOf(0, 8, 16)) {
            val d = ((expected shr shift) and 0xFF) - ((actual shr shift) and 0xFF)
            assertTrue(d in -2..2, "expected ${Argb.toHex(expected)}, got ${Argb.toHex(actual)}")
        }
    }
}
