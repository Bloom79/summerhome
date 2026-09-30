package dev.colorgap.app.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import dev.colorgap.app.gpu.GpuRenderer
import androidx.compose.ui.platform.LocalContext
import dev.colorgap.app.MainViewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Root: the live camera, with a photo screen on top for gallery photos and frozen frames. */
@Composable
fun ColorGapApp(vm: MainViewModel) {
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    var showSettings by rememberSaveable { mutableStateOf(false) }

    val pickPhoto = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri?.let(vm::open)
    }
    val exportTo = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("image/png")) { uri ->
        uri?.let(vm::export)
    }
    val openPicker = { pickPhoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }

    vm.message?.let { res ->
        LaunchedEffect(res) {
            snackbar.showSnackbar(context.getString(res))
            vm.messageShown()
        }
    }
    val gpuAvailable = remember { GpuRenderer.deviceSupportsEs3(context) }

    when {
        // Wait for the saved settings: no flash of the welcome screen or of default values.
        !vm.settingsLoaded -> Box(Modifier.fillMaxSize().background(Color.Black))
        vm.showingCalibration -> {
            BackHandler { vm.closeCalibration() }
            CalibrationScreen(vm, onClose = vm::closeCalibration)
        }
        !vm.onboarded -> WelcomeScreen(onStart = vm::completeOnboarding, onCalibrate = vm::openCalibration)
        vm.detailColor != null -> {
            BackHandler { vm.closeColorDetail() }
            ColorDetailScreen(
                color = vm.detailColor!!,
                profile = vm.profile,
                onBack = vm::closeColorDetail,
                onOpenSettings = { vm.closeColorDetail(); showSettings = true },
                onCalibrate = vm::openCalibration,
            )
        }
        showSettings -> {
            BackHandler { showSettings = false }
            SettingsScreen(vm, gpuAvailable && !vm.gpuFailed, onBack = { showSettings = false }, onCalibrate = vm::openCalibration)
        }
        else -> {
            BackHandler(enabled = vm.showingPhoto) { vm.closePhoto() }
            Scaffold(
                snackbarHost = { SnackbarHost(snackbar) },
                topBar = { TopBar(vm.profile, onProfileClick = { showSettings = true }) },
            ) { padding ->
                Box(Modifier.padding(padding).fillMaxSize()) {
                    if (vm.showingPhoto) {
                        PhotoScreen(
                            vm,
                            onCamera = vm::closePhoto,
                            onGallery = openPicker,
                            onExport = { exportTo.launch("colorgap-${timestamp()}.png") },
                        )
                    } else {
                        CameraScreen(vm, onGallery = openPicker, onSettings = { showSettings = true })
                    }
                }
            }
        }
    }
}

private fun timestamp(): String = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(Date())
