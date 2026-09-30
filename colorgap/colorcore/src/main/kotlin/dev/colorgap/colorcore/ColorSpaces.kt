package dev.colorgap.colorcore

import kotlin.math.cbrt
import kotlin.math.pow

/** CIELAB color (D65 reference white, 2° observer). */
data class Lab(val l: Double, val a: Double, val b: Double)

/** Linear-light RGB triple, components nominally in 0..1. */
data class LinearRgb(val r: Double, val g: Double, val b: Double)

/** Helpers for packed 0xAARRGGBB ints (the format of Android Bitmap and BufferedImage). */
object Argb {
    fun alpha(c: Int): Int = (c ushr 24) and 0xFF
    fun red(c: Int): Int = (c shr 16) and 0xFF
    fun green(c: Int): Int = (c shr 8) and 0xFF
    fun blue(c: Int): Int = c and 0xFF
    fun pack(r: Int, g: Int, b: Int, a: Int = 0xFF): Int = (a shl 24) or (r shl 16) or (g shl 8) or b

    fun toHex(c: Int): String = "#%02X%02X%02X".format(red(c), green(c), blue(c))

    fun fromHex(hex: String): Int {
        val s = hex.removePrefix("#")
        require(s.length == 6) { "Expected #RRGGBB, got $hex" }
        return 0xFF000000.toInt() or s.toInt(16)
    }
}

/** sRGB transfer function (IEC 61966-2-1). */
object Srgb {
    private val toLinearLut = DoubleArray(256) { decode(it / 255.0) }

    /** Gamma-encoded 0..1 → linear 0..1. */
    fun decode(v: Double): Double =
        if (v <= 0.04045) v / 12.92 else ((v + 0.055) / 1.055).pow(2.4)

    /** Linear 0..1 → gamma-encoded 0..1 (input is clamped to gamut). */
    fun encode(v: Double): Double {
        val x = v.coerceIn(0.0, 1.0)
        return if (x <= 0.0031308) 12.92 * x else 1.055 * x.pow(1.0 / 2.4) - 0.055
    }

    /** 8-bit channel → linear 0..1 (table lookup). */
    fun channelToLinear(v: Int): Double = toLinearLut[v]

    /** Linear 0..1 → 8-bit channel, rounded and clamped. */
    fun linearToChannel(v: Double): Int = (encode(v) * 255.0 + 0.5).toInt().coerceIn(0, 255)

    private const val FAST_STEPS = 16383
    private val fromLinearLut = IntArray(FAST_STEPS + 1) { linearToChannel(it / FAST_STEPS.toDouble()) }

    /** Table-based [linearToChannel], within ±1 level of it; for full-resolution bulk work. */
    fun linearToChannelFast(v: Double): Int =
        fromLinearLut[(v.coerceIn(0.0, 1.0) * FAST_STEPS + 0.5).toInt()]

    fun toLinear(argb: Int): LinearRgb = LinearRgb(
        channelToLinear(Argb.red(argb)),
        channelToLinear(Argb.green(argb)),
        channelToLinear(Argb.blue(argb)),
    )

    fun fromLinear(rgb: LinearRgb, alpha: Int = 0xFF): Int =
        Argb.pack(linearToChannel(rgb.r), linearToChannel(rgb.g), linearToChannel(rgb.b), alpha)
}

/**
 * Linear sRGB ↔ XYZ ↔ CIELAB conversions.
 *
 * The reference white is taken as the XYZ of linear RGB (1,1,1) under the same
 * matrix, so sRGB white maps to exactly a* = b* = 0.
 */
object CieLab {
    // Linear sRGB → XYZ (D65), IEC 61966-2-1 / Lindbloom.
    private const val M00 = 0.4124564; private const val M01 = 0.3575761; private const val M02 = 0.1804375
    private const val M10 = 0.2126729; private const val M11 = 0.7151522; private const val M12 = 0.0721750
    private const val M20 = 0.0193339; private const val M21 = 0.1191920; private const val M22 = 0.9503041

    const val WHITE_X = M00 + M01 + M02
    const val WHITE_Y = M10 + M11 + M12
    const val WHITE_Z = M20 + M21 + M22

    private const val EPSILON = 216.0 / 24389.0 // (6/29)^3
    private const val KAPPA = 24389.0 / 27.0 // (29/3)^3

    private fun f(t: Double): Double = if (t > EPSILON) cbrt(t) else (KAPPA * t + 16.0) / 116.0

    /**
     * Writes L*, a*, b* of a linear RGB color into [out] starting at [offset].
     * Allocation-free, for the per-pixel hot path.
     */
    fun linearToLab(r: Double, g: Double, b: Double, out: FloatArray, offset: Int) {
        val fx = f((M00 * r + M01 * g + M02 * b) / WHITE_X)
        val fy = f((M10 * r + M11 * g + M12 * b) / WHITE_Y)
        val fz = f((M20 * r + M21 * g + M22 * b) / WHITE_Z)
        out[offset] = (116.0 * fy - 16.0).toFloat()
        out[offset + 1] = (500.0 * (fx - fy)).toFloat()
        out[offset + 2] = (200.0 * (fy - fz)).toFloat()
    }

    fun fromLinear(rgb: LinearRgb): Lab {
        val fx = f((M00 * rgb.r + M01 * rgb.g + M02 * rgb.b) / WHITE_X)
        val fy = f((M10 * rgb.r + M11 * rgb.g + M12 * rgb.b) / WHITE_Y)
        val fz = f((M20 * rgb.r + M21 * rgb.g + M22 * rgb.b) / WHITE_Z)
        return Lab(116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz))
    }

    fun fromArgb(argb: Int): Lab = fromLinear(Srgb.toLinear(argb))
}
