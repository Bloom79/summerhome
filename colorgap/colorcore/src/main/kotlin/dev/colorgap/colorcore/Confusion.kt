package dev.colorgap.colorcore

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** A color and its "confusion twin": clearly different to typical vision, (almost) the same to the user. */
data class ConfusionPair(
    val color: Int,
    val twin: Int,
    /** ΔE2000 between the two for typical vision. */
    val typicalDelta: Double,
    /** ΔE2000 between the two as the user sees them. */
    val userDelta: Double,
)

/**
 * Finds confusion colors for a profile.
 *
 * The simulation matrix M squeezes linear RGB most along the eigenvector of
 * MᵀM with the smallest eigenvalue (for a dichromat it is the "confusion
 * line" direction, which M maps to almost nothing). Moving a color along it,
 * within the sRGB gamut, changes it a lot for typical vision and little or
 * nothing for the user: the principle of pseudo-isochromatic plates.
 */
object Confusion {
    /**
     * The twin of [argb] that looks most different to typical vision while
     * staying within [maxUserDelta] ΔE2000 for the user, or null when no twin
     * differs by at least [minTypicalDelta] and [minRatio] times more for
     * typical vision than for the user (then the user tells them apart too:
     * e.g. mild anomalies, or colors near the gamut edge).
     *
     * With [visibleTo], the pair must also stay clearly different for that
     * other profile: plates that tell e.g. protans from deutans.
     *
     * The default user bound, 4, is below what the lightness noise of a plate
     * (dots vary by ±10–20 % in luminance) lets anyone read.
     */
    fun twin(
        argb: Int,
        profile: CvdProfile,
        maxUserDelta: Double = 4.0,
        minTypicalDelta: Double = 8.0,
        minRatio: Double = 2.5,
        /** Optionally, another profile that must still see the pair at least [visibleDelta] apart. */
        visibleTo: CvdProfile? = null,
        visibleDelta: Double = 10.0,
    ): ConfusionPair? {
        val sim = CvdSimulator(profile)
        val other = visibleTo?.let(::CvdSimulator)
        val otherSeen = other?.let { CieLab.fromArgb(it.simulateArgb(argb)) }
        val v = confusionAxis(sim.matrix)
        val base = Srgb.toLinear(argb)
        val c = doubleArrayOf(base.r, base.g, base.b)
        val lab = CieLab.fromArgb(argb)
        val seen = CieLab.fromArgb(sim.simulateArgb(argb))
        var best: ConfusionPair? = null
        for (sign in doubleArrayOf(1.0, -1.0)) {
            val dir = DoubleArray(3) { sign * v[it] }
            // Longest step that stays inside the RGB cube.
            var tMax = Double.MAX_VALUE
            for (k in 0..2) {
                if (dir[k] > 1e-9) tMax = min(tMax, (1.0 - c[k]) / dir[k])
                if (dir[k] < -1e-9) tMax = min(tMax, -c[k] / dir[k])
            }
            if (tMax <= 0.0 || tMax == Double.MAX_VALUE) continue
            // ΔE2000 is not monotonic along the line: scan it instead of bisecting.
            // Stop short of the gamut edge, so the twin is not a clipped extreme.
            for (step in 1..SCAN_STEPS) {
                val t = 0.95 * tMax * step / SCAN_STEPS
                val twin = Srgb.fromLinear(LinearRgb(c[0] + t * dir[0], c[1] + t * dir[1], c[2] + t * dir[2]))
                val user = DeltaE.ciede2000(seen, CieLab.fromArgb(sim.simulateArgb(twin)))
                if (user > maxUserDelta) continue
                val typical = DeltaE.ciede2000(lab, CieLab.fromArgb(twin))
                if (typical < minTypicalDelta || typical < minRatio * user) continue
                if (other != null && DeltaE.ciede2000(otherSeen!!, CieLab.fromArgb(other.simulateArgb(twin))) < visibleDelta) continue
                if (best == null || typical > best.typicalDelta) best = ConfusionPair(argb, twin, typical, user)
            }
        }
        return best
    }

