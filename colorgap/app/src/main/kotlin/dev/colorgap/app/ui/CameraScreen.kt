package dev.colorgap.app.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.provider.Settings
import android.util.Size
import android.view.Surface as ViewSurface
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import dev.colorgap.app.MainViewModel
import dev.colorgap.app.R
import dev.colorgap.app.ViewMode
import dev.colorgap.app.live.LiveAnalyzer
import dev.colorgap.app.live.LiveFrame
import dev.colorgap.app.live.LiveSettings
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/** Live camera (CPU path): the analyzed frames themselves are shown, so image and overlay always match. */
@Composable
fun CameraScreen(vm: MainViewModel, onGallery: () -> Unit) {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(hasCameraPermission(context)) }
    var asked by rememberSaveable { mutableStateOf(false) }
    var unavailable by remember { mutableStateOf(false) }
    val requestPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        granted = it
        asked = true
    }
    // Ask once on first launch; re-check when coming back from the system settings.
    LaunchedEffect(Unit) { if (!granted && !asked) requestPermission.launch(Manifest.permission.CAMERA) }
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) granted = hasCameraPermission(context)
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val live = remember { LiveAnalyzer() }
    val settings = LiveSettings(vm.profile, vm.mode, vm.threshold, vm.liveProbePoint)
    SideEffect { live.settings = settings }
    val frame by live.frames.collectAsState()

    Column(Modifier.fillMaxSize()) {
        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .background(Color.Black),
        ) {
            if (granted && !unavailable) {
                CameraBinding(live, onUnavailable = { unavailable = true })
                LiveView(frame, vm.split, onTap = vm::setLiveProbe, Modifier.fillMaxSize())
                frame?.probe?.let { ProbeCard(it, onClose = { vm.setLiveProbe(null) }, Modifier.align(Alignment.TopCenter)) }
                frame?.let { StatusChip(it, Modifier.align(Alignment.BottomCenter)) }
            } else if (unavailable) {
                Text(
                    stringResource(R.string.camera_unavailable),
                    color = Color.White,
                    style = MaterialTheme.typography.titleMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.align(Alignment.Center).padding(32.dp),
                )
            } else {
                PermissionPrompt(
                    onAllow = { requestPermission.launch(Manifest.permission.CAMERA) },
                    showSettings = asked,
                    modifier = Modifier.align(Alignment.Center),
                )
            }
        }
        Surface(tonalElevation = 3.dp) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                ModeSelector(vm.mode, vm::selectMode)
                ModeSlider(vm.mode, vm.threshold, frame?.criticalFraction ?: 0f, vm.split, vm::updateThreshold, vm::updateSplit)
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(onClick = onGallery, modifier = Modifier.weight(1f).heightIn(min = BigTouch)) {
                        Text(stringResource(R.string.gallery), style = MaterialTheme.typography.titleMedium)
                    }
                    Button(
                        onClick = { frame?.let { vm.showFrozen(it.frame.copy(Bitmap.Config.ARGB_8888, false)) } },
                        enabled = frame != null,
                        modifier = Modifier.weight(1f).heightIn(min = BigTouch),
                    ) {
                        Text(stringResource(R.string.freeze), style = MaterialTheme.typography.titleMedium)
                    }
                }
            }
        }
    }
}

/** Binds an RGBA ImageAnalysis use case (no Preview: we draw the analyzed frames) to the lifecycle. */
@Composable
private fun CameraBinding(live: LiveAnalyzer, onUnavailable: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val rotation = LocalView.current.display?.rotation ?: ViewSurface.ROTATION_0
    DisposableEffect(lifecycleOwner, rotation) {
        val executor = Executors.newSingleThreadExecutor()
        val analysis = ImageAnalysis.Builder()
            .setResolutionSelector(
                ResolutionSelector.Builder()
                    .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                    .setResolutionStrategy(
                        ResolutionStrategy(Size(1280, 960), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER),
                    )
                    .build(),
            )
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
            .setTargetRotation(rotation)
            .build()
        analysis.setAnalyzer(executor, live)

        val future = ProcessCameraProvider.getInstance(context)
        var provider: ProcessCameraProvider? = null
        var disposed = false
        future.addListener({
            if (disposed) return@addListener
            try {
                val cameras = future.get()
                val selector = listOf(CameraSelector.DEFAULT_BACK_CAMERA, CameraSelector.DEFAULT_FRONT_CAMERA)
                    .firstOrNull { cameras.hasCamera(it) }
                if (selector == null) {
                    onUnavailable()
                    return@addListener
                }
                cameras.unbindAll()
                cameras.bindToLifecycle(lifecycleOwner, selector, analysis)
                provider = cameras
            } catch (e: Exception) {
                // CameraX reports missing/busy cameras through several exception types.
                onUnavailable()
            }
        }, ContextCompat.getMainExecutor(context))

        onDispose {
            disposed = true
            provider?.unbind(analysis)
            analysis.clearAnalyzer()
            executor.shutdown()
        }
    }
}

