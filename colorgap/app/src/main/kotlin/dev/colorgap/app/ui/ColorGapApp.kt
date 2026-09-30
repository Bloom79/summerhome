package dev.colorgap.app.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
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
    var showProfile by rememberSaveable { mutableStateOf(false) }

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
    BackHandler(enabled = vm.showingPhoto) { vm.closePhoto() }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = { TopBar(vm.profile, onProfileClick = { showProfile = true }) },
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
                CameraScreen(vm, onGallery = openPicker)
            }
        }
    }

    if (showProfile) {
        ProfileDialog(
            initial = vm.profile,
            onDismiss = { showProfile = false },
            onConfirm = { vm.updateProfile(it); showProfile = false },
        )
    }
}

private fun timestamp(): String = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(Date())
