package dev.colorgap.colorcore

import java.util.stream.IntStream

/** Minimal data-parallel loop on the JVM common pool (also available on Android). */
object Parallel {
    private val cores = Runtime.getRuntime().availableProcessors()

    /**
     * Runs [body] over contiguous sub-ranges covering 0 until [n]. Work below
     * [grain] items runs on the calling thread.
     */
    inline fun forRange(n: Int, grain: Int = 16, crossinline body: (from: Int, until: Int) -> Unit) {
        val chunks = chunkCount(n, grain)
        if (chunks <= 1) {
            body(0, n)
            return
        }
        IntStream.range(0, chunks).parallel().forEach { c ->
            body((c.toLong() * n / chunks).toInt(), ((c + 1).toLong() * n / chunks).toInt())
        }
    }

    /** A few chunks per core, for load balancing; 1 when the work is small. */
    fun chunkCount(n: Int, grain: Int): Int = if (n < 2 * grain || cores == 1) 1 else minOf(n / grain, cores * 3)
}