@Composable
private fun LiveView(frame: LiveFrame?, split: Float, onTap: (Pair<Int, Int>) -> Unit, modifier: Modifier) {
    val current by rememberUpdatedState(frame)
    val description = stringResource(R.string.camera_description)
    Box(modifier.clipToBounds()) {
        Canvas(
            Modifier
                .fillMaxSize()
                .semantics { contentDescription = description }
                .pointerInput(Unit) {
                    detectTapGestures { p ->
                        val f = current ?: return@detectTapGestures
                        val fit = FitRect.of(size.width.toFloat(), size.height.toFloat(), f.width, f.height)
                        screenToImagePixel(p.x, p.y, fit, Zoom())?.let(onTap)
                    }
                },
        ) {
            val f = frame ?: return@Canvas
            val fit = FitRect.of(size.width, size.height, f.width, f.height)
            val layerSize = IntSize(f.analysisWidth, f.analysisHeight)
            when (f.mode) {
                ViewMode.HEATMAP -> {
                    drawPhoto(f.frameImage, fit, filterQuality = FilterQuality.Low)
                    drawPhoto(f.layer, fit, layerSize, FilterQuality.Low)
                }
                ViewMode.STRIPES -> {
                    drawPhoto(f.frameImage, fit, filterQuality = FilterQuality.Low)
                    drawMaskedStripes(f.layer, layerSize, fit)
                }
                ViewMode.SPLIT -> {
                    val cut = fit.left + fit.width * split
                    clipRect(right = cut) { drawPhoto(f.frameImage, fit, filterQuality = FilterQuality.Low) }
                    f.simulated?.let { sim -> clipRect(left = cut) { drawPhoto(sim, fit, filterQuality = FilterQuality.Low) } }
                    drawLine(Color.White, Offset(cut, fit.top), Offset(cut, fit.bottom), 6.dp.toPx())
                    drawLine(Color.Black, Offset(cut, fit.top), Offset(cut, fit.bottom), 1.5.dp.toPx())
                }
            }
            f.probe?.let { drawProbeMarker(it.x, it.y, fit) }
        }
        if (frame?.mode == ViewMode.SPLIT) {
            CornerLabel(stringResource(R.string.split_normal), Modifier.align(Alignment.TopStart))
            CornerLabel(stringResource(R.string.split_you), Modifier.align(Alignment.TopEnd))
        }
    }
}

/** Engine, speed and map resolution: useful to compare the CPU and GPU paths. */
@Composable
private fun StatusChip(frame: LiveFrame, modifier: Modifier) {
    CornerLabel(
        stringResource(R.string.live_status, frame.fps.roundToInt(), frame.analysisWidth, frame.analysisHeight),
        modifier,
    )
}

@Composable
private fun PermissionPrompt(onAllow: () -> Unit, showSettings: Boolean, modifier: Modifier) {
    val context = LocalContext.current
    Column(modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(
            stringResource(R.string.camera_permission_text),
            color = Color.White,
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        Button(onClick = onAllow, modifier = Modifier.fillMaxWidth().heightIn(min = BigTouch)) {
            Text(stringResource(R.string.allow_camera), style = MaterialTheme.typography.titleMedium)
        }
        if (showSettings) {
            // After "don't ask again" the system dialog no longer appears: offer the app settings.
            TextButton(
                onClick = {
                    context.startActivity(
                        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)),
                    )
                },
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.open_settings)) }
        }
    }
}

private fun hasCameraPermission(context: android.content.Context) =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
