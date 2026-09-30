package dev.colorgap.colorcore

import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ConfusionTest {
    private val fernGreen = Argb.fromHex("#417056")

    @Test
    fun `confusion axis is an eigenvector the simulation almost cancels for red-green dichromats`() {
        // Machado's tritan matrix is not a true projection, so no direction vanishes for it.
        for (type in listOf(CvdType.PROTAN, CvdType.DEUTAN)) {
            val m = CvdSimulator(CvdProfile(type, 1.0)).matrix
            val v = Confusion.confusionAxis(m)
            assertEquals(1.0, v.sumOf { it * it }, 1e-9)
            val mv = DoubleArray(3) { r -> (0..2).sumOf { m[3 * r + it] * v[it] } }
            val shrink = kotlin.math.sqrt(mv.sumOf { it * it })
            assertTrue(shrink < 0.05, "$type: |Mv| = $shrink")
        }
    }

    @Test
    fun `fern green has a twin others see clearly and a deutan does not`() {
        val pair = assertNotNull(Confusion.twin(fernGreen, CvdProfile(CvdType.DEUTAN, 1.0)))
        assertTrue(pair.typicalDelta >= 8, "typical ΔE ${pair.typicalDelta}")
        assertTrue(pair.userDelta <= 1.0, "user ΔE ${pair.userDelta}") // a dichromat sees the same color
        // Independent check with the plain simulator.
        val sim = CvdSimulator(CvdProfile(CvdType.DEUTAN, 1.0))
        val seenA = CieLab.fromArgb(sim.simulateArgb(pair.color))
        val seenB = CieLab.fromArgb(sim.simulateArgb(pair.twin))
        assertTrue(DeltaE.ciede2000(seenA, seenB) <= 1.0)
    }

    @Test
    fun `anomalous trichromats get twins within the plate noise, mild ones none`() {
        val p70 = assertNotNull(Confusion.twin(fernGreen, CvdProfile(CvdType.DEUTAN, 0.7)))
        assertTrue(p70.userDelta <= 4.0 && p70.typicalDelta >= 8.0 && p70.typicalDelta >= 2.5 * p70.userDelta, "$p70")
        // At 30 % typical vision never sees much more than the user: nothing honest to show.
        assertNull(Confusion.twin(fernGreen, CvdProfile(CvdType.DEUTAN, 0.3)))
    }

    @Test
    fun `typical vision has no confusion twin`() {
        assertNull(Confusion.twin(fernGreen, CvdProfile(CvdType.DEUTAN, 0.0)))
    }

    @Test
    fun `milder anomalies have closer twins`() {
        val full = assertNotNull(Confusion.twin(fernGreen, CvdProfile(CvdType.DEUTAN, 1.0)))
        val mild = Confusion.twin(fernGreen, CvdProfile(CvdType.DEUTAN, 0.4))
        assertTrue(mild == null || mild.typicalDelta < full.typicalDelta, "mild ${mild?.typicalDelta} vs full ${full.typicalDelta}")
    }

    @Test
    fun `each deficiency has its own confusion direction`() {
        val gray = Argb.fromHex("#808080")
        val deutan = assertNotNull(Confusion.twin(gray, CvdProfile(CvdType.DEUTAN, 1.0)))
        val protan = assertNotNull(Confusion.twin(gray, CvdProfile(CvdType.PROTAN, 1.0)))
        assertTrue(DeltaE.ciede2000(CieLab.fromArgb(deutan.twin), CieLab.fromArgb(protan.twin)) > 3)
        // Tritan twins, when they exist, still respect the "indistinguishable to the user" bound.
        Confusion.twin(Argb.fromHex("#6495ED"), CvdProfile(CvdType.TRITAN, 1.0))?.let { assertTrue(it.userDelta <= 4.0) }
    }

    @Test
    fun `lch describes the fern green desaturation`() {
        val real = Lch.of(fernGreen)
        val seen = Lch.of(CvdSimulator(CvdProfile(CvdType.DEUTAN, 1.0)).simulateArgb(fernGreen))
        assertEquals(real.lightness, seen.lightness, 2.0)
        assertTrue(seen.chroma < real.chroma / 2, "chroma ${real.chroma} → ${seen.chroma}")
        assertEquals(10.0, Lch.hueDistance(355.0, 5.0), 1e-9)
    }

    @Test
    fun `plate hides the digit from the user but not from typical vision`() {
        val profile = CvdProfile(CvdType.DEUTAN, 1.0)
        val pair = assertNotNull(Confusion.twin(fernGreen, profile))
        val plate = Plate.generate(pair.color, pair.twin, digit = 7, size = 400, seed = 1)
        assertTrue(plate.figure.count { it } > 2000, "figure dots present")
        val simulated = CvdSimulator(profile).simulateInto(plate.pixels)
        fun meanLab(px: IntArray, fig: Boolean): Lab {
            var l = 0.0; var a = 0.0; var b = 0.0; var n = 0
            val cls = if (fig) Plate.FIGURE else Plate.BACKGROUND
            for (i in px.indices) {
                if (plate.classes[i] != cls) continue
                val lab = CieLab.fromArgb(px[i]); l += lab.l; a += lab.a; b += lab.b; n++
            }
            return Lab(l / n, a / n, b / n)
        }
        val typical = DeltaE.ciede2000(meanLab(plate.pixels, true), meanLab(plate.pixels, false))
        val user = DeltaE.ciede2000(meanLab(simulated, true), meanLab(simulated, false))
        assertTrue(typical > 6, "typical sees the digit: ΔE $typical")
        assertTrue(user < 1.5, "user does not: ΔE $user")
    }

    @Test
    fun `plates are reproducible and differ by seed and digit`() {
        val a = Plate.generate(fernGreen, Argb.fromHex("#8E7F67"), 3, 200, 42)
        val b = Plate.generate(fernGreen, Argb.fromHex("#8E7F67"), 3, 200, 42)
        val c = Plate.generate(fernGreen, Argb.fromHex("#8E7F67"), 3, 200, 43)
        val d = Plate.generate(fernGreen, Argb.fromHex("#8E7F67"), 8, 200, 42)
        assertTrue(a.pixels.contentEquals(b.pixels))
        assertTrue(!a.pixels.contentEquals(c.pixels))
        assertTrue(!a.figure.contentEquals(d.figure))
        assertTrue(abs(a.figure.count { it } - d.figure.count { it }) >= 0)
    }
}

class ShiftDirectionTest {
    private val deutan = CvdSimulator(CvdProfile())
    private fun dirs(hex: String) = Argb.fromHex(hex).let { ShiftDirection.of(it, deutan.simulateArgb(it)) }

    @Test
    fun `others see grass greener, sand pinker, a red redder`() {
        assertEquals(ShiftDirection.GREENER, dirs("#496417").first()) // hill grass
        assertEquals(ShiftDirection.GREENER, dirs("#778E48").first()) // foreground grass
        assertEquals(ShiftDirection.PINKER, dirs("#E6C7AB").first()) // sand bunker
        assertEquals(ShiftDirection.REDDER, dirs("#C0392B").first())
    }

    @Test
    fun `grays and unchanged colors have no direction`() {
        assertTrue(dirs("#808080").isEmpty())
        assertTrue(ShiftDirection.of(Argb.fromHex("#6495ED"), Argb.fromHex("#6495ED")).isEmpty())
    }
}
