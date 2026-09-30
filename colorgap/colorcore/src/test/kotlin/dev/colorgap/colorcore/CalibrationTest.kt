package dev.colorgap.colorcore

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * Runs the calibration test against virtual observers: an observer with a
 * known profile reads a plate when figure and background look at least
 * [READ_DELTA] ΔE2000 apart to them (above the plate's lightness noise).
 */
class CalibrationTest {
    private fun run(observer: CvdProfile, seed: Long, answer: (PlateSpec) -> Int? = { readAs(observer, it) }): Pair<CalibrationResult, Int> {
        val session = CalibrationSession(seed)
        var plates = 0
        while (session.current != null) {
            session.answer(answer(session.current!!))
            plates++
            check(plates < 60) { "test does not terminate" }
        }
        return session.result!! to plates
    }

    private fun readAs(observer: CvdProfile, plate: PlateSpec): Int? =
        if (CalibrationSession.perceivedContrast(plate, observer) >= READ_DELTA) plate.digit else null

    @Test
    fun `typical vision reads every plate`() {
        for (seed in 1L..5L) {
            val (result, plates) = run(CvdProfile(CvdType.DEUTAN, 0.0), seed)
            assertEquals(CalibrationResult.Typical, result, "seed $seed")
            assertTrue(plates <= 10, "short test for typical vision: $plates plates")
        }
    }

    @Test
    fun `red-green observers get their type and severity back`() {
        for (type in listOf(CvdType.DEUTAN, CvdType.PROTAN)) {
            for (severity in listOf(1.0, 0.8, 0.6, 0.5)) {
                for (seed in 1L..4L) {
                    val (result, plates) = run(CvdProfile(type, severity), seed)
                    val estimate = assertIs<CalibrationResult.Profile>(result, "$type $severity seed $seed")
                    val profile = estimate.profile
                    // Dichromats always get their type; otherwise a type declared certain must be right
                    // (mild protans and deutans can be indistinguishable with plates, and then it says so).
                    if (severity == 1.0) assertEquals(type, profile.type, "$type $severity seed $seed")
                    if (estimate.typeCertain) assertEquals(type, profile.type, "$type $severity seed $seed (declared certain)")
                    // Deutans (3 in 4 cases) within 10 %; protans within 20 %: below ~90 % plates
                    // can't separate them from deutans, and the estimate leans toward the deutan fit.
                    val tolerance = if (type == CvdType.DEUTAN) 0.1 else 0.2
                    assertTrue(
                        kotlin.math.abs(profile.severity - severity) <= tolerance + 1e-9,
                        "$type ${(severity * 100).toInt()}% estimated ${(profile.severity * 100).toInt()}% (seed $seed)",
                    )
                    assertTrue(plates <= 25, "$plates plates")
                }
            }
        }
    }

    @Test
    fun `a milder anomaly is estimated milder than a dichromacy`() {
        val mild = assertIs<CalibrationResult.Profile>(run(CvdProfile(CvdType.DEUTAN, 0.6), 7).first).profile.severity
        val full = assertIs<CalibrationResult.Profile>(run(CvdProfile(CvdType.DEUTAN, 1.0), 7).first).profile.severity
        assertTrue(mild < full, "mild $mild vs full $full")
    }

    @Test
    fun `anomalies milder than the test floor come out as typical`() {
        assertEquals(CalibrationResult.Typical, run(CvdProfile(CvdType.DEUTAN, 0.2), 5).first)
    }

    @Test
    fun `answering no number to everything is flagged as unreliable`() {
        val (result, _) = run(CvdProfile(), 3) { null }
        assertEquals(CalibrationResult.Unreliable, result)
    }

    @Test
    fun `a typical eye that misses one plate by accident still comes out mild`() {
        var missed = false
        val (result, _) = run(CvdProfile(CvdType.DEUTAN, 0.0), 2) { plate ->
            if (!missed && plate.target != null) { missed = true; null } else plate.digit
        }
        when (result) {
            is CalibrationResult.Profile -> assertTrue(result.profile.severity <= 0.45, "estimated ${result.profile}")
            else -> Unit // Typical is fine too
        }
    }

    @Test
    fun `a session is reproducible from its seed`() {
        val observer = CvdProfile(CvdType.PROTAN, 0.8)
        val a = run(observer, 5)
        repeat(3) { assertEquals(a, run(observer, 5)) }
    }

    @Test
    fun `plates offer four options including the right digit`() {
        val s = CalibrationSession(11)
        val p = s.current!!
        assertEquals(4, p.options.size)
        assertEquals(4, p.options.toSet().size)
        assertTrue(p.digit in p.options)
    }

    companion object {
        val READ_DELTA = CalibrationSession.READ_DELTA
    }
}
