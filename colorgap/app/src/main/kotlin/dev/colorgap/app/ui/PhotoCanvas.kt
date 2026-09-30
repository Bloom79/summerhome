package dev.colorgap.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import dev.colorgap.app.AnalyzedPhoto
import dev.colorgap.app.ColorProbe
import dev.colorgap.app.R
import dev.colorgap.app.ViewMode
import kotlin.math.roundToInt

/** The analyzed photo with pinch/double-tap zoom, pan and tap-to-probe. */
@Composable
fun PhotoCanvas(
    photo: AnalyzedPhoto,
    overlay: ImageBitmap?,
    mode: ViewMode,
    split: Float,
    probe: ColorProbe?,
    onTap: (x: Int, y: Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    var zoom by remember(photo.width, photo.height) { mutableStateOf(Zoom()) }
    val description = stringResource(R.string.image_description)

    Box(modifier.clipToBounds()) {
        Canvas(
            Modifier
                .fillMaxSize()
                .semantics { contentDescription = description }
                .pointerInput(photo) {
                    detectTransformGestures { centroid, pan, gestureZoom, _ ->
                        zoom = zoom.transformed(
                            centroid.x, centroid.y, pan.x, pan.y, gestureZoom,
                            size.width.toFloat(), size.height.toFloat(),
                        )
                    }
                }
                .pointerInput(photo) {
                    detectTapGestures(
                        onTap = { p ->
                            val fit = FitRect.of(size.width.toFloat(), size.height.toFloat(), photo.width, photo.height)
                            screenToImagePixel(p.x, p.y, fit, zoom)?.let { (x, y) -> onTap(x, y) }
                        },
                        onDoubleTap = { p ->
                            zoom = zoom.toggled(p.x, p.y, size.width.toFloat(), size.height.toFloat())
                        },
                    )
                },
        ) {
            val fit = FitRect.of(size.width, size.height, photo.width, photo.height)
            withTransform({
                translate(zoom.offsetX, zoom.offsetY)
                scale(zoom.scale, zoom.scale, pivot = Offset.Zero)
            }) {
                if (mode == ViewMode.SPLIT) {
                    val cut = fit.left + fit.width * split
                    clipRect(right = cut) { drawPhoto(photo.original, fit) }
                    clipRect(left = cut) { drawPhoto(photo.simulatedImage, fit) }
                    val stroke = 3.dp.toPx() / zoom.scale
                    drawLine(Color.White, Offset(cut, fit.top), Offset(cut, fit.bottom), stroke * 2)
                    drawLine(Color.Black, Offset(cut, fit.top), Offset(cut, fit.bottom), stroke / 2)
                } else {
                    drawPhoto(overlay ?: photo.original, fit)
                }
                probe?.let { drawProbeMarker(it, fit, zoom.scale) }
            }
        }
        if (mode == ViewMode.SPLIT) {
            CornerLabel(stringResource(R.string.split_normal), Modifier.align(Alignment.BottomStart))
            CornerLabel(stringResource(R.string.split_you), Modifier.align(Alignment.BottomEnd))
        }
    }
}

private fun DrawScope.drawPhoto(image: ImageBitmap, fit: FitRect) {
    drawImage(
        image,
        dstOffset = IntOffset(fit.left.roundToInt(), fit.top.roundToInt()),
        dstSize = IntSize(fit.width.roundToInt(), fit.height.roundToInt()),
        filterQuality = FilterQuality.Medium,
    )
}

/** Ring with a black and a white stroke, visible on any background. */
private fun DrawScope.drawProbeMarker(probe: ColorProbe, fit: FitRect, scale: Float) {
    val center = Offset(
        fit.left + (probe.x + 0.5f) / fit.imageWidth * fit.width,
        fit.top + (probe.y + 0.5f) / fit.imageHeight * fit.height,
    )
    val radius = 14.dp.toPx() / scale
    drawCircle(Color.Black, radius, center, style = Stroke(5.dp.toPx() / scale))
    drawCircle(Color.White, radius, center, style = Stroke(2.dp.toPx() / scale))
}

@Composable
private fun CornerLabel(text: String, modifier: Modifier) {
    Surface(
        modifier.padding(8.dp),
        shape = RoundedCornerShape(8.dp),
        color = Color.Black.copy(alpha = 0.6f),
        contentColor = Color.White,
    ) {
        Text(text, Modifier.padding(horizontal = 10.dp, vertical = 4.dp), style = MaterialTheme.typography.labelLarge)
    }
}
