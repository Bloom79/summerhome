package dev.colorgap.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.colorgap.app.AppLanguage
import dev.colorgap.app.R
import dev.colorgap.colorcore.CvdType
import kotlin.math.roundToInt

/** The three deficiency types as large cards, each with a plain-language description. */
@Composable
internal fun TypePicker(selected: CvdType, onSelect: (CvdType) -> Unit) {
    val types = listOf(
        Triple(CvdType.DEUTAN, R.string.type_deutan, R.string.deutan_desc),
        Triple(CvdType.PROTAN, R.string.type_protan, R.string.protan_desc),
        Triple(CvdType.TRITAN, R.string.type_tritan, R.string.tritan_desc),
    )
    Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        types.forEach { (type, title, description) ->
            val isSelected = type == selected
            Surface(
                shape = RoundedCornerShape(16.dp),
                // Selection is shown by a thick border and the radio button, not by color alone.
                border = BorderStroke(if (isSelected) 3.dp else 1.dp, MaterialTheme.colorScheme.run { if (isSelected) primary else outline }),
                tonalElevation = if (isSelected) 4.dp else 0.dp,
                modifier = Modifier
                    .fillMaxWidth()
                    .selectable(selected = isSelected, onClick = { onSelect(type) }, role = Role.RadioButton),
            ) {
                Row(Modifier.padding(12.dp).heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(selected = isSelected, onClick = null)
                    Spacer(Modifier.size(12.dp))
                    Column {
                        Text(stringResource(title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text(stringResource(description), style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}

@Composable
internal fun SeverityControl(severity: Float, onChange: (Float) -> Unit, onChangeFinished: (() -> Unit)? = null) {
    val label = stringResource(R.string.severity, (severity * 100).roundToInt())
    Text(label, style = MaterialTheme.typography.titleMedium)
    // 5 % steps: fine enough for anomalous trichromacy, easy to hit with a thumb.
    Slider(
        value = severity,
        onValueChange = onChange,
        onValueChangeFinished = onChangeFinished,
        steps = 19,
        modifier = Modifier.semantics { contentDescription = label },
    )
    Text(stringResource(R.string.severity_hint), style = MaterialTheme.typography.bodySmall)
}

/**
 * Language choice. The label is bilingual and each language is named in
 * itself, so it can be found whatever language the app is currently in.
 */
@Composable
internal fun LanguagePicker(selected: AppLanguage, onSelect: (AppLanguage) -> Unit, showTitle: Boolean = true) {
    val options = listOf(
        AppLanguage.SYSTEM to stringResource(R.string.language_system),
        AppLanguage.ENGLISH to "English",
        AppLanguage.ITALIAN to "Italiano",
    )
    if (showTitle) {
        Text(stringResource(R.string.language_title), style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.size(8.dp))
    }
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
