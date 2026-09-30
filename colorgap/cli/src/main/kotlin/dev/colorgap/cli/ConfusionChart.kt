package dev.colorgap.cli

import dev.colorgap.colorcore.Argb
import java.awt.BasicStroke
import java.awt.Color
import java.awt.RenderingHints
import java.awt.geom.Ellipse2D
import java.awt.image.BufferedImage
import java.io.File
import javax.imageio.ImageIO
import kotlin.math.abs
import kotlin.random.Random

/**
 * Draws a deterministic test chart:
 *  - top row: side-by-side patches (brown|olive, red|green, pink|gray,
 *    cornflower|teal, blue|yellow, black|white);
 *  - bottom left: Ishihara-style dot plate, a brown "7" among olive dots;
 *  - bottom right: red and green lines (a chart legend) and blue and orange lines.
 */
fun writeConfusionChart(file: File) {
    val w = 720
    val h = 480
    val img = BufferedImage(w, h, BufferedImage.TYPE_INT_RGB)
    val g = img.createGraphics()
    g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
    g.color = Color(245, 245, 245)
    g.fillRect(0, 0, w, h)

    fun color(hex: String) = Color(Argb.fromHex(hex))

    val pairs = listOf(
        "#8B5A2B" to "#6E7B2B", "#E53935" to "#43A047", "#FF69B4" to "#9E9E9E",
        "#6495ED" to "#20B2AA", "#0000FF" to "#FFFF00", "#000000" to "#FFFFFF",
    )
    val pw = w / pairs.size
    pairs.forEachIndexed { i, (a, b) ->
        val x = i * pw
        g.color = color(a); g.fillRect(x + 8, 16, pw / 2 - 8, 160)
        g.color = color(b); g.fillRect(x + pw / 2, 16, pw / 2 - 8, 160)
    }

    val cx = 200.0
    val cy = 330.0
    val r = 130.0
    fun inSeven(x: Double, y: Double): Boolean {
        val dx = x - cx
        val dy = y - cy
        return (dx in -60.0..60.0 && dy in -80.0..-50.0) || (abs(dx - (-0.55 * dy + 5)) < 18 && dy > -50 && dy < 85)
    }
    val rnd = Random(7)
    repeat(2600) {
        val x = cx - r + rnd.nextDouble() * 2 * r
        val y = cy - r + rnd.nextDouble() * 2 * r
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r * r) return@repeat
        val dot = 3 + rnd.nextDouble() * 4
        val base = if (inSeven(x, y)) intArrayOf(139, 90, 43) else intArrayOf(110, 123, 43)
        val j = rnd.nextInt(-10, 11)
        g.color = Color((base[0] + j).coerceIn(0, 255), (base[1] + j).coerceIn(0, 255), (base[2] + j).coerceIn(0, 255))
        g.fill(Ellipse2D.Double(x - dot, y - dot, 2 * dot, 2 * dot))
    }

    g.stroke = BasicStroke(8f)
    for ((hex, y) in listOf("#D32F2F" to 260, "#388E3C" to 290, "#1565C0" to 340, "#EF6C00" to 370)) {
        g.color = color(hex)
        g.drawLine(400, y, 700, y)
    }
    g.dispose()
    file.parentFile?.mkdirs()
    ImageIO.write(img, "png", file)
    println("Wrote ${file.path}")
}
