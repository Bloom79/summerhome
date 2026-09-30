package dev.colorgap.app

import dev.colorgap.colorcore.AnalysisConfig
import dev.colorgap.colorcore.Argb
import dev.colorgap.colorcore.CvdProfile
import dev.colorgap.colorcore.CvdSimulator
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ColorProbeTest {
    private val deutan = CvdSimulator(CvdProfile())
    private val brown = Argb.fromHex("#9F5B13") // → olive for a deutan, ΔE 19
    private val cafeAuLait = Argb.fromHex("#8E7F67") // barely changes, ΔE 4.5

    @Test
    fun `the color verdict does not depend on the map or the display settings`() {
        for (config in listOf(AnalysisConfig(), AnalysisConfig(colorWeight = 0f))) {
            val p = ColorProbe.of(0, 0, brown, deutan, score = 0f, threshold = 0.35f, config = config)
            assertEquals(ColorProbe.ColorVerdict.DIFFERENT, p.colorVerdict)
            assertEquals(19f, p.colorShift, 1f)
            assertTrue(p.critical)
            assertFalse(p.edgeLost)
        }
        assertEquals(ColorProbe.ColorVerdict.SAME, ColorProbe.of(0, 0, cafeAuLait, deutan, 0f, 0.35f, AnalysisConfig()).colorVerdict)
    }

    @Test
    fun `an edge is lost where the map is critical but the color shift cannot explain it`() {
        assertTrue(ColorProbe.of(0, 0, cafeAuLait, deutan, score = 0.9f, threshold = 0.35f, config = AnalysisConfig()).edgeLost)
        // With colors highlighted, a critical score on a strongly shifted color is the color, not an edge.
        assertFalse(ColorProbe.of(0, 0, brown, deutan, score = 0.5f, threshold = 0.35f, config = AnalysisConfig()).edgeLost)
        // With edges only, any critical score is an edge.
        assertTrue(ColorProbe.of(0, 0, brown, deutan, score = 0.5f, threshold = 0.35f, config = AnalysisConfig(colorWeight = 0f)).edgeLost)
    }

    @Test
    fun `nothing is critical below the threshold on a stable color`() {
        val p = ColorProbe.of(0, 0, cafeAuLait, deutan, score = 0.1f, threshold = 0.35f, config = AnalysisConfig())
        assertFalse(p.critical)
    }
}
