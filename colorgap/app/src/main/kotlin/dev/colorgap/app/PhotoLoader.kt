package dev.colorgap.app

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import java.io.IOException
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Decodes photos from content URIs: subsampled, EXIF-rotated, software ARGB_8888. */
object PhotoLoader {

    fun load(resolver: ContentResolver, uri: Uri, maxSide: Int): Bitmap {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        open(resolver, uri).use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IOException("Not an image: $uri")

        // Largest power-of-two subsampling that keeps the long side ≥ maxSide.
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
        val options = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val decoded = open(resolver, uri).use { BitmapFactory.decodeStream(it, null, options) }
            ?: throw IOException("Cannot decode $uri")

        val matrix = Matrix()
        val scale = min(1f, maxSide.toFloat() / max(decoded.width, decoded.height))
        matrix.postScale(scale, scale)
        applyOrientation(matrix, readOrientation(resolver, uri))
        val result = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
        if (result !== decoded) decoded.recycle()
        return if (result.config == Bitmap.Config.ARGB_8888) result else result.copy(Bitmap.Config.ARGB_8888, false)
    }

    /** Bilinear downscale so the long side is at most [maxSide]. */
    fun scaledDown(src: Bitmap, maxSide: Int): Bitmap {
        val s = maxSide.toFloat() / max(src.width, src.height)
        if (s >= 1f) return src
        return Bitmap.createScaledBitmap(src, (src.width * s).roundToInt().coerceAtLeast(1), (src.height * s).roundToInt().coerceAtLeast(1), true)
    }

    private fun open(resolver: ContentResolver, uri: Uri) =
        resolver.openInputStream(uri) ?: throw IOException("Cannot open $uri")

    private fun readOrientation(resolver: ContentResolver, uri: Uri): Int = try {
        open(resolver, uri).use {
            ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        }
    } catch (e: IOException) {
        ExifInterface.ORIENTATION_NORMAL
    }

    private fun applyOrientation(m: Matrix, orientation: Int) {
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { m.postRotate(90f); m.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> { m.postRotate(270f); m.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
        }
    }
}
