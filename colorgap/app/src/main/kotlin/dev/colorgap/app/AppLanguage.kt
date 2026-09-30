package dev.colorgap.app

import android.app.Activity
import android.app.LocaleManager
import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.os.LocaleList
import java.util.Locale

/**
 * In-app language: follow the system, or force English / Italian.
 *
 * Android 13+ has per-app languages built in (LocaleManager; the choice also
 * appears in the system settings thanks to locales_config.xml). Older
 * versions keep the choice in SharedPreferences and apply it by wrapping the
 * activity's base context.
 */
enum class AppLanguage(val tag: String?) {
    SYSTEM(null),
    ENGLISH("en"),
    ITALIAN("it");

    companion object {
        private const val PREFS = "app_language"
        private const val KEY = "tag"

        fun current(context: Context): AppLanguage {
            val tag = if (Build.VERSION.SDK_INT >= 33) {
                context.getSystemService(LocaleManager::class.java).applicationLocales.get(0)?.language
            } else {
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
            }
            return entries.firstOrNull { it.tag != null && it.tag == tag } ?: SYSTEM
        }

        fun apply(activity: Activity, language: AppLanguage) {
            if (language == current(activity)) return
            if (Build.VERSION.SDK_INT >= 33) {
                // The system persists the choice and recreates the activity.
                activity.getSystemService(LocaleManager::class.java).applicationLocales =
                    language.tag?.let { LocaleList.forLanguageTags(it) } ?: LocaleList.getEmptyLocaleList()
            } else {
                activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, language.tag).apply()
                activity.recreate()
            }
        }

        /** For Activity.attachBaseContext on Android < 13. */
        fun wrap(base: Context): Context {
            if (Build.VERSION.SDK_INT >= 33) return base
            val tag = base.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return base
            val config = Configuration(base.resources.configuration)
            config.setLocales(LocaleList(Locale.forLanguageTag(tag)))
            return base.createConfigurationContext(config)
        }
    }
}
