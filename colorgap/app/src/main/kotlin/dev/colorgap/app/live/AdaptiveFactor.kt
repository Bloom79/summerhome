package dev.colorgap.app.live

/**
 * Chooses the integer downscale factor of the live analysis so that the
 * per-frame processing time stays around [targetMillis]: coarser when frames
 * are slow, finer when there is headroom. Each decision uses the median of a
 * window of [settleFrames] frames (robust to JIT and GC spikes) and a
 * hysteresis band, so it doesn't oscillate.
 */
class AdaptiveFactor(
    initial: Int = 3,
    val min: Int = 2,
    val max: Int = 6,
    val targetMillis: Float = 50f,
    val settleFrames: Int = 12,
) {
    var factor = initial.coerceIn(min, max)
        private set

    /** Median processing time of the last complete window (0 before the first). */
    var medianMillis = 0f
        private set

    private val window = FloatArray(settleFrames)
    private var count = 0

    /** Records one frame's processing time; returns true when [factor] changed. */
    fun record(millis: Float): Boolean {
        window[count++] = millis
        if (count < settleFrames) return false
        count = 0
        medianMillis = window.sortedArray()[settleFrames / 2]
        val next = when {
            medianMillis > targetMillis * 1.3f -> (factor + 1).coerceAtMost(max)
            medianMillis < targetMillis * 0.45f -> (factor - 1).coerceAtLeast(min)
            else -> factor
        }
        if (next == factor) return false
        factor = next
        return true
    }
}
