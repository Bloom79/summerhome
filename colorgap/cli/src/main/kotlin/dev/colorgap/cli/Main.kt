package dev.colorgap.cli

import dev.colorgap.colorcore.AnalysisConfig
import dev.colorgap.colorcore.CvdProfile
import dev.colorgap.colorcore.CvdType
import dev.colorgap.colorcore.Overlays
import dev.colorgap.colorcore.PerceptionAnalyzer
import java.awt.RenderingHints
import java.awt.image.BufferedImage
import java.io.File
import javax.imageio.ImageIO
import kotlin.math.max
import kotlin.system.exitProcess

private const val USAGE = """
Usage: colorgap <image> [--type deutan|protan|tritan] [--severity 0..100]
                [--threshold 0..1] [--max-size px] [--out dir]

       colorgap chart [out.png]
       colorgap plate <#RRGGBB> [--type t] [--severity s] [--digit 2..9] [--out file.png]
       colorgap dump <image> [--out dir] [--max-size px] [--type t] [--severity s] [--threshold t]

Writes <name>-heatmap.png, -stripes.png, -split.png, -simulated.png and
-score.png (grayscale map) to the output directory (default: ./out).
"""

fun main(args: Array<String>) {
    if (args.isEmpty() || args[0] == "--help") { println(USAGE.trim()); exitProcess(if (args.isEmpty()) 1 else 0) }
    if (args[0] == "chart") { writeConfusionChart(File(args.getOrElse(1) { "samples/confusion-chart.png" })); return }
    if (args[0] == "plate") {
        val o = args.drop(2).chunked(2).associate { it[0] to it.getOrElse(1) { "" } }
        writePlateDemo(
            args[1],
            CvdType.valueOf((o["--type"] ?: "deutan").uppercase()),
            (o["--severity"]?.toDouble() ?: 100.0) / 100.0,
            o["--digit"]?.toInt() ?: 7,
            File(o["--out"] ?: "out/plate.png"),
        )
        return
    }
    if (args[0] == "dump") {
        val o = args.drop(2).chunked(2).associate { it[0] to it.getOrElse(1) { "" } }
        dump(
            File(args[1]),
            File(o["--out"] ?: "out/dump"),
            o["--max-size"]?.toInt() ?: 320,
            CvdType.valueOf((o["--type"] ?: "deutan").uppercase()),
            (o["--severity"]?.toDouble() ?: 100.0) / 100.0,
            o["--threshold"]?.toFloat() ?: 0.35f,
        )
        return
    }
    val opts = args.drop(1).chunked(2).associate { it[0] to it.getOrElse(1) { "" } }
    val input = File(args[0])
    val type = CvdType.valueOf((opts["--type"] ?: "deutan").uppercase())
    val severity = (opts["--severity"]?.toDouble() ?: 100.0) / 100.0
    val threshold = opts["--threshold"]?.toFloat() ?: 0.35f
    val maxSize = opts["--max-size"]?.toInt() ?: 800
    val outDir = File(opts["--out"] ?: "out").apply { mkdirs() }

    val image = downscaleTo(ImageIO.read(input) ?: error("Cannot decode $input"), maxSize)
    val w = image.width
    val h = image.height
    val pixels = image.getRGB(0, 0, w, h, null, 0, w)

    val analyzer = PerceptionAnalyzer(CvdProfile(type, severity), AnalysisConfig())
    analyzer.analyze(pixels, w, h) // JIT warm-up, so the timing below is representative
    val start = System.nanoTime()
    val map = analyzer.analyze(pixels, w, h)
    val ms = (System.nanoTime() - start) / 1e6

    val base = input.nameWithoutExtension
    fun save(suffix: String, argb: IntArray) {
        val out = BufferedImage(w, h, BufferedImage.TYPE_INT_RGB)
        out.setRGB(0, 0, w, h, argb, 0, w)
        ImageIO.write(out, "png", File(outDir, "$base-$suffix.png"))
    }
    save("heatmap", Overlays.heatmap(pixels, map, threshold, type))
    save("stripes", Overlays.stripes(pixels, map, threshold))
    save("split", Overlays.split(pixels, map))
    save("simulated", map.simulated)
    save("score", IntArray(w * h) { val v = (map.score[it] * 255).toInt(); (v shl 16) or (v shl 8) or v })

    println("%s %dx%d  %s %.0f%%  analysis %.0f ms  critical area %.1f%% (threshold %.2f)  → %s".format(
        input.name, w, h, type.name.lowercase(), severity * 100, ms,
        map.criticalFraction(threshold) * 100, threshold, outDir.path,
    ))
}

internal fun downscaleTo(src: BufferedImage, maxSize: Int): BufferedImage {
    val scale = maxSize.toDouble() / max(src.width, src.height)
    val w = if (scale < 1) (src.width * scale).toInt() else src.width
    val h = if (scale < 1) (src.height * scale).toInt() else src.height
    val dst = BufferedImage(w, h, BufferedImage.TYPE_INT_RGB)
    dst.createGraphics().apply {
        setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR)
        setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY)
        drawImage(src, 0, 0, w, h, null)
        dispose()
    }
    return dst
}
