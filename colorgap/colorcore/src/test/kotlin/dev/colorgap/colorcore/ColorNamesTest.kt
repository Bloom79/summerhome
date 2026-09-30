package dev.colorgap.colorcore

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ColorNamesTest {
    @Test
    fun `dictionary is well formed`() {
        assertTrue(ColorNames.all.size >= 120)
        assertEquals(ColorNames.all.size, ColorNames.all.map { it.argb }.toSet().size, "duplicate hex")
        assertEquals(ColorNames.all.size, ColorNames.all.map { it.english }.toSet().size, "duplicate English name")
        assertEquals(ColorNames.all.size, ColorNames.all.map { it.italian }.toSet().size, "duplicate Italian name")
        assertTrue(ColorNames.all.all { it.english.isNotBlank() && it.italian.isNotBlank() })
    }

    @Test
    fun `every entry is its own nearest match`() {
        for (c in ColorNames.all) {
            val m = ColorNames.nearest(c.argb)
            assertEquals(c.english, m.color.english)
            assertEquals(0.0, m.deltaE, 1e-9)
        }
    }

    @Test
    fun `near colors get the expected names in both languages`() {
        val cases = mapOf(
            "#050505" to ("Black" to "Nero"),
            "#FB0306" to ("Red" to "Rosso"),
            "#6C8C25" to ("Olive green" to "Verde oliva"),
            "#8A5A2A" to ("Brown" to "Marrone"),
            "#F8F8F8" to ("White" to "Bianco"),
            "#03037C" to ("Navy blue" to "Blu marina"),
        )
        for ((hex, names) in cases) {
            val m = ColorNames.nearest(Argb.fromHex(hex))
            assertEquals(names.first, m.color.name("en"), hex)
            assertEquals(names.second, m.color.name("it"), hex)
        }
    }

    @Test
    fun `unknown languages fall back to English`() {
        assertEquals("Red", ColorNames.nearest(Argb.fromHex("#FF0000")).color.name("fr"))
    }
}
