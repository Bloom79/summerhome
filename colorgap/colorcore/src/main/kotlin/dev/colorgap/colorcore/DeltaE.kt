package dev.colorgap.colorcore

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * CIEDE2000 color difference, following Sharma, Wu & Dalal (2005),
 * "The CIEDE2000 Color-Difference Formula: Implementation Notes,
 * Supplementary Test Data, and Mathematical Observations".
 * Parametric factors kL = kC = kH = 1.
 */
object DeltaE {
    private const val DEG = Math.PI / 180.0
    private const val POW25_7 = 6103515625.0 // 25^7

    fun ciede2000(x: Lab, y: Lab): Double = ciede2000(x.l, x.a, x.b, y.l, y.a, y.b)

    fun ciede2000(l1: Double, a1: Double, b1: Double, l2: Double, a2: Double, b2: Double): Double {
        val c1 = sqrt(a1 * a1 + b1 * b1)
        val c2 = sqrt(a2 * a2 + b2 * b2)
        val cBar7 = pow7((c1 + c2) / 2.0)
        val g = 0.5 * (1.0 - sqrt(cBar7 / (cBar7 + POW25_7)))
        val a1p = (1.0 + g) * a1
        val a2p = (1.0 + g) * a2
        val c1p = sqrt(a1p * a1p + b1 * b1)
        val c2p = sqrt(a2p * a2p + b2 * b2)
        val h1p = hueDegrees(b1, a1p)
        val h2p = hueDegrees(b2, a2p)

        val dLp = l2 - l1
        val dCp = c2p - c1p
        val cProduct = c1p * c2p
        val dhp = when {
            cProduct == 0.0 -> 0.0
            abs(h2p - h1p) <= 180.0 -> h2p - h1p
            h2p - h1p > 180.0 -> h2p - h1p - 360.0
            else -> h2p - h1p + 360.0
        }
        val dHp = 2.0 * sqrt(cProduct) * sin(dhp * DEG / 2.0)

        val lBarP = (l1 + l2) / 2.0
        val cBarP = (c1p + c2p) / 2.0
        val hBarP = when {
            cProduct == 0.0 -> h1p + h2p
            abs(h1p - h2p) <= 180.0 -> (h1p + h2p) / 2.0
            h1p + h2p < 360.0 -> (h1p + h2p + 360.0) / 2.0
            else -> (h1p + h2p - 360.0) / 2.0
        }

        val t = 1.0 -
            0.17 * cos((hBarP - 30.0) * DEG) +
            0.24 * cos(2.0 * hBarP * DEG) +
            0.32 * cos((3.0 * hBarP + 6.0) * DEG) -
            0.20 * cos((4.0 * hBarP - 63.0) * DEG)
        val dTheta = 30.0 * exp(-sq((hBarP - 275.0) / 25.0))
        val cBarP7 = pow7(cBarP)
        val rc = 2.0 * sqrt(cBarP7 / (cBarP7 + POW25_7))
        val lm50 = sq(lBarP - 50.0)
        val sl = 1.0 + 0.015 * lm50 / sqrt(20.0 + lm50)
        val sc = 1.0 + 0.045 * cBarP
        val sh = 1.0 + 0.015 * cBarP * t
        val rt = -sin(2.0 * dTheta * DEG) * rc

        val lTerm = dLp / sl
        val cTerm = dCp / sc
        val hTerm = dHp / sh
        return sqrt(lTerm * lTerm + cTerm * cTerm + hTerm * hTerm + rt * cTerm * hTerm)
    }

    private val COS30 = cos(30.0 * DEG); private val SIN30 = sin(30.0 * DEG)
    private val COS6 = cos(6.0 * DEG); private val SIN6 = sin(6.0 * DEG)
    private val COS63 = cos(63.0 * DEG); private val SIN63 = sin(63.0 * DEG)
    private val COS275 = cos(275.0 * DEG); private val SIN275 = sin(275.0 * DEG)

