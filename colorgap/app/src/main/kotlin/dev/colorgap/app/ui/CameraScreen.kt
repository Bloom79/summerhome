package dev.colorgap.app.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.util.Log
import androidx.camera.core.Camera
import kotlinx.coroutines.delay
import java.util.concurrent.atomic.AtomicInteger
import android.opengl.GLSurfaceView
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.viewinterop.AndroidView
import dev.colorgap.app.ColorProbe
import dev.colorgap.app.gpu.GpuLiveState
import dev.colorgap.app.gpu.GpuRenderer
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
import androidx.compose.runtime.mutableIntStateOf
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
fun CameraScreen(vm: MainViewModel, onGallery: () -> Unit, onSettings: () -> Unit) {
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

    val density = LocalDensity.current.density
    val gpuCapable = remember { GpuRenderer.deviceSupportsEs3(context) }
    val useGpu = vm.preferGpu && gpuCapable && !vm.gpuFailed
    val live = remember { LiveAnalyzer() }
    val gpu = remember { GpuRenderer(context.assets, density, onUnsupported = vm::markGpuFailed) }
    val settings = LiveSettings(vm.profile, vm.mode, vm.threshold, vm.liveProbePoint, vm.split, vm.settings.analysisConfig)
    // The phone must not dim or lock while pointing the camera at something.
    val view = LocalView.current
    DisposableEffect(view) {
        view.keepScreenOn = true
        onDispose { view.keepScreenOn = false }
    }
    SideEffect {
        live.settings = settings
        gpu.settings = settings
    }
    val cpuFrame by live.frames.collectAsState()
    val gpuState by gpu.state.collectAsState()
    val info = if (useGpu) gpuState?.let { LiveInfo.of(it) } else cpuFrame?.let { LiveInfo.of(it) }
    val diagnostics = remember { CameraDiagnostics() }
    var retryKey by remember { mutableIntStateOf(0) }

    // Watchdog: frames reach the GPU renderer but nothing comes out (driver
    // quirk, surface never created...): fall back to the CPU path.
    if (useGpu) {
        LaunchedEffect(Unit) {
            while (gpu.state.value == null) {
                delay(500)
                if (diagnostics.frames.get() >= GPU_WATCHDOG_FRAMES && gpu.state.value == null) {
                    Log.w(TAG, "GPU produced no output after ${diagnostics.frames.get()} frames, falling back to CPU")
                    vm.markGpuFailed()
                    break
                }
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .background(Color.Black),
        ) {
            if (granted && !unavailable) {
                CameraBinding(
                    analyzer = if (useGpu) gpu else live,
                    diagnostics = diagnostics,
                    retryKey = retryKey,
                    onUnavailable = { unavailable = true },
                    onUnbound = gpu::dropPending,
                )
                if (useGpu) {
                    GpuLiveView(gpu, info, vm.mode, onTap = vm::setLiveProbe, Modifier.fillMaxSize())
                } else {
                    LiveView(cpuFrame, vm.split, onTap = vm::setLiveProbe, Modifier.fillMaxSize())
                }
                info?.probe?.let {
                    ProbeCard(
                        it,
                        onClose = { vm.setLiveProbe(null) },
                        onDetails = { vm.showColorDetail(it.realArgb) },
                        modifier = Modifier.align(Alignment.TopCenter),
                    )
                }
                if (info == null) {
                    WaitingForCamera(diagnostics, useGpu, onRetry = { retryKey++ }, Modifier.align(Alignment.Center))
                }
                info?.let {
                    StatusChip(
                        it,
                        onClick = if (gpuCapable && !vm.gpuFailed) vm::toggleEngine else null,
                        modifier = Modifier.align(Alignment.BottomCenter),
                    )
                }
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
                if (vm.mode == ViewMode.HEATMAP) HeatLegend(vm.profile.type)
                if (vm.mode != ViewMode.SPLIT && !vm.highlightColorShifts) {
                    EdgesOnlyNotice(onEnable = { vm.updateHighlightColorShifts(true) })
                }
                ModeSlider(vm.mode, vm.threshold, info?.criticalFraction ?: 0f, vm.split, vm::updateThreshold, vm::updateSplit)
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    SettingsButton(onSettings)
                    OutlinedButton(onClick = onGallery, modifier = Modifier.weight(1f).heightIn(min = BigTouch)) {
                        Text(stringResource(R.string.gallery), style = MaterialTheme.typography.titleMedium)
                    }
                    Button(
                        onClick = {
                            if (useGpu) {
                                gpu.requestFreeze(onFrozen = vm::showFrozen)
                            } else {
                                cpuFrame?.let { vm.showFrozen(it.frame.copy(Bitmap.Config.ARGB_8888, false)) }
                            }
                        },
                        enabled = info != null,
                        modifier = Modifier.weight(1f).heightIn(min = BigTouch),
                    ) {
                        Text(stringResource(R.string.freeze), style = MaterialTheme.typography.titleMedium)
                    }
                }
            }
        }
    }
}

