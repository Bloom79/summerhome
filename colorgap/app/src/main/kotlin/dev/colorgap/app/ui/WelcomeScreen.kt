package dev.colorgap.app.ui

import android.app.Activity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.colorgap.app.AppLanguage
import dev.colorgap.app.R
import dev.colorgap.colorcore.CvdProfile
import dev.colorgap.colorcore.CvdType

/** First launch: what the app does, the user's color vision, the language. */
@Composable
fun WelcomeScreen(onStart: (CvdProfile) -> Unit, onCalibrate: () -> Unit) {
    val activity = LocalContext.current as Activity
    var type by rememberSaveable { mutableStateOf(CvdType.DEUTAN) }
    var severity by rememberSaveable { mutableFloatStateOf(1f) }
    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Column(
                Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(stringResource(R.string.welcome_title), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Text(stringResource(R.string.welcome_text), style = MaterialTheme.typography.bodyLarge)
                Spacer(Modifier.size(4.dp))
                Text(stringResource(R.string.profile_title), style = MaterialTheme.typography.titleLarge)
                TypePicker(type, onSelect = { type = it })
                Text(stringResource(R.string.dont_know), style = MaterialTheme.typography.bodyMedium)
                OutlinedButton(onClick = onCalibrate, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
                    Text(stringResource(R.string.calib_open))
                }
                Spacer(Modifier.size(4.dp))
                SeverityControl(severity, onChange = { severity = it })
                Spacer(Modifier.size(4.dp))
                // Applied at once (the screen is recreated in the new language; choices are kept).
                LanguagePicker(AppLanguage.current(activity), onSelect = { AppLanguage.apply(activity, it) })
                Spacer(Modifier.size(4.dp))
                Text(stringResource(R.string.privacy_note), style = MaterialTheme.typography.bodyMedium)
            }
            // The main action sits at the bottom, under the thumb.
            Button(
                onClick = { onStart(CvdProfile(type, severity.toDouble().coerceIn(0.0, 1.0))) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 12.dp)
                    .heightIn(min = BigTouch),
            ) {
                Text(stringResource(R.string.start), style = MaterialTheme.typography.titleMedium)
            }
        }
    }
}