    /**
     * The same CIEDE2000 formula as [ciede2000], evaluated with hue unit
     * vectors instead of angles: the mean hue is the normalized sum of the
     * two hue vectors (the short-arc mean, exactly Sharma's rule), the
     * multiple-angle cosines of T come from polynomial identities and
     * sin(Δh'/2) from the half-angle formula. Only the rotation term near
     * blue needs an atan2. About 3× faster; used on the per-pixel hot path.
     * Exactly opposite hues (a tie in Sharma's rule) defer to [ciede2000].
     */
    fun ciede2000Fast(l1: Double, a1: Double, b1: Double, l2: Double, a2: Double, b2: Double): Double {
        val c1 = sqrt(a1 * a1 + b1 * b1)
        val c2 = sqrt(a2 * a2 + b2 * b2)
        val cBar7 = pow7((c1 + c2) / 2.0)
        val g = 1.0 + 0.5 * (1.0 - sqrt(cBar7 / (cBar7 + POW25_7)))
        val a1p = g * a1
        val a2p = g * a2
        val c1p = sqrt(a1p * a1p + b1 * b1)
        val c2p = sqrt(a2p * a2p + b2 * b2)

        val dHp: Double
        val hx: Double // unit vector of the mean hue h̄'
        val hy: Double
        if (c1p == 0.0 || c2p == 0.0) {
            // One achromatic color: Δh' = 0 and h̄' = h1' + h2' = the other color's hue.
            dHp = 0.0
            when {
                c1p != 0.0 -> { hx = a1p / c1p; hy = b1 / c1p }
                c2p != 0.0 -> { hx = a2p / c2p; hy = b2 / c2p }
                else -> { hx = 1.0; hy = 0.0 }
            }
        } else {
            val u1x = a1p / c1p; val u1y = b1 / c1p
            val u2x = a2p / c2p; val u2y = b2 / c2p
            val mx = u1x + u2x
            val my = u1y + u2y
            val mLen = sqrt(mx * mx + my * my)
            if (mLen < 1e-12) return ciede2000(l1, a1, b1, l2, a2, b2)
            hx = mx / mLen
            hy = my / mLen
            val cosD = u1x * u2x + u1y * u2y
            val cross = u1x * u2y - u1y * u2x // sin(h2' − h1')
            val halfSin = sqrt(max(0.0, (1.0 - cosD) / 2.0))
            dHp = 2.0 * sqrt(c1p * c2p) * (if (cross < 0.0) -halfSin else halfSin)
        }

        val c2h = hx * hx - hy * hy; val s2h = 2.0 * hx * hy
        val c3h = hx * (4.0 * hx * hx - 3.0); val s3h = hy * (3.0 - 4.0 * hy * hy)
        val c4h = c2h * c2h - s2h * s2h; val s4h = 2.0 * c2h * s2h
        val t = 1.0 -
            0.17 * (hx * COS30 + hy * SIN30) +
            0.24 * c2h +
            0.32 * (c3h * COS6 - s3h * SIN6) -
            0.20 * (c4h * COS63 + s4h * SIN63)

        val cBarP = (c1p + c2p) / 2.0
        val cBarP7 = pow7(cBarP)
        val rc = 2.0 * sqrt(cBarP7 / (cBarP7 + POW25_7))
        // Beyond ±120° of 275° exp(−((h̄'−275)/25)²) < 1e-10: skip the atan2 there.
        val rt = if (hx * COS275 + hy * SIN275 > -0.5) {
            var hDeg = atan2(hy, hx) / DEG
            if (hDeg < 0.0) hDeg += 360.0
            val dTheta = 30.0 * exp(-sq((hDeg - 275.0) / 25.0))
            -sin(2.0 * dTheta * DEG) * rc
        } else {
            0.0
        }

        val lm50 = sq((l1 + l2) / 2.0 - 50.0)
        val sl = 1.0 + 0.015 * lm50 / sqrt(20.0 + lm50)
        val sc = 1.0 + 0.045 * cBarP
        val sh = 1.0 + 0.015 * cBarP * t
        val lTerm = (l2 - l1) / sl
        val cTerm = (c2p - c1p) / sc
        val hTerm = dHp / sh
        return sqrt(lTerm * lTerm + cTerm * cTerm + hTerm * hTerm + rt * cTerm * hTerm)
    }

    /** Plain Euclidean distance in Lab (CIE76). Cheap; used for gradients. */
    fun cie76(x: Lab, y: Lab): Double = sqrt(sq(x.l - y.l) + sq(x.a - y.a) + sq(x.b - y.b))

    private fun hueDegrees(b: Double, ap: Double): Double {
        if (b == 0.0 && ap == 0.0) return 0.0
        val h = atan2(b, ap) / DEG
        return if (h < 0.0) h + 360.0 else h
    }

    private fun sq(v: Double) = v * v
    private fun pow7(v: Double): Double { val v2 = v * v; val v3 = v2 * v; return v3 * v3 * v }
}