/** What the camera UI needs from either engine. */
private data class LiveInfo(
    val gpu: Boolean,
    val frameWidth: Int,
    val frameHeight: Int,
    val mapWidth: Int,
    val mapHeight: Int,
    val fps: Float,
    val criticalFraction: Float,
    val probe: ColorProbe?,
) {
    companion object {
        fun of(s: GpuLiveState) = LiveInfo(true, s.frameWidth, s.frameHeight, s.mapWidth, s.mapHeight, s.fps, s.criticalFraction, s.probe)
        fun of(f: LiveFrame) = LiveInfo(false, f.width, f.height, f.analysisWidth, f.analysisHeight, f.fps, f.criticalFraction, f.probe)
    }
}

/** Whether frames actually arrive, and why not: shown on screen when the camera stays dark. */
private class CameraDiagnostics {
    val frames = AtomicInteger(0)
    @Volatile var errorCode: Int? = null
    @Volatile var bound = false
}

/**
 * Binds an ImageAnalysis use case (no Preview: we draw the analyzed frames)
 * to the lifecycle. Frames stay in the camera's native YUV_420_888: no
 * conversion inside CameraX, which fails silently on some devices.
 */
@Composable
private fun CameraBinding(
    analyzer: ImageAnalysis.Analyzer,
    diagnostics: CameraDiagnostics,
    retryKey: Int,
    onUnavailable: () -> Unit,
    onUnbound: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val rotation = LocalView.current.display?.rotation ?: ViewSurface.ROTATION_0
    DisposableEffect(lifecycleOwner, rotation, analyzer, retryKey) {
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
            .setTargetRotation(rotation)
            .build()
        diagnostics.frames.set(0)
        diagnostics.errorCode = null
        diagnostics.bound = false
        analysis.setAnalyzer(executor) { image ->
            diagnostics.frames.incrementAndGet()
            analyzer.analyze(image)
        }

        val future = ProcessCameraProvider.getInstance(context)
        var provider: ProcessCameraProvider? = null
        var camera: Camera? = null
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
                camera = cameras.bindToLifecycle(lifecycleOwner, selector, analysis).also { cam ->
                    cam.cameraInfo.cameraState.observe(lifecycleOwner) { state ->
                        state.error?.let {
                            Log.w(TAG, "Camera error ${it.code}", it.cause)
                            diagnostics.errorCode = it.code
                        }
                    }
                }
                provider = cameras
                diagnostics.bound = true
            } catch (e: Exception) {
                // CameraX reports missing/busy cameras through several exception types.
                Log.w(TAG, "Cannot bind the camera", e)
                onUnavailable()
            }
        }, ContextCompat.getMainExecutor(context))

        onDispose {
            disposed = true
            camera?.cameraInfo?.cameraState?.removeObservers(lifecycleOwner)
            provider?.unbind(analysis)
            analysis.clearAnalyzer()
            executor.shutdown()
            onUnbound()
        }
    }
}

/**
 * Shown while no analyzed frame is available: "starting" at first, then what
 * is wrong (camera error, no frames at all) with a retry button.
 */
