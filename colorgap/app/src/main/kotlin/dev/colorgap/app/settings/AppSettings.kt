package dev.colorgap.app.settings

import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import dev.colorgap.app.ViewMode
import dev.colorgap.colorcore.AnalysisConfig
import dev.colorgap.colorcore.CvdProfile
import dev.colorgap.colorcore.CvdType

/** Everything the app remembers between launches (the language is kept by Android, see AppLanguage). */
data class AppSettings(
    /** False until the welcome screen has been completed. */
    val onboarded: Boolean = false,
    val profile: CvdProfile = CvdProfile(),
    val mode: ViewMode = ViewMode.HEATMAP,
    val threshold: Float = DEFAULT_THRESHOLD,
    /**
     * Also highlight areas whose color merely looks different (color loss),
     * not only the edges that disappear (lost contrast).
     */
    val highlightColorShifts: Boolean = true,
    /** Use the GPU for the live camera when the device supports it. */
    val preferGpu: Boolean = true,
) {
    /** The analysis tuning these settings imply. */
    val analysisConfig: AnalysisConfig
        get() = AnalysisConfig(colorWeight = if (highlightColorShifts) COLOR_WEIGHT else 0f)

    companion object {
        const val DEFAULT_THRESHOLD = AnalysisConfig.DEFAULT_THRESHOLD
        const val MIN_THRESHOLD = 0.05f
        const val MAX_THRESHOLD = 0.95f
        private val COLOR_WEIGHT = AnalysisConfig().colorWeight
    }
}

/**
 * AppSettings ↔ DataStore Preferences. Decoding never fails: missing,
 * unknown or out-of-range values fall back to the defaults.
 */
object SettingsCodec {
    private val ONBOARDED = booleanPreferencesKey("onboarded")
    private val CVD_TYPE = stringPreferencesKey("cvd_type")
    private val SEVERITY = floatPreferencesKey("severity")
    private val MODE = stringPreferencesKey("mode")
    private val THRESHOLD = floatPreferencesKey("threshold")
    private val COLOR_SHIFTS = booleanPreferencesKey("highlight_color_shifts")
    private val PREFER_GPU = booleanPreferencesKey("prefer_gpu")

    fun decode(p: Preferences): AppSettings {
        val d = AppSettings()
        val type = p[CVD_TYPE]?.let { name -> CvdType.entries.firstOrNull { it.name == name } } ?: d.profile.type
        val severity = p[SEVERITY]?.takeIf { it.isFinite() }?.coerceIn(0f, 1f)?.toDouble() ?: d.profile.severity
        return AppSettings(
            onboarded = p[ONBOARDED] ?: d.onboarded,
            profile = CvdProfile(type, severity),
            mode = p[MODE]?.let { name -> ViewMode.entries.firstOrNull { it.name == name } } ?: d.mode,
            threshold = p[THRESHOLD]?.takeIf { it.isFinite() }
                ?.coerceIn(AppSettings.MIN_THRESHOLD, AppSettings.MAX_THRESHOLD) ?: d.threshold,
            highlightColorShifts = p[COLOR_SHIFTS] ?: d.highlightColorShifts,
            preferGpu = p[PREFER_GPU] ?: d.preferGpu,
        )
    }

    fun encode(s: AppSettings, p: MutablePreferences) {
        p[ONBOARDED] = s.onboarded
        p[CVD_TYPE] = s.profile.type.name
        p[SEVERITY] = s.profile.severity.toFloat()
        p[MODE] = s.mode.name
        p[THRESHOLD] = s.threshold
        p[COLOR_SHIFTS] = s.highlightColorShifts
        p[PREFER_GPU] = s.preferGpu
    }
}
