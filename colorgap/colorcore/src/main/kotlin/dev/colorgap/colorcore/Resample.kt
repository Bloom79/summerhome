package dev.colorgap.colorcore

/** Image resampling helpers on packed ARGB buffers. */
object Resample {
    /**
     * Downscales by an integer [factor], averaging each factor×factor block
     * (a box filter: no aliasing, so no fake edges for the edge detector).
     * Trailing rows/columns that do not fill a block are dropped.
     */
    fun boxDownscale(src: IntArray, width: Int, height: Int, factor: Int, dst: IntArray? = null): IntArray {
        require(factor >= 1) { "factor must be >= 1" }
        val w = width / factor
        val h = height / factor
        require(w > 0 && h > 0) { "image smaller than one block" }
        val out = if (dst != null && dst.size >= w * h) dst else IntArray(w * h)
        val area = factor * factor
        val half = area / 2
        Parallel.forRange(h) { yFrom, yUntil ->
            for (y in yFrom until yUntil) {
                for (x in 0 until w) {
                    var r = 0; var g = 0; var b = 0; var a = 0
                    for (dy in 0 until factor) {
                        var i = (y * factor + dy) * width + x * factor
                        repeat(factor) {
                            val c = src[i++]
                            a += c ushr 24; r += (c shr 16) and 0xFF; g += (c shr 8) and 0xFF; b += c and 0xFF
                        }
                    }
                    out[y * w + x] = Argb.pack((r + half) / area, (g + half) / area, (b + half) / area, (a + half) / area)
                }
            }
        }
        return out
    }
}
