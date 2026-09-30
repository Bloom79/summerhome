package dev.colorgap.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Accents on the blue–yellow axis with strong lightness contrast, readable
// for protan and deutan users; state is never conveyed by hue alone.
private val Light = lightColorScheme(
    primary = Color(0xFF1D3FBF),
    onPrimary = Color.White,
    secondary = Color(0xFF5A5F71),
    tertiary = Color(0xFF8A6D00),
)

private val Dark = darkColorScheme(
    primary = Color(0xFFB6C4FF),
    onPrimary = Color(0xFF002780),
    secondary = Color(0xFFC2C5DD),
    tertiary = Color(0xFFFFE14D),
)

@Composable
fun ColorGapTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
}
