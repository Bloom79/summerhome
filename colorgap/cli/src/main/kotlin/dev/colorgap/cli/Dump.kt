package dev.colorgap.cli

import dev.colorgap.colorcore.AnalysisConfig
import dev.colorgap.colorcore.CvdProfile
import dev.colorgap.colorcore.CvdSimulator
import dev.colorgap.colorcore.CvdType
import dev.colorgap.colorcore.Overlays
import dev.colorgap.colorcore.PerceptionAnalyzer
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import javax.imageio.ImageIO

/**
 * Writes the CPU pipeline's exact input and outputs for [image] (downscaled to
 * [maxSize]) into [outDir], so tools/gpu-check can run the GLSL shaders on
 * the same pixels and compare:
 * input.rgba (RGBA bytes), colordelta.f32 / score.f32 (little-endian floats),
 * heatmap.rgba / stripes.rgba (baked overlays at [threshold]), meta.json.
 */
fun dump(image: File, outDir: File, maxSize: Int, type: CvdType, severity: Double, threshold: Float) {
    outDir.mkdirs()
    val src = downscaleTo(ImageIO.read(image) ?: error("Cannot decode $image"), maxSize)
    val w = src.width
    val h = src.height
    val pixels = src.getRGB(0, 0, w, h, null, 0, w)
    val profile = CvdProfile(type, severity)
    val map = PerceptionAnalyzer(profile).analyze(pixels, w, h)

    File(outDir, "input.rgba").writeBytes(rgba(pixels))
    File(outDir, "colordelta.f32").writeBytes(floats(map.colorDelta))
    File(outDir, "score.f32").writeBytes(floats(map.score))
    File(outDir, "heatmap.rgba").writeBytes(rgba(Overlays.heatmap(pixels, map, threshold, type)))
    File(outDir, "stripes.rgba").writeBytes(rgba(Overlays.stripes(pixels, map, threshold)))
    val m = CvdSimulator(profile).matrix.joinToString(",")
    val (lo, hi) = Overlays.heatRamp(type)
    val c = AnalysisConfig()
    File(outDir, "meta.json").writeText(
        """{"width":$w,"height":$h,"threshold":$threshold,"matrix":[$m],""" +
            """"heatLo":$lo,"heatHi":$hi,"stripePeriod":${Overlays.stripePeriod(w, h)},""" +
            // The analysis parameters, so the GPU check runs the shaders with exactly these.
            """"config":{"colorFloor":${c.colorFloor},"colorScale":${c.colorScale},"colorWeight":${c.colorWeight},""" +
            """"contrastFloor":${c.contrastFloor},"contrastScale":${c.contrastScale},"edgeInvisible":${c.edgeInvisible},""" +
            """"edgeVisible":${c.edgeVisible},"contrastSpread":${c.contrastSpread}}}""",
    )
    println("Dumped ${image.name} ${w}x$h ${type.name.lowercase()} ${(severity * 100).toInt()}% → ${outDir.path}")
}

private fun rgba(argb: IntArray): ByteArray {
    val out = ByteArray(argb.size * 4)
    for (i in argb.indices) {
        val c = argb[i]
        out[4 * i] = (c shr 16).toByte()
        out[4 * i + 1] = (c shr 8).toByte()
        out[4 * i + 2] = c.toByte()
        out[4 * i + 3] = (c ushr 24).toByte()
    }
    return out
}

private fun floats(values: FloatArray): ByteArray =
    ByteBuffer.allocate(values.size * 4).order(ByteOrder.LITTLE_ENDIAN).apply { values.forEach { putFloat(it) } }.array()
