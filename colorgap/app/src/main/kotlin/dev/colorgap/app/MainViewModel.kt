package dev.colorgap.app

import android.app.Application
import android.graphics.Bitmap
import android.net.Uri
import androidx.annotation.StringRes
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.colorgap.app.settings.AppSettings
import dev.colorgap.app.settings.SettingsStore
import dev.colorgap.colorcore.CvdProfile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException

/**
 * App state shared by the live camera and the photo screen: the profile, view
 * mode and threshold apply to both; a photo (from the gallery or a frozen
 * camera frame) is shown on top of the camera while [showingPhoto].
 */
class MainViewModel(app: Application) : AndroidViewModel(app) {

    private val store = SettingsStore(app)

    /** False until the saved settings are read (the UI waits, to avoid flashing the welcome screen). */
    var settingsLoaded by mutableStateOf(false)
        private set
    var onboarded by mutableStateOf(false)
        private set
    var highlightColorShifts by mutableStateOf(true)
        private set

    /** True while the photo screen is shown (also during its first analysis). */
    var showingPhoto by mutableStateOf(false)
        private set

    /** Live engine: GPU unless the user switched to CPU or the GPU pipeline failed on this device. */
    var preferGpu by mutableStateOf(true)
        private set
    var gpuFailed by mutableStateOf(false)
        private set

    /** Color shown in the detail screen (big swatches, what changes, plate), or null. */
    var detailColor by mutableStateOf<Int?>(null)
        private set

    /** Point named continuously on the live camera, in frame pixels. */
    var liveProbePoint by mutableStateOf<Pair<Int, Int>?>(null)
        private set

    var photo by mutableStateOf<AnalyzedPhoto?>(null)
        private set

    /** Heatmap/stripes rendering of [photo] for the current mode and threshold. */
    var overlay by mutableStateOf<ImageBitmap?>(null)
        private set
    var criticalFraction by mutableFloatStateOf(0f)
        private set
    var busy by mutableStateOf(false)
        private set
    var mode by mutableStateOf(ViewMode.HEATMAP)
        private set
    var threshold by mutableFloatStateOf(AppSettings.DEFAULT_THRESHOLD)
        private set
    var split by mutableFloatStateOf(0.5f)
        private set
    var profile by mutableStateOf(CvdProfile())
        private set
    var probe by mutableStateOf<ColorProbe?>(null)
        private set

    /** One-shot message for the snackbar; cleared by [messageShown]. */
    @get:StringRes
    var message by mutableStateOf<Int?>(null)
        private set

    private var source: Bitmap? = null
    private var analysisJob: Job? = null

    private data class RenderKey(val photo: AnalyzedPhoto, val mode: ViewMode, val threshold: Float)
    private val renderRequests = MutableStateFlow<RenderKey?>(null)
    private val pendingSave = MutableStateFlow<AppSettings?>(null)

    /** The persisted part of the state. */
    val settings: AppSettings
        get() = AppSettings(onboarded, profile, mode, threshold, highlightColorShifts, preferGpu)

    init {
        viewModelScope.launch {
            val saved = store.load()
            onboarded = saved.onboarded
            profile = saved.profile
            mode = saved.mode
            threshold = saved.threshold
            highlightColorShifts = saved.highlightColorShifts
            preferGpu = saved.preferGpu
            settingsLoaded = true
        }
        // Save shortly after the last change: a moving slider writes once.
        viewModelScope.launch {
            pendingSave.filterNotNull().collectLatest {
                delay(SAVE_DELAY_MS)
                store.save(it)
            }
        }

        // Re-render on every change, dropping stale renders while the slider moves.
        viewModelScope.launch {
            renderRequests.filterNotNull().collectLatest { key ->
                val (image, fraction) = withContext(Dispatchers.Default) {
                    // Split view is composed on screen from the two full images.
                    val image = if (key.mode == ViewMode.SPLIT) null else {
                        val px = key.photo.render(key.mode, key.threshold, 0.5f)
                        AnalyzedPhoto.toBitmap(px, key.photo.width, key.photo.height).asImageBitmap()
                    }
                    image to key.photo.criticalFraction(key.threshold)
                }
                if (image != null) overlay = image
                criticalFraction = fraction
            }
        }
    }

