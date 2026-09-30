package dev.colorgap.app.settings

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.mutablePreferencesOf
import androidx.datastore.preferences.core.stringPreferencesKey
import dev.colorgap.app.ViewMode
import dev.colorgap.colorcore.CvdProfile
import dev.colorgap.colorcore.CvdType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals

class SettingsStoreTest {
    @Test
    fun `fresh install gives the defaults`() {
        assertEquals(AppSettings(), SettingsCodec.decode(mutablePreferencesOf()))
    }

    @Test
    fun `settings survive a round trip through DataStore on disk`() = runBlocking<Unit> {
        val dir = Files.createTempDirectory("settings").toFile()
        val saved = AppSettings(
            onboarded = true,
            profile = CvdProfile(CvdType.TRITAN, 0.45),
            mode = ViewMode.STRIPES,
            threshold = 0.6f,
            highlightColorShifts = false,
            preferGpu = false,
        )
        val job1 = SupervisorJob()
        SettingsStore(PreferenceDataStoreFactory.create(scope = CoroutineScope(Dispatchers.IO + job1)) { dir.resolve("s.preferences_pb") }).save(saved)
        job1.cancelAndJoin() // only one DataStore may be active per file

        // A new DataStore instance on the same file, as after an app restart.
        val job2 = SupervisorJob()
        val loaded = SettingsStore(PreferenceDataStoreFactory.create(scope = CoroutineScope(Dispatchers.IO + job2)) { dir.resolve("s.preferences_pb") }).load()
        job2.cancelAndJoin()
        assertEquals(saved.copy(profile = CvdProfile(CvdType.TRITAN, 0.45f.toDouble())), loaded)
        dir.deleteRecursively()
    }

    @Test
    fun `invalid stored values fall back to defaults or are clamped`() {
        val p = mutablePreferencesOf(
            stringPreferencesKey("cvd_type") to "MONOCHROMAT",
            floatPreferencesKey("severity") to 7f,
            stringPreferencesKey("mode") to "???",
            floatPreferencesKey("threshold") to Float.NaN,
        )
        val s = SettingsCodec.decode(p)
        assertEquals(CvdType.DEUTAN, s.profile.type)
        assertEquals(1.0, s.profile.severity)
        assertEquals(ViewMode.HEATMAP, s.mode)
        assertEquals(AppSettings.DEFAULT_THRESHOLD, s.threshold)
    }

    @Test
    fun `color shifts setting drives the analysis weight`() {
        assertEquals(0.6f, AppSettings().analysisConfig.colorWeight)
        assertEquals(0f, AppSettings(highlightColorShifts = false).analysisConfig.colorWeight)
    }
}
