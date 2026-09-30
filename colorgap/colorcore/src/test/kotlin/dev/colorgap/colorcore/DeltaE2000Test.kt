package dev.colorgap.colorcore

import kotlin.test.Test
import kotlin.test.assertEquals

/** Supplementary test data of Sharma, Wu & Dalal (2005), Table 1. */
class DeltaE2000Test {
    // L1, a1, b1, L2, a2, b2, ΔE00
    private val sharma = arrayOf(
        doubleArrayOf(50.0000, 2.6772, -79.7751, 50.0000, 0.0000, -82.7485, 2.0425),
        doubleArrayOf(50.0000, 3.1571, -77.2803, 50.0000, 0.0000, -82.7485, 2.8615),
        doubleArrayOf(50.0000, 2.8361, -74.0200, 50.0000, 0.0000, -82.7485, 3.4412),
        doubleArrayOf(50.0000, -1.3802, -84.2814, 50.0000, 0.0000, -82.7485, 1.0000),
        doubleArrayOf(50.0000, -1.1848, -84.8006, 50.0000, 0.0000, -82.7485, 1.0000),
        doubleArrayOf(50.0000, -0.9009, -85.5211, 50.0000, 0.0000, -82.7485, 1.0000),
        doubleArrayOf(50.0000, 0.0000, 0.0000, 50.0000, -1.0000, 2.0000, 2.3669),
        doubleArrayOf(50.0000, -1.0000, 2.0000, 50.0000, 0.0000, 0.0000, 2.3669),
        doubleArrayOf(50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0009, 7.1792),
        doubleArrayOf(50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0010, 7.1792),
        doubleArrayOf(50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0011, 7.2195),
        doubleArrayOf(50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0012, 7.2195),
        doubleArrayOf(50.0000, -0.0010, 2.4900, 50.0000, 0.0009, -2.4900, 4.8045),
        doubleArrayOf(50.0000, -0.0010, 2.4900, 50.0000, 0.0010, -2.4900, 4.8045),
        doubleArrayOf(50.0000, -0.0010, 2.4900, 50.0000, 0.0011, -2.4900, 4.7461),
        doubleArrayOf(50.0000, 2.5000, 0.0000, 50.0000, 0.0000, -2.5000, 4.3065),
        doubleArrayOf(50.0000, 2.5000, 0.0000, 73.0000, 25.0000, -18.0000, 27.1492),
        doubleArrayOf(50.0000, 2.5000, 0.0000, 61.0000, -5.0000, 29.0000, 22.8977),
        doubleArrayOf(50.0000, 2.5000, 0.0000, 56.0000, -27.0000, -3.0000, 31.9030),
        doubleArrayOf(50.0000, 2.5000, 0.0000, 58.0000, 24.0000, 15.0000, 19.4535),
        doubleArrayOf(50.0000, 2.5000, 0.0000, 50.0000, 3.1736, 0.5854, 1.0000),
        doubleArrayOf(50.0000, 2.5000, 0.0000, 50.0000, 3.2972, 0.0000, 1.0000),
        doubleArrayOf(50.0000, 2.5000, 0.0000, 50.0000, 1.8634, 0.5757, 1.0000),
        doubleArrayOf(50.0000, 2.5000, 0.0000, 50.0000, 3.2592, 0.3350, 1.0000),
        doubleArrayOf(60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644),
        doubleArrayOf(63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.2630),
        doubleArrayOf(61.2901, 3.7196, -5.3901, 61.4292, 2.2480, -4.9620, 1.8731),
        doubleArrayOf(35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645),
        doubleArrayOf(22.7233, 20.0904, -46.6940, 23.0331, 14.9730, -42.5619, 2.0373),
        doubleArrayOf(36.4612, 47.8580, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146),
        doubleArrayOf(90.8027, -2.0831, 1.4410, 91.1528, -1.6435, 0.0447, 1.4441),
        doubleArrayOf(90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381),
        doubleArrayOf(6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377),
        doubleArrayOf(2.0776, 0.0795, -1.1350, 0.9033, -0.0636, -0.5514, 0.9082),
    )

    @Test
    fun `matches all 34 Sharma reference pairs to 4 decimals`() {
        sharma.forEachIndexed { i, r ->
            val d = DeltaE.ciede2000(r[0], r[1], r[2], r[3], r[4], r[5])
            assertEquals(r[6], d, 5e-5, "pair ${i + 1}")
        }
    }

    @Test
    fun `is symmetric`() {
        for (r in sharma) {
            val ab = DeltaE.ciede2000(r[0], r[1], r[2], r[3], r[4], r[5])
            val ba = DeltaE.ciede2000(r[3], r[4], r[5], r[0], r[1], r[2])
            assertEquals(ab, ba, 1e-9)
        }
    }

    @Test
    fun `identical colors have zero difference`() {
        assertEquals(0.0, DeltaE.ciede2000(Lab(40.0, 30.0, -20.0), Lab(40.0, 30.0, -20.0)), 0.0)
        assertEquals(0.0, DeltaE.ciede2000(Lab(0.0, 0.0, 0.0), Lab(0.0, 0.0, 0.0)), 0.0)
    }

    @Test
    fun `fast form matches the reference on Sharma pairs`() {
        sharma.forEachIndexed { i, r ->
            val d = DeltaE.ciede2000Fast(r[0], r[1], r[2], r[3], r[4], r[5])
            assertEquals(r[6], d, 5e-5, "pair ${i + 1}")
        }
    }

    @Test
    fun `fast form matches the reference on random and edge-case pairs`() {
        val rnd = java.util.Random(42)
        fun lab() = doubleArrayOf(rnd.nextDouble() * 100, rnd.nextDouble() * 200 - 100, rnd.nextDouble() * 200 - 100)
        fun near(x: DoubleArray, s: Double) = doubleArrayOf(x[0] + rnd.nextGaussian() * s, x[1] + rnd.nextGaussian() * s, x[2] + rnd.nextGaussian() * s)
        val pairs = ArrayList<Pair<DoubleArray, DoubleArray>>()
        repeat(50_000) { val a = lab(); pairs += a to lab() }
        repeat(50_000) { val a = lab(); pairs += a to near(a, 3.0) }
        // Achromatic, one-achromatic, opposite hues, same hue.
        pairs += doubleArrayOf(50.0, 0.0, 0.0) to doubleArrayOf(60.0, 0.0, 0.0)
        pairs += doubleArrayOf(50.0, 0.0, 0.0) to doubleArrayOf(50.0, 10.0, -20.0)
        pairs += doubleArrayOf(50.0, 10.0, -20.0) to doubleArrayOf(50.0, 0.0, 0.0)
        pairs += doubleArrayOf(50.0, 10.0, 0.0) to doubleArrayOf(50.0, -10.0, 0.0)
        pairs += doubleArrayOf(50.0, 0.0, 30.0) to doubleArrayOf(50.0, 0.0, -30.0)
        pairs += doubleArrayOf(40.0, 5.0, 5.0) to doubleArrayOf(70.0, 10.0, 10.0)
        for ((a, b) in pairs) {
            val ref = DeltaE.ciede2000(a[0], a[1], a[2], b[0], b[1], b[2])
            val fast = DeltaE.ciede2000Fast(a[0], a[1], a[2], b[0], b[1], b[2])
            assertEquals(ref, fast, 1e-5, "${a.toList()} vs ${b.toList()}")
        }
    }
}
