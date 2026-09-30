package dev.colorgap.colorcore

import kotlin.test.Test
import kotlin.test.assertEquals

class ResampleTest {
    @Test
    fun `box downscale averages blocks and drops partial ones`() {
        // 5×4 image; factor 2 → 2×2, last column dropped.
        val src = IntArray(20) { i -> val x = i % 5; val y = i / 5; Argb.pack(x * 10, y * 20, 100) }
        val out = Resample.boxDownscale(src, 5, 4, 2)
        assertEquals(4, out.size)
        assertEquals(Argb.pack(5, 10, 100), out[0]) // x 0,1 → r 0,10; y 0,1 → g 0,20
        assertEquals(Argb.pack(25, 10, 100), out[1])
        assertEquals(Argb.pack(5, 50, 100), out[2])
    }

    @Test
    fun `factor one is a copy and uniform images stay uniform`() {
        val src = IntArray(12) { Argb.fromHex("#6E7B2B") }
        assertEquals(src.toList(), Resample.boxDownscale(src, 4, 3, 1).toList())
        assertEquals(List(1) { Argb.fromHex("#6E7B2B") }, Resample.boxDownscale(src, 4, 3, 3).toList())
    }

    @Test
    fun `checkerboard averages to gray instead of aliasing`() {
        val src = IntArray(64 * 64) { i -> if ((i % 64 + i / 64) % 2 == 0) -1 else Argb.pack(0, 0, 0) }
        val out = Resample.boxDownscale(src, 64, 64, 4)
        for (c in out) assertEquals(Argb.pack(128, 128, 128), c)
    }
}
