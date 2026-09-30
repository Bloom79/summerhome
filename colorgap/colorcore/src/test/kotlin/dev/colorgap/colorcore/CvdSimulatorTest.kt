package dev.colorgap.colorcore

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CvdSimulatorTest {
    private fun simulatedDelta(type: CvdType, a: String, b: String, severity: Double = 1.0): Pair<Double, Double> {
        val sim = CvdSimulator(CvdProfile(type, severity))
        val ca = Argb.fromHex(a)
        val cb = Argb.fromHex(b)
        val original = DeltaE.ciede2000(CieLab.fromArgb(ca), CieLab.fromArgb(cb))
        val simulated = DeltaE.ciede2000(CieLab.fromArgb(sim.simulateArgb(ca)), CieLab.fromArgb(sim.simulateArgb(cb)))
        return original to simulated
    }

    @Test
    fun `every tabulated Machado matrix preserves achromatic colors`() {
        for (type in CvdType.entries) {
            MachadoMatrices.table(type).forEachIndexed { i, m ->
                assertEquals(11, MachadoMatrices.table(type).size)
                for (row in 0..2) {
                    assertEquals(1.0, m[3 * row] + m[3 * row + 1] + m[3 * row + 2], 2e-6, "$type[$i] row $row")
                }
            }
        }
    }

    @Test
    fun `grays are unchanged for every type and severity`() {
        for (type in CvdType.entries) for (s in listOf(0.0, 0.33, 0.7, 1.0)) {
            val sim = CvdSimulator(CvdProfile(type, s))
            for (v in listOf(0, 40, 128, 200, 255)) {
                val gray = Argb.pack(v, v, v)
                assertEquals(gray, sim.simulateArgb(gray), "$type $s gray $v")
            }
        }
    }

    @Test
    fun `severity zero is normal vision`() {
        for (type in CvdType.entries) {
            val sim = CvdSimulator(CvdProfile(type, 0.0))
            for (hex in listOf("#FF0000", "#00FF00", "#0000FF", "#8B4513", "#6B8E23")) {
                assertEquals(Argb.fromHex(hex), sim.simulateArgb(Argb.fromHex(hex)))
            }
        }
    }

    @Test
    fun `intermediate severities interpolate between tabulated matrices`() {
        val table = MachadoMatrices.table(CvdType.DEUTAN)
        val mid = MachadoMatrices.forProfile(CvdProfile(CvdType.DEUTAN, 0.55))
        for (k in 0 until 9) assertEquals((table[5][k] + table[6][k]) / 2, mid[k], 1e-12)
        assertContentEquals(table[10], MachadoMatrices.forProfile(CvdProfile(CvdType.DEUTAN, 1.0)))
        assertContentEquals(table[3], MachadoMatrices.forProfile(CvdProfile(CvdType.DEUTAN, 0.3)))
    }

    @Test
    fun `deutan confuses brown and olive green`() {
        for ((brown, olive) in listOf("#A0522D" to "#6B8E23", "#8B5A2B" to "#6E7B2B")) {
            val (orig, sim) = simulatedDelta(CvdType.DEUTAN, brown, olive)
            assertTrue(orig > 20, "$brown/$olive clearly different normally (ΔE $orig)")
            assertTrue(sim < 10 && sim < 0.25 * orig, "$brown/$olive nearly merged for deutan (ΔE $orig → $sim)")
        }
    }

    @Test
    fun `deutan confuses red and green of similar lightness, and pink with gray`() {
        val (rgOrig, rgSim) = simulatedDelta(CvdType.DEUTAN, "#E53935", "#43A047")
        assertTrue(rgOrig > 60 && rgSim < 8, "red/green ΔE $rgOrig → $rgSim")
        val (pgOrig, pgSim) = simulatedDelta(CvdType.DEUTAN, "#FF69B4", "#9E9E9E")
        assertTrue(pgOrig > 20 && pgSim < 6, "pink/gray ΔE $pgOrig → $pgSim")
    }

    @Test
    fun `protan also loses brown versus olive`() {
        val (orig, sim) = simulatedDelta(CvdType.PROTAN, "#A0522D", "#6B8E23")
        assertTrue(sim < 0.5 * orig, "ΔE $orig → $sim")
    }

    @Test
    fun `red-green deficiencies keep the blue-yellow axis`() {
        for (type in listOf(CvdType.PROTAN, CvdType.DEUTAN)) {
            val (orig, sim) = simulatedDelta(type, "#0000FF", "#FFFF00")
            assertTrue(sim > 0.8 * orig, "$type blue/yellow ΔE $orig → $sim")
        }
    }

    @Test
    fun `tritan confuses blue and teal but not brown and olive`() {
        val (btOrig, btSim) = simulatedDelta(CvdType.TRITAN, "#6495ED", "#20B2AA")
        assertTrue(btSim < 0.35 * btOrig, "blue/teal ΔE $btOrig → $btSim")
        val (boOrig, boSim) = simulatedDelta(CvdType.TRITAN, "#A0522D", "#6B8E23")
        assertTrue(boSim > 0.9 * boOrig, "brown/olive ΔE $boOrig → $boSim")
    }

    @Test
    fun `confusion grows monotonically with severity`() {
        var previous = Double.MAX_VALUE
        for (s in listOf(0.0, 0.25, 0.5, 0.75, 1.0)) {
            val (_, sim) = simulatedDelta(CvdType.DEUTAN, "#A0522D", "#6B8E23", s)
            assertTrue(sim < previous, "severity $s: ΔE $sim should be below $previous")
            previous = sim
        }
    }
}
