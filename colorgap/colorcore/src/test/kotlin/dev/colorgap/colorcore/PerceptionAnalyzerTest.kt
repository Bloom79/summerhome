package dev.colorgap.colorcore

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PerceptionAnalyzerTest {
    private val w = 40
    private val h = 20

    /** Left half [left], right half [right]. */
    private fun halves(left: String, right: String): IntArray {
        val l = Argb.fromHex(left)
        val r = Argb.fromHex(right)
        return IntArray(w * h) { if (it % w < w / 2) l else r }
    }

    private fun analyze(img: IntArray, type: CvdType = CvdType.DEUTAN, severity: Double = 1.0) =
        PerceptionAnalyzer(CvdProfile(type, severity)).analyze(img, w, h)

    /** Max contrast loss along the vertical boundary vs. far from it. */
    private fun PerceptionMap.boundary(): Float = (0 until h).maxOf { contrastLoss[index(w / 2, it)] }
    private fun PerceptionMap.farFromBoundary(): Float =
        (0 until h).maxOf { maxOf(contrastLoss[index(2, it)], contrastLoss[index(w - 3, it)]) }

    @Test
    fun `edge between brown and olive is lost for deutan`() {
        val map = analyze(halves("#8B5A2B", "#6E7B2B"))
        assertTrue(map.boundary() > 0.8f, "boundary loss ${map.boundary()}")
        assertEquals(0f, map.farFromBoundary(), "no edge far from the boundary")
    }

    @Test
    fun `edge between red and green of equal lightness is lost for deutan`() {
        val map = analyze(halves("#E53935", "#43A047"))
        assertTrue(map.boundary() > 0.8f, "boundary loss ${map.boundary()}")
    }

    @Test
    fun `luminance edges are never flagged`() {
        for (type in CvdType.entries) {
            val map = analyze(halves("#000000", "#FFFFFF"), type)
            assertEquals(0f, map.contrastLoss.max(), "$type")
            assertEquals(0f, map.score.max(), "$type")
        }
    }

    @Test
    fun `blue-teal edge survives for deutan but is flagged for tritan`() {
        val deutan = analyze(halves("#6495ED", "#20B2AA"), CvdType.DEUTAN)
        val tritan = analyze(halves("#6495ED", "#20B2AA"), CvdType.TRITAN)
        assertTrue(deutan.boundary() < 0.2f, "deutan ${deutan.boundary()}")
        assertTrue(tritan.boundary() > 0.6f, "tritan ${tritan.boundary()}")
    }

    @Test
    fun `an edge that keeps enough lightness difference is not lost`() {
        // Pure red vs pure green: deutans lose the hue difference but keep a
        // large lightness step, so the boundary stays visible.
        val map = analyze(halves("#FF0000", "#00FF00"))
        assertTrue(map.boundary() < 0.1f, "boundary loss ${map.boundary()}")
        // …whereas each region still looks different from normal vision.
        assertTrue(map.colorLoss[map.index(2, 2)] > 0.9f)
    }

    @Test
    fun `normal vision produces an empty map`() {
        val map = analyze(halves("#8B5A2B", "#6E7B2B"), severity = 0.0)
        assertEquals(0f, map.score.max())
        assertEquals(0f, map.colorDelta.max())
    }

    @Test
    fun `uniform and gray images produce an empty map`() {
        assertEquals(0f, analyze(IntArray(w * h) { Argb.fromHex("#6E7B2B") }).contrastLoss.max())
        val grayRamp = IntArray(w * h) { val v = (it % w) * 6; Argb.pack(v, v, v) }
        assertEquals(0f, analyze(grayRamp).score.max())
    }

    @Test
    fun `mild anomaly flags less than dichromacy`() {
        val img = halves("#8B5A2B", "#6E7B2B")
        val mild = analyze(img, severity = 0.3)
        val full = analyze(img, severity = 1.0)
        assertTrue(mild.boundary() < full.boundary(), "mild ${mild.boundary()} vs full ${full.boundary()}")
        assertTrue(mild.colorDelta.max() < full.colorDelta.max())
    }

    @Test
    fun `score combines the two metrics and critical fraction honours the threshold`() {
        val map = analyze(halves("#8B5A2B", "#6E7B2B"))
        for (i in map.score.indices) {
            assertEquals(maxOf(map.contrastLoss[i], 0.6f * map.colorLoss[i]), map.score[i])
        }
        val band = map.criticalFraction(0.5f)
        assertTrue(band > 0f && band < 0.5f, "only a band around the boundary is critical: $band")
        assertEquals(0f, map.criticalFraction(1.01f))
    }

    @Test
    fun `simulated frame matches the per-pixel simulator`() {
        val img = halves("#A0522D", "#6495ED")
        val map = analyze(img, CvdType.PROTAN, 0.6)
        val sim = CvdSimulator(CvdProfile(CvdType.PROTAN, 0.6))
        for (i in img.indices) assertEquals(sim.simulateArgb(img[i]), map.simulated[i])
    }

    @Test
    fun `overlays touch only critical pixels`() {
        val img = halves("#8B5A2B", "#6E7B2B")
        val map = analyze(img)
        val t = 0.5f
        val heat = Overlays.heatmap(img, map, t, CvdType.DEUTAN)
        val stripes = Overlays.stripes(img, map, t)
        for (i in img.indices) if (map.score[i] < t) {
            assertEquals(img[i], heat[i])
            assertEquals(img[i], stripes[i])
        }
        assertTrue(img.indices.any { map.score[it] >= t && heat[it] != img[it] })
        val split = Overlays.split(img, map, 0.25f)
        assertEquals(img[map.index(2, 5)], split[map.index(2, 5)])
        assertEquals(map.simulated[map.index(w - 2, 5)], split[map.index(w - 2, 5)])
    }

    @Test
    fun `score upscaling preserves constants and interpolates between samples`() {
        val map = analyze(halves("#8B5A2B", "#6E7B2B"))
        val same = map.scoreResized(w, h)
        for (i in same.indices) assertEquals(map.score[i], same[i])
        val big = map.scoreResized(w * 3, h * 3)
        assertEquals(w * 3 * h * 3, big.size)
        assertEquals(map.score.max(), big.max(), 1e-5f)
        assertTrue(big.min() >= map.score.min() - 1e-5f)
        // The critical band stays around the (scaled) boundary.
        assertTrue(big[(h * 3 / 2) * w * 3 + w * 3 / 2] > 0.8f)
        assertEquals(map.score[map.index(1, 1)], big[3 * w * 3 + 3], 1e-5f)
    }
}