    private const val SCAN_STEPS = 120

    /** Unit eigenvector of MᵀM with the smallest eigenvalue (Jacobi method on the symmetric 3×3). */
    fun confusionAxis(m: DoubleArray): DoubleArray {
        val a = Array(3) { i -> DoubleArray(3) { j -> (0..2).sumOf { k -> m[3 * k + i] * m[3 * k + j] } } }
        val vecs = Array(3) { i -> DoubleArray(3) { j -> if (i == j) 1.0 else 0.0 } }
        repeat(50) {
            var p = 0
            var q = 1
            for ((i, j) in listOf(0 to 1, 0 to 2, 1 to 2)) if (abs(a[i][j]) > abs(a[p][q])) { p = i; q = j }
            if (abs(a[p][q]) < 1e-15) return@repeat
            val theta = 0.5 * atan2(2 * a[p][q], a[q][q] - a[p][p])
            val cs = kotlin.math.cos(theta)
            val sn = kotlin.math.sin(theta)
            for (k in 0..2) { // A ← Jᵀ A J
                val akp = a[k][p]; val akq = a[k][q]
                a[k][p] = cs * akp - sn * akq; a[k][q] = sn * akp + cs * akq
            }
            for (k in 0..2) {
                val apk = a[p][k]; val aqk = a[q][k]
                a[p][k] = cs * apk - sn * aqk; a[q][k] = sn * apk + cs * aqk
            }
            for (k in 0..2) { // V ← V J (columns are eigenvectors)
                val vkp = vecs[k][p]; val vkq = vecs[k][q]
                vecs[k][p] = cs * vkp - sn * vkq; vecs[k][q] = sn * vkp + cs * vkq
            }
        }
        val smallest = (0..2).minBy { a[it][it] }
        val v = DoubleArray(3) { vecs[it][smallest] }
        val n = sqrt(v.sumOf { it * it })
        return DoubleArray(3) { v[it] / n }
    }
}

/** Lightness, chroma (colorfulness) and hue of a color: what changes between real and perceived. */
data class Lch(val lightness: Double, val chroma: Double, val hue: Double) {
    companion object {
        fun of(argb: Int): Lch {
            val lab = CieLab.fromArgb(argb)
            val h = Math.toDegrees(atan2(lab.b, lab.a))
            return Lch(lab.l, hypot(lab.a, lab.b), if (h < 0) h + 360 else h)
        }

        /** Smallest angle between two hues, 0..180. */
        fun hueDistance(a: Double, b: Double): Double {
            val d = abs(a - b) % 360
            return if (d > 180) 360 - d else d
        }
    }
}

/**
 * Ishihara-style pseudo-isochromatic plates: a disc of dots, the ones inside
 * a digit in the figure color, the others in the background color. Every dot
 * gets a random lightness from the same set for both classes, so brightness
 * gives the digit away to nobody: only the color difference can.
 */
object Plate {
    class Image(val size: Int, val pixels: IntArray, /** Per pixel: [PAPER_OR_EDGE], [FIGURE] or [BACKGROUND] (dot cores only). */ val classes: ByteArray) {
        val figure: BooleanArray get() = BooleanArray(classes.size) { classes[it] == FIGURE }
    }

    const val PAPER_OR_EDGE: Byte = 0
    const val FIGURE: Byte = 1
    const val BACKGROUND: Byte = 2

