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
import dev.colorgap.colorcore.CvdProfile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException

class PhotoViewModel(app: Application) : AndroidViewModel(app) {

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
    var threshold by mutableFloatStateOf(DEFAULT_THRESHOLD)
        private set
    var split by mutableFloatStateOf(0.5f)
        private set
    // In-memory until milestone 5 persists it in DataStore.
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

    init {
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

    fun open(uri: Uri) = runAnalysis {
        try {
            val bitmap = withContext(Dispatchers.IO) {
                PhotoLoader.load(getApplication<Application>().contentResolver, uri, DISPLAY_MAX_SIDE)
            }
            source = bitmap
            analyze(bitmap)
        } catch (e: IOException) {
            message = R.string.open_failed
        } catch (e: SecurityException) {
            message = R.string.open_failed
        }
    }

    fun updateProfile(newProfile: CvdProfile) {
        if (newProfile == profile) return
        profile = newProfile
        val bitmap = source ?: return
        runAnalysis { analyze(bitmap) }
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
        val result = withContext(Dispatchers.Default) { AnalyzedPhoto.analyze(bitmap, profile) }
        photo = result
        overlay = null
        probe = null
        requestRender()
    }

    fun selectMode(newMode: ViewMode) { mode = newMode; requestRender() }

    fun updateThreshold(value: Float) {
        threshold = value
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
        const val DEFAULT_THRESHOLD = 0.35f
    }
}
