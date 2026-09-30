package dev.colorgap.app.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import dev.colorgap.app.AppLanguage
import dev.colorgap.app.R
import dev.colorgap.colorcore.CvdProfile
import dev.colorgap.colorcore.CvdType
import kotlin.math.roundToInt

@Composable
fun ProfileDialog(
    initial: CvdProfile,
    initialLanguage: AppLanguage,
    onDismiss: () -> Unit,
    onConfirm: (CvdProfile, AppLanguage) -> Unit,
) {
    var type by remember { mutableStateOf(initial.type) }
    var language by remember { mutableStateOf(initialLanguage) }
    var severity by remember { mutableFloatStateOf(initial.severity.toFloat()) }
    val types = listOf(
        CvdType.DEUTAN to R.string.type_deutan,
        CvdType.PROTAN to R.string.type_protan,
        CvdType.TRITAN to R.string.type_tritan,
    )

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.settings_title)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text(stringResource(R.string.profile_title), style = MaterialTheme.typography.titleMedium)
                Column(Modifier.selectableGroup()) {
                    types.forEach { (t, label) ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .heightIn(min = 56.dp)
                                .selectable(selected = type == t, onClick = { type = t }, role = Role.RadioButton),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = type == t, onClick = null)
                            Spacer(Modifier.size(12.dp))
                            Text(stringResource(label), style = MaterialTheme.typography.titleMedium)
                        }
                    }
                }
                Spacer(Modifier.size(12.dp))
                Text(stringResource(R.string.severity, (severity * 100).roundToInt()), style = MaterialTheme.typography.titleMedium)
                // 5 % steps: fine enough for anomalous trichromacy, easy to hit with a thumb.
                Slider(value = severity, onValueChange = { severity = it }, steps = 19)
                Text(stringResource(R.string.severity_hint), style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.size(20.dp))
                LanguagePicker(language, onSelect = { language = it })
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(CvdProfile(type, severity.toDouble().coerceIn(0.0, 1.0)), language) }) {
                Text(stringResource(R.string.ok))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

/**
 * Language choice. The label is bilingual and each language is named in
 * itself, so it can be found whatever language the app is currently in.
 */
@Composable
private fun LanguagePicker(selected: AppLanguage, onSelect: (AppLanguage) -> Unit) {
    val options = listOf(
        AppLanguage.SYSTEM to stringResource(R.string.language_system),
        AppLanguage.ENGLISH to "English",
        AppLanguage.ITALIAN to "Italiano",
    )
    Text(stringResource(R.string.language_title), style = MaterialTheme.typography.titleMedium)
    Spacer(Modifier.size(8.dp))
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        options.forEachIndexed { i, (lang, label) ->
            SegmentedButton(
                selected = selected == lang,
                onClick = { onSelect(lang) },
                shape = SegmentedButtonDefaults.itemShape(i, options.size),
                modifier = Modifier.heightIn(min = 56.dp),
            ) { Text(label, maxLines = 1) }
        }
    }
}
