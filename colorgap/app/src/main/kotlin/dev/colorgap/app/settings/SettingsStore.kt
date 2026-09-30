package dev.colorgap.app.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.io.IOException

private val Context.settingsDataStore by preferencesDataStore(name = "settings")

/** Persists [AppSettings] in DataStore (on-device only; backups are disabled in the manifest). */
class SettingsStore(private val dataStore: DataStore<Preferences>) {
    constructor(context: Context) : this(context.applicationContext.settingsDataStore)

    val settings: Flow<AppSettings> = dataStore.data
        // A corrupted or unreadable file must not break the app: start from defaults.
        .catch { e -> if (e is IOException) emit(emptyPreferences()) else throw e }
        .map(SettingsCodec::decode)

    suspend fun load(): AppSettings = settings.first()

    suspend fun save(s: AppSettings) {
        dataStore.edit { SettingsCodec.encode(s, it) }
    }
}
