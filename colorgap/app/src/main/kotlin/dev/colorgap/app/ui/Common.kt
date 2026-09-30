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
import dev.colorgap.colorcore.ShiftDirection
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
                Text("⚙  ${profileLabel(profile)}")
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
internal fun ProbeCard(probe: ColorProbe, onClose: () -> Unit, onDetails: () -> Unit, modifier: Modifier = Modifier) {
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
            // Verdicts are spelled out, never signalled by color alone.
            if (probe.edgeLost) {
                Text(stringResource(R.string.critical_edge), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Bold)
            }
            Text(
                when (probe.colorVerdict) {
                    ColorProbe.ColorVerdict.SAME -> stringResource(R.string.probe_color_same)
                    ColorProbe.ColorVerdict.SLIGHT -> stringResource(R.string.probe_color_slight, probe.colorShift)
                    ColorProbe.ColorVerdict.DIFFERENT -> stringResource(R.string.probe_color_different, probe.colorShift)
                },
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = if (probe.colorVerdict == ColorProbe.ColorVerdict.DIFFERENT) FontWeight.Bold else FontWeight.Normal,
            )
            if (probe.colorVerdict != ColorProbe.ColorVerdict.SAME) {
                othersSee(probe.realArgb, probe.seenArgb)?.let { Text(it, style = MaterialTheme.typography.bodyLarge) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalButton(onClick = onDetails, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.details))
                }
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

/**
 * Shown when only lost edges are highlighted: otherwise a uniform area the
 * user sees differently (a lawn) shows 0 % and looks like "seen normally".
 */
@Composable
internal fun EdgesOnlyNotice(onEnable: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.edges_only_notice), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
        TextButton(onClick = onEnable, modifier = Modifier.heightIn(min = 48.dp)) {
            Text(stringResource(R.string.edges_only_enable))
        }
    }
}

/**
 * "People with typical vision see it greener here": what the user misses, in
 * words (ShiftDirection), or null when nothing stands out.
 */
@Composable
internal fun othersSee(real: Int, seen: Int): String? {
    val dirs = ShiftDirection.of(real, seen)
    if (dirs.isEmpty()) return null
    val words = dirs.map {
        stringResource(
            when (it) {
                ShiftDirection.GREENER -> R.string.dir_greener
                ShiftDirection.REDDER -> R.string.dir_redder
                ShiftDirection.PINKER -> R.string.dir_pinker
                ShiftDirection.YELLOWER -> R.string.dir_yellower
                ShiftDirection.BLUER -> R.string.dir_bluer
            },
        )
    }
    return stringResource(R.string.others_see, words.joinToString(stringResource(R.string.and_separator)))
}

/** What the stripes mean: they don't change colors, so they need words. */
@Composable
internal fun StripesLegend() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(
            Modifier
                .size(28.dp)
                .background(
                    Brush.linearGradient(
                        0f to Color.Black, 0.2f to Color.Black, 0.2f to Color.White, 0.4f to Color.White,
                        0.4f to Color.Gray, 1f to Color.Gray,
                        start = androidx.compose.ui.geometry.Offset.Zero,
                        end = androidx.compose.ui.geometry.Offset(14f, 14f),
                        tileMode = androidx.compose.ui.graphics.TileMode.Repeated,
                    ),
                    RoundedCornerShape(4.dp),
                )
                .clearAndSetSemantics { },
        )
        Text(stringResource(R.string.stripes_legend), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
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

/** What the heatmap means: the stronger the tint, the bigger the difference from typical vision. */
@Composable
internal fun HeatLegend(type: CvdType) {
    val tint = Color(Overlays.heatColor(type))
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.legend_color), style = MaterialTheme.typography.labelMedium)
        Box(
            Modifier
                .weight(1f)
                .height(12.dp)
                .background(Brush.horizontalGradient(listOf(tint.copy(alpha = 0.1f), tint.copy(alpha = Overlays.HEAT_MAX_ALPHA))), RoundedCornerShape(6.dp))
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

/** "Deutan 100%". */
@Composable
internal fun profileLabel(profile: CvdProfile) = "${shortName(profile.type)} ${(profile.severity * 100).roundToInt()}%"

@Composable
private fun shortName(type: CvdType): String = stringResource(
    when (type) {
        CvdType.DEUTAN -> R.string.type_deutan_short
        CvdType.PROTAN -> R.string.type_protan_short
        CvdType.TRITAN -> R.string.type_tritan_short
    },
)
