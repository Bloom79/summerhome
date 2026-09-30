package dev.colorgap.app.live

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AdaptiveFactorTest {
    @Test
    fun `slow frames coarsen the analysis, but only after settling`() {
        val a = AdaptiveFactor(initial = 3, targetMillis = 50f, settleFrames = 5)
        repeat(4) { assertFalse(a.record(120f)) }
        assertTrue(a.record(120f))
        assertEquals(4, a.factor)
    }

    @Test
    fun `fast frames refine it and it stops at the bounds`() {
        val a = AdaptiveFactor(initial = 3, min = 2, targetMillis = 50f, settleFrames = 3)
        repeat(3) { a.record(5f) }
        assertEquals(2, a.factor)
        repeat(30) { a.record(5f) }
        assertEquals(2, a.factor)
        val b = AdaptiveFactor(initial = 6, max = 6, settleFrames = 1)
        repeat(10) { b.record(500f) }
        assertEquals(6, b.factor)
    }

    @Test
    fun `times inside the band keep the factor`() {
        val a = AdaptiveFactor(initial = 3, targetMillis = 50f, settleFrames = 2)
        repeat(100) { a.record(if (it % 2 == 0) 30f else 60f) }
        assertEquals(3, a.factor)
    }

    @Test
    fun `a JIT warm-up spike is absorbed by the average`() {
        val a = AdaptiveFactor(initial = 3, targetMillis = 50f, settleFrames = 12)
        a.record(400f)
        repeat(11) { a.record(35f) }
        assertEquals(3, a.factor)
    }
}