    fun open(uri: Uri) {
        showingPhoto = true
        runAnalysis {
            try {
                val bitmap = withContext(Dispatchers.IO) {
                    PhotoLoader.load(getApplication<Application>().contentResolver, uri, DISPLAY_MAX_SIDE)
                }
                source = bitmap
                analyze(bitmap)
            } catch (e: IOException) {
                message = R.string.open_failed
                if (photo == null) showingPhoto = false
            } catch (e: SecurityException) {
                message = R.string.open_failed
                if (photo == null) showingPhoto = false
            }
        }
    }

    /** Freeze frame: analyze a copy of the current camera frame as a photo (zoom, tap, export). */
    fun showFrozen(frame: Bitmap) {
        showingPhoto = true
        source = frame
        runAnalysis { analyze(frame) }
    }

    /** Back to the live camera. */
    fun closePhoto() {
        analysisJob?.cancel()
        busy = false
        showingPhoto = false
        photo = null
        overlay = null
        probe = null
        source = null
    }

    fun setLiveProbe(point: Pair<Int, Int>?) { liveProbePoint = point }

    fun showColorDetail(argb: Int) { detailColor = argb }

    fun closeColorDetail() { detailColor = null }

    fun updatePreferGpu(value: Boolean) {
        if (value == preferGpu) return
        preferGpu = value
        liveProbePoint = null // frame coordinates differ between the two engines
        save()
    }

    fun toggleEngine() = updatePreferGpu(!preferGpu)

    /** The welcome screen is done: remember the profile and don't show it again. */
    fun completeOnboarding(chosen: CvdProfile) {
        onboarded = true
        updateProfile(chosen)
        save()
    }

    fun updateHighlightColorShifts(value: Boolean) {
        if (value == highlightColorShifts) return
        highlightColorShifts = value
        save()
        reanalyzePhoto()
    }

    /** Back to the default view mode, threshold and highlighting (the profile is kept). */
    fun resetDisplay() {
        val d = AppSettings()
        mode = d.mode
        updateThreshold(d.threshold)
        updateHighlightColorShifts(d.highlightColorShifts)
        save()
        requestRender()
    }

    private fun save() {
        if (settingsLoaded) pendingSave.value = settings
    }

    private fun reanalyzePhoto() {
        val bitmap = source ?: return
        runAnalysis { analyze(bitmap) }
    }

    fun markGpuFailed() { gpuFailed = true }

    fun updateProfile(newProfile: CvdProfile) {
        if (newProfile == profile) return
        profile = newProfile
        save()
        reanalyzePhoto()
    }

    /** Runs [block] as the only analysis; a newer one cancels it, and only the latest clears [busy]. */
    private fun runAnalysis(block: suspend () -> Unit) {
        analysisJob?.cancel()
        busy = true
        lateinit var job: Job
        job = viewModelScope.launch {
            try { block() } finally { if (analysisJob === job) busy = false }
        }
        analysisJob = job
    }

    private suspend fun analyze(bitmap: Bitmap) {
        val result = withContext(Dispatchers.Default) { AnalyzedPhoto.analyze(bitmap, profile, settings.analysisConfig) }
        photo = result
        overlay = null
        probe = null
        requestRender()
    }

    fun selectMode(newMode: ViewMode) {
        mode = newMode
        save()
        requestRender()
    }

    fun updateThreshold(value: Float) {
        threshold = value
        save()
        probe = probe?.let { photo?.probe(it.x, it.y, value) }
        requestRender()
    }

    fun updateSplit(value: Float) { split = value }

    fun tapAt(x: Int, y: Int) { probe = photo?.probe(x, y, threshold) }

    fun dismissProbe() { probe = null }

    fun export(target: Uri) {
        val current = photo ?: return
        val mode = mode; val threshold = threshold; val split = split
        viewModelScope.launch {
            message = try {
                withContext(Dispatchers.IO) {
                    val bitmap = AnalyzedPhoto.toBitmap(current.render(mode, threshold, split), current.width, current.height)
                    getApplication<Application>().contentResolver.openOutputStream(target)?.use {
                        if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) throw IOException("PNG encoding failed")
                    } ?: throw IOException("Cannot write $target")
                    bitmap.recycle()
                }
                R.string.exported
            } catch (e: IOException) {
                R.string.export_failed
            } catch (e: SecurityException) {
                R.string.export_failed
            }
        }
    }

    fun messageShown() { message = null }

    private fun requestRender() {
        val p = photo ?: return
        renderRequests.value = RenderKey(p, mode, threshold)
    }

    companion object {
        /** Long side of the displayed/exported image. */
        const val DISPLAY_MAX_SIDE = 1600
        private const val SAVE_DELAY_MS = 300L
    }
}
