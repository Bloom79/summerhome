package dev.colorgap.app.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.colorgap.app.R
import dev.colorgap.colorcore.Argb
import dev.colorgap.colorcore.CieLab
import dev.colorgap.colorcore.ColorNames
import dev.colorgap.colorcore.Confusion
import dev.colorgap.colorcore.ConfusionPair
import dev.colorgap.colorcore.CvdProfile
import dev.colorgap.colorcore.CvdSimulator
import dev.colorgap.colorcore.DeltaE
import dev.colorgap.colorcore.Lch
import dev.colorgap.colorcore.Plate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.abs
import kotlin.random.Random

/** A plate built from the color and its confusion twin, in the three versions the screen shows. */
private class PlateImages(
    val pair: ConfusionPair,
    val digit: Int,
    val real: ImageBitmap,
    val simulated: ImageBitmap,
    val revealed: ImageBitmap,
)

private const val PLATE_SIZE = 720

/**
 * Everything about one tapped color: the two colors large (full screen on
 * tap), how different they are for typical vision, what changes for the
 * user, and an Ishihara-style plate hiding a digit in exactly that confusion.
 */
@Composable
fun ColorDetailScreen(color: Int, profile: CvdProfile, onBack: () -> Unit, onOpenSettings: () -> Unit) {
    val language = LocalConfiguration.current.locales[0].language
    val simulator = remember(profile) { CvdSimulator(profile) }
    val seen = remember(color, profile) { simulator.simulateArgb(color) }
    var fullScreen by rememberSaveable { mutableStateOf(false) }
    var seed by rememberSaveable { mutableLongStateOf(1L) }
    var showSimulated by rememberSaveable { mutableStateOf(false) }
    var revealed by rememberSaveable { mutableStateOf(false) }
    // null while building; then the plate, or success(null) when this color has no confusion twin.
    var plate by remember(color, profile, seed) { mutableStateOf<Result<PlateImages?>?>(null) }
    LaunchedEffect(color, profile, seed) {
        plate = withContext(Dispatchers.Default) { runCatching { buildPlate(color, profile, simulator, seed) } }
    }

    val realName = ColorNames.nearest(color).color.name(language)
    val seenName = ColorNames.nearest(seen).color.name(language)
    if (fullScreen) {
        FullScreenSwatches(color, seen, realName, seenName, onClose = { fullScreen = false })
        return
    }

    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Column(
                Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    stringResource(R.string.detail_title),
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.semantics { heading() },
                )

                // 1. The two colors, large.
                Row(
                    Modifier.fillMaxWidth().clickable { fullScreen = true },
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    BigSwatch(stringResource(R.string.real_color), color, realName, Modifier.weight(1f))
                    BigSwatch(stringResource(R.string.you_see), seen, seenName, Modifier.weight(1f))
                }
                Text(stringResource(R.string.swatch_hint), style = MaterialTheme.typography.bodySmall)
                val delta = DeltaE.ciede2000(CieLab.fromArgb(color), CieLab.fromArgb(seen))
                Text(
                    stringResource(R.string.typical_difference, delta, stringResource(differenceWord(delta))),
                    style = MaterialTheme.typography.bodyLarge,
                )

                // 2. What changes, in lightness / saturation / hue.
                Heading(stringResource(R.string.what_changes))
                ChangeRows(Lch.of(color), Lch.of(seen))

                // 3. The number plate.
                Heading(stringResource(R.string.plate_title))
                when (val p = plate?.getOrNull()) {
                    null -> if (plate == null) {
                        Box(Modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    } else {
                        Text(stringResource(R.string.no_twin), style = MaterialTheme.typography.bodyLarge)
                    }
                    else -> PlateSection(
                        p, profile, showSimulated, revealed,
                        onShowSimulated = { showSimulated = it },
                        onReveal = { revealed = !revealed },
                        onNewPlate = { revealed = false; seed += 1 },
                        onOpenSettings = onOpenSettings,
                    )
                }
            }
            Button(
                onClick = onBack,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp).heightIn(min = BigTouch),
            ) {
                Text(stringResource(R.string.back), style = MaterialTheme.typography.titleMedium)
            }
        }
    }
}

private fun buildPlate(color: Int, profile: CvdProfile, simulator: CvdSimulator, seed: Long): PlateImages? {
    val pair = Confusion.twin(color, profile) ?: return null
    val digit = Plate.DIGITS[Random(seed).nextInt(Plate.DIGITS.size)]
    val plate = Plate.generate(pair.color, pair.twin, digit, PLATE_SIZE, seed)
    val simulated = simulator.simulateInto(plate.pixels)
    // Revealed: the digit's dots stay, everything else fades out.
    val revealed = IntArray(plate.pixels.size) { i ->
        if (plate.classes[i] == Plate.FIGURE) plate.pixels[i] else dev.colorgap.colorcore.Overlays.blend(plate.pixels[i], -1, 0.8f)
    }
    fun bmp(px: IntArray) = Bitmap.createBitmap(px, PLATE_SIZE, PLATE_SIZE, Bitmap.Config.ARGB_8888).asImageBitmap()
    return PlateImages(pair, digit, bmp(plate.pixels), bmp(simulated), bmp(revealed))
}