@Composable
private fun WaitingForCamera(diagnostics: CameraDiagnostics, useGpu: Boolean, onRetry: () -> Unit, modifier: Modifier) {
    var elapsed by remember { mutableIntStateOf(0) }
    var frames by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(diagnostics) {
        while (true) {
            frames = diagnostics.frames.get()
            error = diagnostics.errorCode
            delay(500)
            elapsed += 500
        }
    }
    Column(modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        val message = when {
            error != null -> stringResource(R.string.camera_error, error!!)
            elapsed < 3000 -> stringResource(R.string.camera_starting)
            frames == 0 -> stringResource(R.string.camera_no_frames)
            else -> stringResource(R.string.camera_no_output, frames)
        }
        Text(message, color = Color.White, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        if (elapsed >= 3000 || error != null) {
            Text(
                stringResource(R.string.camera_diagnostics, if (useGpu) "GPU" else "CPU", frames, if (diagnostics.bound) "✓" else "✗"),
                color = Color.White.copy(alpha = 0.7f),
                style = MaterialTheme.typography.bodySmall,
            )
            OutlinedButton(onClick = { elapsed = 0; onRetry() }, modifier = Modifier.heightIn(min = BigTouch)) {
                Text(stringResource(R.string.retry), color = Color.White)
            }
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

/**
 * The GPU path: a GLSurfaceView draws the frame and the visualization; a
 * transparent Compose layer on top takes taps and draws the probe marker.
 */
@Composable
private fun GpuLiveView(
    renderer: GpuRenderer,
    info: LiveInfo?,
    mode: ViewMode,
    onTap: (Pair<Int, Int>) -> Unit,
    modifier: Modifier,
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    var glView by remember { mutableStateOf<GLSurfaceView?>(null) }
    val current by rememberUpdatedState(info)
    val description = stringResource(R.string.camera_description)
    Box(modifier.clipToBounds()) {
        AndroidView(
            factory = { ctx ->
                GLSurfaceView(ctx).apply {
                    setEGLContextClientVersion(3)
                    preserveEGLContextOnPause = true
                    setRenderer(renderer)
                    renderMode = GLSurfaceView.RENDERMODE_WHEN_DIRTY
                    renderer.view = this
                    glView = this
                }
            },
            modifier = Modifier.fillMaxSize(),
        )
        Canvas(
            Modifier
                .fillMaxSize()
                .semantics { contentDescription = description }
                .pointerInput(Unit) {
                    detectTapGestures { p ->
                        val i = current ?: return@detectTapGestures
                        val fit = FitRect.of(size.width.toFloat(), size.height.toFloat(), i.frameWidth, i.frameHeight)
                        screenToImagePixel(p.x, p.y, fit, Zoom())?.let(onTap)
                    }
                },
        ) {
            val i = info ?: return@Canvas
            val fit = FitRect.of(size.width, size.height, i.frameWidth, i.frameHeight)
            i.probe?.let { drawProbeMarker(it.x, it.y, fit) }
        }
        if (mode == ViewMode.SPLIT) {
            CornerLabel(stringResource(R.string.split_normal), Modifier.align(Alignment.TopStart))
            CornerLabel(stringResource(R.string.split_you), Modifier.align(Alignment.TopEnd))
        }
    }
    DisposableEffect(lifecycleOwner, glView) {
        val view = glView
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> view?.onResume()
                Lifecycle.Event.ON_PAUSE -> view?.onPause()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            view?.let(renderer::detach)
        }
    }
}

/** Engine, speed and map resolution; tap to switch GPU/CPU (to compare them). */
@Composable
private fun StatusChip(info: LiveInfo, onClick: (() -> Unit)?, modifier: Modifier) {
    val engine = stringResource(if (info.gpu) R.string.engine_gpu else R.string.engine_cpu)
    val text = stringResource(R.string.live_status, engine, info.fps.roundToInt(), info.mapWidth, info.mapHeight)
    val switchLabel = stringResource(R.string.switch_engine)
    Surface(
        modifier = modifier
            .padding(8.dp)
            .heightIn(min = 48.dp)
            .then(if (onClick != null) Modifier.clickable(onClickLabel = switchLabel, onClick = onClick) else Modifier),
        shape = RoundedCornerShape(24.dp),
        color = Color.Black.copy(alpha = 0.6f),
        contentColor = Color.White,
    ) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.heightIn(min = 48.dp)) {
            Text(text, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.labelLarge)
        }
    }
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

private const val TAG = "ColorGapCamera"
private const val GPU_WATCHDOG_FRAMES = 20

private fun hasCameraPermission(context: android.content.Context) =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
