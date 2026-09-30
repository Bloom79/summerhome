package dev.colorgap.colorcore

import kotlin.test.Test
import kotlin.test.assertEquals

class ColorSpacesTest {
    private fun assertLab(expected: Lab, actual: Lab, tol: Double = 0.01) {
        assertEquals(expected.l, actual.l, tol, "L* of $actual")
        assertEquals(expected.a, actual.a, tol, "a* of $actual")
        assertEquals(expected.b, actual.b, tol, "b* of $actual")
    }

    @Test
    fun `sRGB decode matches the IEC 61966-2-1 curve`() {
        assertEquals(0.0, Srgb.decode(0.0), 1e-12)
        assertEquals(1.0, Srgb.decode(1.0), 1e-12)
        assertEquals(0.214041, Srgb.decode(0.5), 1e-6)
        // Linear segment below the 0.04045 knee.
        assertEquals(0.04 / 12.92, Srgb.decode(0.04), 1e-12)
        assertEquals(0.215861, Srgb.channelToLinear(128), 1e-6)
    }

    @Test
    fun `every 8-bit value survives a linear round trip`() {
        for (v in 0..255) assertEquals(v, Srgb.linearToChannel(Srgb.channelToLinear(v)))
    }

    @Test
    fun `primaries and neutrals map to reference CIELAB values`() {
        // Reference values: Lindbloom calculator, sRGB / D65 / 2°.
        assertLab(Lab(100.0, 0.0, 0.0), CieLab.fromArgb(Argb.fromHex("#FFFFFF")), 1e-6)
        assertLab(Lab(0.0, 0.0, 0.0), CieLab.fromArgb(Argb.fromHex("#000000")), 1e-6)
        assertLab(Lab(53.5850, 0.0, 0.0), CieLab.fromArgb(Argb.fromHex("#808080")))
        assertLab(Lab(53.2408, 80.0925, 67.2032), CieLab.fromArgb(Argb.fromHex("#FF0000")), 0.02)
        assertLab(Lab(87.7347, -86.1827, 83.1793), CieLab.fromArgb(Argb.fromHex("#00FF00")), 0.02)
        assertLab(Lab(32.2970, 79.1875, -107.8602), CieLab.fromArgb(Argb.fromHex("#0000FF")), 0.02)
        assertLab(Lab(97.1393, -21.5537, 94.4780), CieLab.fromArgb(Argb.fromHex("#FFFF00")), 0.02)
    }

    @Test
    fun `hex helpers round trip`() {
        assertEquals("#8B4513", Argb.toHex(Argb.fromHex("#8b4513")))
        assertEquals(0xFF, Argb.alpha(Argb.fromHex("#000000")))
    }

    @Test
    fun `allocation-free Lab path agrees with the object path`() {
        val out = FloatArray(3)
        for (hex in listOf("#123456", "#FF8800", "#8B4513", "#556B2F", "#EEEEEE")) {
            val rgb = Srgb.toLinear(Argb.fromHex(hex))
            CieLab.linearToLab(rgb.r, rgb.g, rgb.b, out, 0)
            assertLab(CieLab.fromLinear(rgb), Lab(out[0].toDouble(), out[1].toDouble(), out[2].toDouble()), 1e-4)
        }
    }

    @Test
    fun `table-based Lab stays within 0_01 of the exact conversion`() {
        val out = FloatArray(3)
        for (r in 0..255 step 5) for (g in 0..255 step 5) for (b in 0..255 step 5) {
            val lr = Srgb.channelToLinear(r); val lg = Srgb.channelToLinear(g); val lb = Srgb.channelToLinear(b)
            CieLab.linearToLabFast(lr, lg, lb, out, 0)
            val exact = CieLab.fromLinear(LinearRgb(lr, lg, lb))
            assertEquals(exact.l, out[0].toDouble(), 0.01)
            assertEquals(exact.a, out[1].toDouble(), 0.01)
            assertEquals(exact.b, out[2].toDouble(), 0.01)
        }
    }
}
