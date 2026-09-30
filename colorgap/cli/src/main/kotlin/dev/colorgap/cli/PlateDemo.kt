package dev.colorgap.cli

import dev.colorgap.colorcore.Argb
import dev.colorgap.colorcore.Confusion
import dev.colorgap.colorcore.CvdProfile
import dev.colorgap.colorcore.CvdSimulator
import dev.colorgap.colorcore.CvdType
import dev.colorgap.colorcore.Plate
import java.awt.Color
import java.awt.Font
import java.awt.RenderingHints
import java.awt.image.BufferedImage
import java.io.File
import javax.imageio.ImageIO

/**
 * Writes a side-by-side demo for [hex]: the Ishihara-style plate built from
 * the color and its confusion twin, as typical vision sees it and as the
 * profile sees it (simulated).
 */
fun writePlateDemo(hex: String, type: CvdType, severity: Double, digit: Int, file: File) {
    val profile = CvdProfile(type, severity)
    val pair = Confusion.twin(Argb.fromHex(hex), profile)
    if (pair == null) {
        println("No confusion twin for $hex at ${type.name.lowercase()} ${(severity * 100).toInt()}%: this profile tells it apart from every nearby color.")
        return
    }
    val size = 480
    val plate = Plate.generate(pair.color, pair.twin, digit, size, seed = 7)
    val simulated = CvdSimulator(profile).simulateInto(plate.pixels)
    val pad = 24
    val header = 70
    val out = BufferedImage(size * 2 + pad * 3, size + header + pad, BufferedImage.TYPE_INT_RGB)
    val g = out.createGraphics()
    g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON)
    g.color = Color(250, 250, 250)
    g.fillRect(0, 0, out.width, out.height)
    g.color = Color(30, 30, 30)
    g.font = Font(Font.SANS_SERIF, Font.BOLD, 20)
    g.drawString("Typical vision", pad, 32)
    g.drawString("${type.name.lowercase().replaceFirstChar { it.uppercase() }} ${(severity * 100).toInt()}% (simulated)", size + 2 * pad, 32)
    g.font = Font(Font.SANS_SERIF, Font.PLAIN, 14)
    g.drawString("$hex vs twin ${Argb.toHex(pair.twin)} · ΔE typical %.1f · ΔE for you %.1f".format(pair.typicalDelta, pair.userDelta), pad, 56)
    g.dispose()
    out.setRGB(pad, header, size, size, plate.pixels, 0, size)
    out.setRGB(size + 2 * pad, header, size, size, simulated, 0, size)
    file.parentFile?.mkdirs()
    ImageIO.write(out, "png", file)
    println("Wrote ${file.path}: $hex + twin ${Argb.toHex(pair.twin)}, ΔE typical %.1f, for you %.1f".format(pair.typicalDelta, pair.userDelta))
}
