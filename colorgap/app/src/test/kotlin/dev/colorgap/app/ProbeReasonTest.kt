package dev.colorgap.app

import dev.colorgap.colorcore.AnalysisConfig
import dev.colorgap.colorcore.Argb
import dev.colorgap.colorcore.CvdProfile
import dev.colorgap.colorcore.CvdSimulator
import kotlin.test.Test
import kotlin.test.assertEquals

class ProbeReasonTest {
    private val deutan = CvdSimulator(CvdProfile())
    private val fernGreen = Argb.fromHex("#417056")
    private val cafeAuLait = Argb.fromHex("#8E7F67")

    @Test
    fun `below the threshold the spot is seen like everyone else`() {
        assertEquals(ProbeReason.NONE, ColorProbe.of(0, 0, fernGreen, deutan, score = 0.2f, threshold = 0.35f, config = AnalysisConfig()).reason)
    }

    @Test
    fun `a strongly shifted color is flagged for its color`() {
        // Fern green → dark gray: ΔE 18, color part 0.45 ≥ 0.35.
        assertEquals(ProbeReason.COLOR, ColorProbe.of(0, 0, fernGreen, deutan, score = 0.45f, threshold = 0.35f, config = AnalysisConfig()).reason)
    }

    @Test
    fun `a critical spot whose color barely shifts is a lost edge`() {
        assertEquals(ProbeReason.EDGE, ColorProbe.of(0, 0, cafeAuLait, deutan, score = 0.9f, threshold = 0.35f, config = AnalysisConfig()).reason)
        // With color shifts not highlighted, any critical spot is an edge.
        assertEquals(ProbeReason.EDGE, ColorProbe.of(0, 0, fernGreen, deutan, score = 0.9f, threshold = 0.35f, config = AnalysisConfig(colorWeight = 0f)).reason)
    }
}
