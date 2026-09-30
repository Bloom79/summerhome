package dev.colorgap.app.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.colorgap.app.ColorProbe
import dev.colorgap.app.PhotoViewModel
import dev.colorgap.app.R
import dev.colorgap.app.ViewMode
import dev.colorgap.colorcore.Argb
import dev.colorgap.colorcore.CvdProfile
import dev.colorgap.colorcore.CvdType
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

/** Minimum height of every primary control: large touch targets, usable with a thumb. */
private val BigTouch = 60.dp

@Composable
fun PhotoScreen(vm: PhotoViewModel) {
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    var showProfile by rememberSaveable { mutableStateOf(false) }

    val pickPhoto = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri?.let(vm::open)
    }
    val exportTo = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("image/png")) { uri ->
        uri?.let(vm::export)
    }
    val openPicker = { pickPhoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }

    vm.message?.let { res ->
        LaunchedEffect(res) {
            snackbar.showSnackbar(context.getString(res))
            vm.messageShown()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = { TopBar(vm.profile, onProfileClick = { showProfile = true }) },
        bottomBar = {
            if (vm.photo != null) {
                Controls(
                    vm = vm,
                    onGallery = openPicker,
                    onExport = { exportTo.launch("colorgap-${timestamp()}.png") },
                )
            }
        },
    ) { padding ->
        Box(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .background(Color.Black),
        ) {
            val photo = vm.photo
            if (photo == null) {
                EmptyState(onChoose = openPicker, Modifier.align(Alignment.Center))
            } else {
                PhotoCanvas(
                    photo = photo,
                    overlay = vm.overlay,
                    mode = vm.mode,
                    split = vm.split,
                    probe = vm.probe,
                    onTap = vm::tapAt,
                    modifier = Modifier.fillMaxSize(),
                )
                vm.probe?.let { ProbeCard(it, onClose = vm::dismissProbe, Modifier.align(Alignment.TopCenter)) }
            }
            if (vm.busy) {
                Surface(Modifier.align(Alignment.Center), shape = RoundedCornerShape(16.dp), tonalElevation = 6.dp) {
                    Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(32.dp))
                        Spacer(Modifier.width(16.dp))
                        Text(stringResource(R.string.analyzing), style = MaterialTheme.typography.titleMedium)
                    }
                }
            }
        }
    }

    if (showProfile) {
        ProfileDialog(
            initial = vm.profile,
            onDismiss = { showProfile = false },
            onConfirm = { vm.updateProfile(it); showProfile = false },
        )
    }
}

@Composable
private fun TopBar(profile: CvdProfile, onProfileClick: () -> Unit) {
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
                Text("${shortName(profile.type)} ${(profile.severity * 100).roundToInt()}%")
            }
        }
    }
}

@Composable
private fun EmptyState(onChoose: () -> Unit, modifier: Modifier) {
    Column(modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            stringResource(R.string.empty_hint),
            color = Color.White,
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.size(24.dp))
        Button(onClick = onChoose, modifier = Modifier.fillMaxWidth().heightIn(min = BigTouch)) {
            Text(stringResource(R.string.choose_photo), style = MaterialTheme.typography.titleMedium)
        }
    }
}

@Composable
private fun Controls(vm: PhotoViewModel, onGallery: () -> Unit, onExport: () -> Unit) {
    Surface(tonalElevation = 3.dp) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            val modes = listOf(
                ViewMode.HEATMAP to R.string.mode_heatmap,
                ViewMode.STRIPES to R.string.mode_stripes,
                ViewMode.SPLIT to R.string.mode_split,
            )
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                modes.forEachIndexed { i, (mode, label) ->
                    SegmentedButton(
                        selected = vm.mode == mode,
                        onClick = { vm.selectMode(mode) },
                        shape = SegmentedButtonDefaults.itemShape(i, modes.size),
                        modifier = Modifier.heightIn(min = BigTouch),
                    ) { Text(stringResource(label)) }
                }
            }

            if (vm.mode == ViewMode.SPLIT) {
                Text(stringResource(R.string.divider), style = MaterialTheme.typography.labelLarge)
                Slider(value = vm.split, onValueChange = vm::updateSplit)
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        stringResource(R.string.threshold, vm.threshold),
                        style = MaterialTheme.typography.labelLarge,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        stringResource(R.string.critical_area, (vm.criticalFraction * 100).roundToInt()),
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
                Slider(value = vm.threshold, onValueChange = vm::updateThreshold, valueRange = 0.05f..0.95f)
                Text(stringResource(R.string.threshold_hint), style = MaterialTheme.typography.bodySmall)
            }

            Text(stringResource(R.string.tap_hint), style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = onGallery, modifier = Modifier.weight(1f).heightIn(min = BigTouch)) {
                    Text(stringResource(R.string.gallery), style = MaterialTheme.typography.titleMedium)
                }
                Button(onClick = onExport, modifier = Modifier.weight(1f).heightIn(min = BigTouch)) {
                    Text(stringResource(R.string.export), style = MaterialTheme.typography.titleMedium)
                }
            }
        }
    }
}

@Composable
private fun ProbeCard(probe: ColorProbe, onClose: () -> Unit, modifier: Modifier) {
    val language = LocalConfiguration.current.locales[0].language
    Surface(
        modifier.padding(12.dp).fillMaxWidth(),
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

@Composable
private fun shortName(type: CvdType): String = stringResource(
    when (type) {
        CvdType.DEUTAN -> R.string.type_deutan_short
        CvdType.PROTAN -> R.string.type_protan_short
        CvdType.TRITAN -> R.string.type_tritan_short
    },
)

private fun timestamp(): String = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(Date())
