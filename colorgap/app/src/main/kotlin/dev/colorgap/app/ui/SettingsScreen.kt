package dev.colorgap.app.ui

import android.app.Activity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.colorgap.app.AppLanguage
import dev.colorgap.app.MainViewModel
import dev.colorgap.app.R
import dev.colorgap.colorcore.CvdProfile

/** Full-screen settings; every change applies (and is saved) immediately. */
@Composable
fun SettingsScreen(vm: MainViewModel, gpuAvailable: Boolean, onBack: () -> Unit) {
    val activity = LocalContext.current as Activity
    // Local while dragging; the profile (and any re-analysis) updates on release.
    var severity by remember(vm.profile) { mutableFloatStateOf(vm.profile.severity.toFloat()) }
    val version = remember {
        runCatching { activity.packageManager.getPackageInfo(activity.packageName, 0).versionName }.getOrNull() ?: ""
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
                    stringResource(R.string.settings_title),
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.semantics { heading() },
                )

                Section(stringResource(R.string.profile_title))
                TypePicker(vm.profile.type, onSelect = { vm.updateProfile(vm.profile.copy(type = it)) })
                SeverityControl(severity, onChange = { severity = it }, onChangeFinished = {
                    vm.updateProfile(CvdProfile(vm.profile.type, severity.toDouble().coerceIn(0.0, 1.0)))
                })

                Section(stringResource(R.string.section_display))
                SwitchRow(
                    title = stringResource(R.string.highlight_color_shifts),
                    hint = stringResource(R.string.highlight_color_shifts_hint),
                    checked = vm.highlightColorShifts,
                    onChange = vm::updateHighlightColorShifts,
                )
                OutlinedButton(onClick = vm::resetDisplay, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
                    Text(stringResource(R.string.reset_display))
                }

                Section(stringResource(R.string.section_engine))
                if (gpuAvailable) {
                    SwitchRow(
                        title = stringResource(R.string.use_gpu),
                        hint = stringResource(R.string.use_gpu_hint),
                        checked = vm.preferGpu,
                        onChange = vm::updatePreferGpu,
                    )
                } else {
                    Text(stringResource(R.string.gpu_unavailable), style = MaterialTheme.typography.bodyMedium)
                }

                Section(stringResource(R.string.language_title))
                LanguagePicker(AppLanguage.current(activity), onSelect = { AppLanguage.apply(activity, it) }, showTitle = false)

                Section(stringResource(R.string.section_about))
                Text(stringResource(R.string.about_how), style = MaterialTheme.typography.bodyMedium)
                Text(stringResource(R.string.privacy_note), style = MaterialTheme.typography.bodyMedium)
                Text(stringResource(R.string.version, version), style = MaterialTheme.typography.bodySmall)
            }
            // Back sits at the bottom, under the thumb (the system back gesture works too).
            Button(
                onClick = onBack,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 12.dp)
                    .heightIn(min = BigTouch),
            ) {
                Text(stringResource(R.string.done), style = MaterialTheme.typography.titleMedium)
            }
        }
    }
}

@Composable
private fun Section(title: String) {
    Spacer(Modifier.size(8.dp))
    HorizontalDivider()
    Text(
        title,
        style = MaterialTheme.typography.titleLarge,
        modifier = Modifier.semantics { heading() },
    )
}

/** A whole-row switch: the label is part of the touch target and read with the state. */
@Composable
private fun SwitchRow(title: String, hint: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .toggleable(value = checked, onValueChange = onChange, role = Role.Switch),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(hint, style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.size(12.dp))
        Switch(checked = checked, onCheckedChange = null)
    }
}