    /** 5×7 glyphs of digits 2–9 (shapes that are not confused with each other). */
    private val GLYPHS = mapOf(
        2 to listOf("01110", "10001", "00001", "00010", "00100", "01000", "11111"),
        3 to listOf("11110", "00001", "00001", "01110", "00001", "00001", "11110"),
        4 to listOf("00010", "00110", "01010", "10010", "11111", "00010", "00010"),
        5 to listOf("11111", "10000", "11110", "00001", "00001", "10001", "01110"),
        6 to listOf("00110", "01000", "10000", "11110", "10001", "10001", "01110"),
        7 to listOf("11111", "00001", "00010", "00100", "01000", "01000", "01000"),
        8 to listOf("01110", "10001", "10001", "01110", "10001", "10001", "01110"),
        9 to listOf("01110", "10001", "10001", "01111", "00001", "00010", "01100"),
    )
    val DIGITS: List<Int> = GLYPHS.keys.sorted()
    private val LIGHTNESS = doubleArrayOf(0.8, 0.9, 1.0, 1.1)
    private val PAPER = Argb.pack(240, 236, 226)

    fun generate(figure: Int, background: Int, digit: Int, size: Int, seed: Long): Image {
        val glyph = GLYPHS[digit] ?: error("digit must be one of $DIGITS")
        val rnd = java.util.Random(seed)
        val pixels = IntArray(size * size) { PAPER }
        val classes = ByteArray(size * size)
        val center = size / 2.0
        val disc = size * 0.47
        // The digit occupies the middle of the disc.
        val gw = size * 0.46
        val gh = size * 0.64
        val gx = center - gw / 2
        val gy = center - gh / 2
        fun inGlyph(x: Double, y: Double): Boolean {
            val col = ((x - gx) / gw * 5).toInt()
            val row = ((y - gy) / gh * 7).toInt()
            return x >= gx && y >= gy && col in 0..4 && row in 0..6 && glyph[row][col] == '1'
        }

        // Random non-overlapping dots (rejection sampling on a coarse grid).
        val rMin = size * 0.010
        val rMax = size * 0.026
        val cell = 2 * rMax
        val cols = (size / cell).toInt() + 1
        val grid = Array(cols * cols) { ArrayList<DoubleArray>(4) }
        repeat(60 * size) {
            val r = rMin + (rMax - rMin) * rnd.nextDouble().let { it * it } // more small dots than big ones
            val x = center + (rnd.nextDouble() * 2 - 1) * disc
            val y = center + (rnd.nextDouble() * 2 - 1) * disc
            if (hypot(x - center, y - center) + r > disc) return@repeat
            val cx = (x / cell).toInt()
            val cy = (y / cell).toInt()
            for (gy2 in max(0, cy - 1)..min(cols - 1, cy + 1)) for (gx2 in max(0, cx - 1)..min(cols - 1, cx + 1)) {
                for (d in grid[gy2 * cols + gx2]) if (hypot(d[0] - x, d[1] - y) < d[2] + r + size * 0.003) return@repeat
            }
            grid[cy * cols + cx].add(doubleArrayOf(x, y, r))
            val fig = inGlyph(x, y)
            val f = LIGHTNESS[rnd.nextInt(LIGHTNESS.size)]
            val lin = Srgb.toLinear(if (fig) figure else background)
            val color = Srgb.fromLinear(LinearRgb(lin.r * f, lin.g * f, lin.b * f))
            drawDot(pixels, classes, size, x, y, r, color, if (fig) FIGURE else BACKGROUND)
        }
        return Image(size, pixels, classes)
    }

    private fun drawDot(px: IntArray, classes: ByteArray, size: Int, x: Double, y: Double, r: Double, color: Int, cls: Byte) {
        for (yy in max(0, (y - r - 1).toInt())..min(size - 1, (y + r + 1).toInt())) {
            for (xx in max(0, (x - r - 1).toInt())..min(size - 1, (x + r + 1).toInt())) {
                // Anti-aliased edge: coverage from the distance to the circle.
                val cover = (r - hypot(xx + 0.5 - x, yy + 0.5 - y) + 0.5).coerceIn(0.0, 1.0)
                if (cover <= 0.0) continue
                val i = yy * size + xx
                px[i] = Overlays.blend(px[i], color, cover.toFloat())
                if (cover >= 1.0) classes[i] = cls
            }
        }
    }
}
