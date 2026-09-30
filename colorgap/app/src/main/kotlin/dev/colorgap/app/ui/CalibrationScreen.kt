package dev.colorgap.app.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.colorgap.app.MainViewModel
import dev.colorgap.app.R
import dev.colorgap.colorcore.CalibrationResult
import dev.colorgap.colorcore.CvdProfile
import dev.colorgap.colorcore.Plate
import dev.colorgap.colorcore.PlateSpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val PLATE_PX = 720

/**
 * The calibration test: intro, then one plate at a time (four digits or "no
 * number"), then the estimated profile, which the user may apply.
 */
@Composable
fun CalibrationScreen(vm: MainViewModel, onClose: () -> Unit) {
    // Reading the step makes this recompose after each answer.
    val step = vm.calibrationStep
    val session = vm.calibration
    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 20.dp, vertical = 16.dp)) {
            when {
                session == null -> Intro(onStart = vm::startCalibration, onCancel = onClose)
                session.result != null -> ResultView(
                    session.result!!,
                    onApply = { vm.applyCalibration(it); onClose() },
                    onRetry = vm::startCalibration,
                    onClose = onClose,
                )
                else -> session.current?.let { plate ->
                    PlateQuestion(
                        plate,
                        progress = (session.answered.toFloat() / session.expectedTotal).coerceIn(0f, 0.95f),
                        number = step + 1,
                        onAnswer = vm::answerCalibration,
                        onCancel = onClose,
                    )
                }
            }
        }
    }
}

@Composable
private fun Intro(onStart: () -> Unit, onCancel: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Title(stringResource(R.string.calib_title))
            Text(stringResource(R.string.calib_intro), style = MaterialTheme.typography.bodyLarge)
            Text(stringResource(R.string.calib_tips), style = MaterialTheme.typography.bodyLarge)
            Text(stringResource(R.string.calib_disclaimer), style = MaterialTheme.typography.bodySmall)
        }
        Button(onClick = onStart, modifier = Modifier.fillMaxWidth().heightIn(min = BigTouch)) {
            Text(stringResource(R.string.start), style = MaterialTheme.typography.titleMedium)
        }
        TextButton(onClick = onCancel, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text(stringResource(R.string.cancel_test))
        }
    }
}

@Composable
private fun PlateQuestion(plate: PlateSpec, progress: Float, number: Int, onAnswer: (Int?) -> Unit, onCancel: () -> Unit) {
    var image by remember(plate) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(plate) {
        image = withContext(Dispatchers.Default) {
            val p = Plate.generate(plate.figure, plate.background, plate.digit, PLATE_PX, plate.seed)
            Bitmap.createBitmap(p.pixels, PLATE_PX, PLATE_PX, Bitmap.Config.ARGB_8888).asImageBitmap()
        }
    }
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.calib_plate_n, number), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            TextButton(onClick = onCancel, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.cancel_test)) }
        }
        LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth())
        Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
            val bmp = image
            if (bmp == null) {
                CircularProgressIndicator()
            } else {
                Image(
                    bmp,
                    contentDescription = stringResource(R.string.calib_plate_description),
                    filterQuality = FilterQuality.Medium,
                    modifier = Modifier.fillMaxSize().aspectRatio(1f, matchHeightConstraintsFirst = true),
                )
            }
        }
        Text(stringResource(R.string.calib_question), style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        // Answers at the bottom, under the thumb: four digits and "no number".
        for (row in plate.options.chunked(2)) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                for (digit in row) {
                    OutlinedButton(
                        onClick = { onAnswer(digit) },
                        enabled = image != null,
                        modifier = Modifier.weight(1f).heightIn(min = BigTouch),
                    ) { Text(digit.toString(), style = MaterialTheme.typography.headlineSmall) }
                }
            }
        }
        Button(onClick = { onAnswer(null) }, enabled = image != null, modifier = Modifier.fillMaxWidth().heightIn(min = BigTouch)) {
            Text(stringResource(R.string.calib_no_number), style = MaterialTheme.typography.titleMedium)
        }
    }
}

@Composable
private fun ResultView(result: CalibrationResult, onApply: (CvdProfile) -> Unit, onRetry: () -> Unit, onClose: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Title(stringResource(R.string.calib_result_title))
            when (result) {
                is CalibrationResult.Profile -> {
                    Text(profileLabel(result.profile), style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold)
                    Text(stringResource(R.string.calib_result_profile), style = MaterialTheme.typography.bodyLarge)
                    if (!result.typeCertain) Text(stringResource(R.string.calib_type_uncertain), style = MaterialTheme.typography.bodyLarge)
                }
                CalibrationResult.Typical -> Text(stringResource(R.string.calib_result_typical), style = MaterialTheme.typography.bodyLarge)
                CalibrationResult.Unreliable -> Text(stringResource(R.string.calib_result_unreliable), style = MaterialTheme.typography.bodyLarge)
            }
            Text(stringResource(R.string.calib_disclaimer), style = MaterialTheme.typography.bodySmall)
        }
        if (result is CalibrationResult.Profile) {
            Button(onClick = { onApply(result.profile) }, modifier = Modifier.fillMaxWidth().heightIn(min = BigTouch)) {
                Text(stringResource(R.string.calib_apply), style = MaterialTheme.typography.titleMedium)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(top = 8.dp)) {
            OutlinedButton(onClick = onRetry, modifier = Modifier.weight(1f).heightIn(min = 56.dp)) { Text(stringResource(R.string.calib_retry)) }
            OutlinedButton(onClick = onClose, modifier = Modifier.weight(1f).heightIn(min = 56.dp)) { Text(stringResource(R.string.close)) }
        }
    }
}

@Composable
private fun Title(text: String) {
    Text(text, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, modifier = Modifier.semantics { heading() })
}