@Composable
private fun PlateSection(
    p: PlateImages,
    profile: CvdProfile,
    showSimulated: Boolean,
    revealed: Boolean,
    onShowSimulated: (Boolean) -> Unit,
    onReveal: () -> Unit,
    onNewPlate: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val language = LocalConfiguration.current.locales[0].language
    Text(
        stringResource(R.string.plate_explain, ColorNames.nearest(p.pair.twin).color.name(language), p.pair.typicalDelta, p.pair.userDelta),
        style = MaterialTheme.typography.bodyMedium,
    )
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        SegmentedButton(
            selected = !showSimulated,
            onClick = { onShowSimulated(false) },
            shape = SegmentedButtonDefaults.itemShape(0, 2),
            modifier = Modifier.heightIn(min = 56.dp),
        ) { Text(stringResource(R.string.plate_real)) }
        SegmentedButton(
            selected = showSimulated,
            onClick = { onShowSimulated(true) },
            shape = SegmentedButtonDefaults.itemShape(1, 2),
            modifier = Modifier.heightIn(min = 56.dp),
        ) { Text(stringResource(R.string.plate_yours)) }
    }
    val image = when {
        revealed -> p.revealed
        showSimulated -> p.simulated
        else -> p.real
    }
    val description = stringResource(if (showSimulated) R.string.plate_yours else R.string.plate_real)
    Image(
        image,
        contentDescription = description,
        filterQuality = FilterQuality.Medium,
        modifier = Modifier.fillMaxWidth().aspectRatio(1f),
    )
    if (revealed) {
        Text(stringResource(R.string.revealed, p.digit), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedButton(onClick = onReveal, modifier = Modifier.weight(1f).heightIn(min = 56.dp)) {
            Text(stringResource(if (revealed) R.string.hide_number else R.string.reveal))
        }
        OutlinedButton(onClick = onNewPlate, modifier = Modifier.weight(1f).heightIn(min = 56.dp)) {
            Text(stringResource(R.string.new_plate))
        }
    }
    Text(stringResource(R.string.plate_calibration, profileLabel(profile)), style = MaterialTheme.typography.bodyMedium)
    OutlinedButton(onClick = onOpenSettings, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
        Text(stringResource(R.string.change_severity))
    }
}

@Composable
private fun BigSwatch(label: String, argb: Int, name: String, modifier: Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(0.8f)
                .background(Color(argb), RoundedCornerShape(16.dp))
                .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(16.dp)),
        )
        Text(label, style = MaterialTheme.typography.labelLarge)
        Text(name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text(Argb.toHex(argb), style = MaterialTheme.typography.bodyMedium)
    }
}

/** The two colors filling the screen, one above the other, for a close look. Tap to close. */
@Composable
private fun FullScreenSwatches(real: Int, seen: Int, realName: String, seenName: String, onClose: () -> Unit) {
    val closeLabel = stringResource(R.string.close)
    Column(Modifier.fillMaxSize().clickable(onClickLabel = closeLabel, onClick = onClose)) {
        for ((argb, label) in listOf(real to "${stringResource(R.string.real_color)} · $realName", seen to "${stringResource(R.string.you_see)} · $seenName")) {
            Box(Modifier.weight(1f).fillMaxWidth().background(Color(argb)), contentAlignment = Alignment.BottomStart) {
                CornerLabel("$label · ${Argb.toHex(argb)}", Modifier.padding(12.dp).statusBarsPadding())
            }
        }
    }
}

@Composable
private fun ChangeRows(real: Lch, seen: Lch) {
    val dl = seen.lightness - real.lightness
    ChangeRow(
        stringResource(R.string.row_lightness),
        "%.0f → %.0f".format(real.lightness, seen.lightness),
        stringResource(
            when {
                abs(dl) < 3 -> R.string.unchanged
                dl > 0 -> R.string.lighter
                else -> R.string.darker
            },
        ),
    )
    val ratio = if (real.chroma < 1) 1.0 else seen.chroma / real.chroma
    ChangeRow(
        stringResource(R.string.row_chroma),
        "%.0f → %.0f".format(real.chroma, seen.chroma),
        stringResource(
            when {
                abs(seen.chroma - real.chroma) < 3 -> R.string.unchanged
                ratio < 0.5 -> R.string.much_less_saturated
                ratio < 1 -> R.string.less_saturated
                else -> R.string.more_saturated
            },
        ),
    )
    // Hue means little for near-grays.
    if (real.chroma >= 5 && seen.chroma >= 5) {
        val shift = Lch.hueDistance(real.hue, seen.hue)
        ChangeRow(
            stringResource(R.string.row_hue),
            "%.0f° → %.0f°".format(real.hue, seen.hue),
            if (shift < 10) stringResource(R.string.unchanged) else stringResource(R.string.hue_shift, shift),
        )
    }
}

@Composable
private fun ChangeRow(label: String, values: String, verdict: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
        Text(values, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Text(verdict, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1.3f))
    }
}

@Composable
private fun Heading(text: String) {
    Spacer(Modifier.size(4.dp))
    Text(text, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
}

/** Plain-language reading of a CIEDE2000 difference. */
private fun differenceWord(delta: Double): Int = when {
    delta < 2 -> R.string.de_same
    delta < 5 -> R.string.de_slight
    delta < 10 -> R.string.de_different
    delta < 25 -> R.string.de_clear
    else -> R.string.de_very
}
