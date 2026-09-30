package dev.colorgap.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.colorgap.app.MainViewModel
import dev.colorgap.app.R
import dev.colorgap.app.ViewMode

/** A still image (gallery photo or frozen camera frame): zoom, tap to name colors, export. */
@Composable
fun PhotoScreen(vm: MainViewModel, onCamera: () -> Unit, onGallery: () -> Unit, onExport: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .background(Color.Black),
        ) {
            vm.photo?.let { photo ->
                PhotoCanvas(
                    photo = photo,
                    overlay = vm.overlay,
                    mode = vm.mode,
                    split = vm.split,
                    probe = vm.probe,
                    onTap = vm::tapAt,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            vm.probe?.let {
                ProbeCard(it, onClose = vm::dismissProbe, onDetails = { vm.showColorDetail(it.realArgb) }, Modifier.align(Alignment.TopCenter))
            }
            if (vm.busy) BusyIndicator(Modifier.align(Alignment.Center))
        }
        Surface(tonalElevation = 3.dp) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                ModeSelector(vm.mode, vm::selectMode)
                if (vm.mode == ViewMode.HEATMAP) HeatLegend(vm.profile.type)
                ModeSlider(vm.mode, vm.threshold, vm.criticalFraction, vm.split, vm::updateThreshold, vm::updateSplit)
                Text(stringResource(R.string.tap_hint), style = MaterialTheme.typography.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    // Back to the live camera: a square button, so the row fits small screens.
                    val cameraLabel = stringResource(R.string.camera)
                    OutlinedButton(
                        onClick = onCamera,
                        contentPadding = PaddingValues(0.dp),
                        modifier = Modifier.size(BigTouch).semantics { contentDescription = cameraLabel },
                    ) {
                        Text("←", style = MaterialTheme.typography.headlineSmall)
                    }
                    OutlinedButton(onClick = onGallery, modifier = Modifier.weight(1f).heightIn(min = BigTouch)) {
                        Text(stringResource(R.string.gallery), maxLines = 1)
                    }
                    Button(
                        onClick = onExport,
                        enabled = vm.photo != null,
                        modifier = Modifier.weight(1f).heightIn(min = BigTouch),
                    ) {
                        Text(stringResource(R.string.export), maxLines = 1)
                    }
                }
            }
        }
    }
}

@Composable
private fun BusyIndicator(modifier: Modifier) {
    Surface(modifier, shape = RoundedCornerShape(16.dp), tonalElevation = 6.dp) {
        Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(Modifier.size(32.dp))
            Spacer(Modifier.width(16.dp))
            Text(stringResource(R.string.analyzing), style = MaterialTheme.typography.titleMedium)
        }
    }
}
