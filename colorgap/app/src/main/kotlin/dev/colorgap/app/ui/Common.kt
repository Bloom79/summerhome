package dev.colorgap.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.colorgap.app.ColorProbe
import dev.colorgap.app.R
import dev.colorgap.app.ViewMode
import dev.colorgap.colorcore.Argb
import dev.colorgap.colorcore.CvdProfile
import dev.colorgap.app.settings.AppSettings
import dev.colorgap.colorcore.CvdType
import dev.colorgap.colorcore.Overlays
import kotlin.math.roundToInt

/** Minimum height of every primary control: large touch targets, usable with a thumb. */
internal val BigTouch = 60.dp

@Composable
internal fun TopBar(profile: CvdProfile, onProfileClick: () -> Unit) {
    Surface(tonalElevation = 2.dp) {
        Row(
            Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                stringResource(R.string.app_name),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
            )
            val changeProfile = stringResource(R.string.change_profile)
            FilledTonalButton(
                onClick = onProfileClick,
                modifier = Modifier
                    .heightIn(min = 48.dp)
                    .semantics { contentDescription = changeProfile },
            ) {
                Text("⚙  ${shortName(profile.type)} ${(profile.severity * 100).roundToInt()}%")
            }
        }
    }
}

@Composable
internal fun ModeSelector(mode: ViewMode, onSelect: (ViewMode) -> Unit) {
    val modes = listOf(
        ViewMode.HEATMAP to R.string.mode_heatmap,
        ViewMode.STRIPES to R.string.mode_stripes,
        ViewMode.SPLIT to R.string.mode_split,
    )
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        modes.forEachIndexed { i, (m, label) ->
            SegmentedButton(
                selected = mode == m,
                onClick = { onSelect(m) },
                shape = SegmentedButtonDefaults.itemShape(i, modes.size),
                modifier = Modifier.heightIn(min = BigTouch),
            ) { Text(stringResource(label)) }
        }
    }
}

/** Threshold slider, or the divider slider in split mode. */
@Composable
internal fun ModeSlider(
    mode: ViewMode,
    threshold: Float,
    criticalFraction: Float,
    split: Float,
    onThreshold: (Float) -> Unit,
    onSplit: (Float) -> Unit,
) {
    if (mode == ViewMode.SPLIT) {
        Text(stringResource(R.string.divider), style = MaterialTheme.typography.labelLarge)
        val label = stringResource(R.string.divider)
        Slider(value = split, onValueChange = onSplit, modifier = Modifier.semantics { contentDescription = label })
    } else {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                stringResource(R.string.threshold, threshold),
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.weight(1f),
            )
            Text(
                stringResource(R.string.critical_area, (criticalFraction * 100).roundToInt()),
                style = MaterialTheme.typography.labelLarge,
            )
        }
        val label = stringResource(R.string.threshold, threshold)
        Slider(
            value = threshold,
            onValueChange = onThreshold,
            valueRange = AppSettings.MIN_THRESHOLD..AppSettings.MAX_THRESHOLD,
            modifier = Modifier.semantics { contentDescription = label },
        )
        Text(stringResource(R.string.threshold_hint), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
internal fun ProbeCard(probe: ColorProbe, onClose: () -> Unit, modifier: Modifier = Modifier) {
    val language = LocalConfiguration.current.locales[0].language
    Surface(
        // Polite live region: TalkBack reads the names when they change (e.g. while panning the camera).
        modifier.padding(12.dp).fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
        shape = RoundedCornerShape(16.dp),
        tonalElevation = 6.dp,
        shadowElevation = 6.dp,
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SwatchRow(stringResource(R.string.real_color), probe.realArgb, probe.realName.color.name(language))
            SwatchRow(stringResource(R.string.you_see), probe.seenArgb, probe.seenName.color.name(language))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    // The verdict is spelled out, never signalled by color alone.
                    stringResource(if (probe.critical) R.string.critical_here else R.string.not_critical_here),
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = if (probe.critical) FontWeight.Bold else FontWeight.Normal,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = onClose, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.close))
                }
            }
        }
    }
}

@Composable
private fun SwatchRow(label: String, argb: Int, name: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(44.dp)
                .background(Color(argb), RoundedCornerShape(8.dp))
                .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp)),
        )
        Spacer(Modifier.width(12.dp))
        Column {
            Text(label, style = MaterialTheme.typography.labelMedium)
            Text("$name · ${Argb.toHex(argb)}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }
    }
}

/** Square ⚙ button for the bottom bar: settings within thumb reach. */
@Composable
internal fun SettingsButton(onClick: () -> Unit) {
    val label = stringResource(R.string.settings_title)
    OutlinedButton(
        onClick = onClick,
        contentPadding = PaddingValues(0.dp),
        modifier = Modifier.size(BigTouch).semantics { contentDescription = label },
    ) {
        Text("⚙", style = MaterialTheme.typography.headlineSmall)
    }
}

/** What the heatmap colors mean: low end = the color looks different, high end = an edge disappears. */
@Composable
internal fun HeatLegend(type: CvdType) {
    val (lo, hi) = Overlays.heatRamp(type)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.legend_color), style = MaterialTheme.typography.labelMedium)
        Box(
            Modifier
                .weight(1f)
                .height(12.dp)
                .background(Brush.horizontalGradient(listOf(Color(lo), Color(hi))), RoundedCornerShape(6.dp))
                .clearAndSetSemantics { },
        )
        Text(stringResource(R.string.legend_edge), style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
internal fun CornerLabel(text: String, modifier: Modifier) {
    Surface(
        modifier.padding(8.dp),
        shape = RoundedCornerShape(8.dp),
        color = Color.Black.copy(alpha = 0.6f),
        contentColor = Color.White,
    ) {
        Text(text, Modifier.padding(horizontal = 10.dp, vertical = 4.dp), style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
private fun shortName(type: CvdType): String = stringResource(
    when (type) {
        CvdType.DEUTAN -> R.string.type_deutan_short
        CvdType.PROTAN -> R.string.type_protan_short
        CvdType.TRITAN -> R.string.type_tritan_short
    },
)
