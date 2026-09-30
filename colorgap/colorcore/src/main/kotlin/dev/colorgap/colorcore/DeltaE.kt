package dev.colorgap.colorcore

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.exp
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
