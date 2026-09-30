package dev.colorgap.app.gpu

import android.content.res.AssetManager
import android.opengl.GLES30.GL_CLAMP_TO_EDGE
import android.opengl.GLES30.GL_COLOR_ATTACHMENT0
import android.opengl.GLES30.GL_COMPILE_STATUS
import android.opengl.GLES30.GL_FRAGMENT_SHADER
import android.opengl.GLES30.GL_FRAMEBUFFER
import android.opengl.GLES30.GL_FRAMEBUFFER_COMPLETE
import android.opengl.GLES30.GL_LINK_STATUS
import android.opengl.GLES30.GL_TEXTURE0
import android.opengl.GLES30.GL_TEXTURE_2D
import android.opengl.GLES30.GL_TEXTURE_MAG_FILTER
import android.opengl.GLES30.GL_TEXTURE_MIN_FILTER
import android.opengl.GLES30.GL_TEXTURE_WRAP_S
import android.opengl.GLES30.GL_TEXTURE_WRAP_T
import android.opengl.GLES30.GL_VERTEX_SHADER
import android.opengl.GLES30.glActiveTexture
import android.opengl.GLES30.glAttachShader
import android.opengl.GLES30.glBindFramebuffer
import android.opengl.GLES30.glBindTexture
import android.opengl.GLES30.glCheckFramebufferStatus
import android.opengl.GLES30.glCompileShader
import android.opengl.GLES30.glCreateProgram
import android.opengl.GLES30.glCreateShader
import android.opengl.GLES30.glDeleteFramebuffers
import android.opengl.GLES30.glDeleteShader
import android.opengl.GLES30.glDeleteTextures
import android.opengl.GLES30.glDrawBuffers
import android.opengl.GLES30.glFramebufferTexture2D
import android.opengl.GLES30.glGenFramebuffers
import android.opengl.GLES30.glGenTextures
import android.opengl.GLES30.glGetProgramInfoLog
import android.opengl.GLES30.glGetProgramiv
import android.opengl.GLES30.glGetShaderInfoLog
import android.opengl.GLES30.glGetShaderiv
import android.opengl.GLES30.glGetUniformLocation
import android.opengl.GLES30.glLinkProgram
import android.opengl.GLES30.glShaderSource
import android.opengl.GLES30.glTexImage2D
import android.opengl.GLES30.glTexParameteri
import android.opengl.GLES30.glUniform1f
import android.opengl.GLES30.glUniform1i
import android.opengl.GLES30.glUniform2f
import android.opengl.GLES30.glUniform2i
import android.opengl.GLES30.glUniform3f
import android.opengl.GLES30.glUniform4f
import android.opengl.GLES30.glUniform4i
import android.opengl.GLES30.glUniformMatrix3fv
import android.opengl.GLES30.glUseProgram

class GlException(message: String) : RuntimeException(message)

/**
 * Shader sources from assets/shaders. Every fragment shader gets the shared
 * color math (common.glsl) after the same header that tools/gpu-check uses.
 */
class ShaderSources(private val assets: AssetManager) {
    private val common by lazy { read("common.glsl") }
    val vertex by lazy { HEADER + read("fullscreen.vert") }

    fun fragment(name: String): String = HEADER + common + "\n" + read(name)

    private fun read(name: String) = assets.open("shaders/$name").bufferedReader().use { it.readText() }

    companion object {
        const val HEADER = "#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n"
    }
}

/** A linked program with cached uniform locations. */
class GlProgram(vertexSource: String, fragmentSource: String, private val name: String) {
    val id: Int = glCreateProgram()
    private val locations = HashMap<String, Int>()

    init {
        val vs = compile(GL_VERTEX_SHADER, vertexSource)
        val fs = compile(GL_FRAGMENT_SHADER, fragmentSource)
        glAttachShader(id, vs)
        glAttachShader(id, fs)
        glLinkProgram(id)
        glDeleteShader(vs)
        glDeleteShader(fs)
        val status = IntArray(1)
        glGetProgramiv(id, GL_LINK_STATUS, status, 0)
        if (status[0] == 0) throw GlException("link $name: ${glGetProgramInfoLog(id)}")
    }

    private fun compile(type: Int, source: String): Int {
        val shader = glCreateShader(type)
        glShaderSource(shader, source)
        glCompileShader(shader)
        val status = IntArray(1)
        glGetShaderiv(shader, GL_COMPILE_STATUS, status, 0)
        if (status[0] == 0) throw GlException("compile $name: ${glGetShaderInfoLog(shader)}")
        return shader
    }

    fun use() = glUseProgram(id)

    private fun loc(uniform: String) = locations.getOrPut(uniform) { glGetUniformLocation(id, uniform) }

    fun int(u: String, v: Int) = glUniform1i(loc(u), v)
    fun float(u: String, v: Float) = glUniform1f(loc(u), v)
    fun vec2(u: String, x: Float, y: Float) = glUniform2f(loc(u), x, y)
    fun ivec2(u: String, x: Int, y: Int) = glUniform2i(loc(u), x, y)
    fun vec3(u: String, x: Float, y: Float, z: Float) = glUniform3f(loc(u), x, y, z)
    fun vec4(u: String, x: Float, y: Float, z: Float, w: Float) = glUniform4f(loc(u), x, y, z, w)
    fun ivec4(u: String, x: Int, y: Int, z: Int, w: Int) = glUniform4i(loc(u), x, y, z, w)

    /** [rowMajor] 3×3 matrix (colorcore's layout), transposed by GL into a GLSL mat3. */
    fun mat3(u: String, rowMajor: FloatArray) = glUniformMatrix3fv(loc(u), 1, true, rowMajor, 0)

    fun sampler(u: String, unit: Int, texture: Int) {
        glActiveTexture(GL_TEXTURE0 + unit)
        glBindTexture(GL_TEXTURE_2D, texture)
        glUniform1i(loc(u), unit)
    }
}

/** A 2D texture of fixed size and format. */
class GlTexture(val width: Int, val height: Int, internalFormat: Int, format: Int, type: Int, filter: Int) {
    val id: Int = IntArray(1).also { glGenTextures(1, it, 0) }[0]

    init {
        glBindTexture(GL_TEXTURE_2D, id)
        glTexImage2D(GL_TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, filter)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, filter)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE)
    }

    fun release() = glDeleteTextures(1, intArrayOf(id), 0)
}

/** A framebuffer rendering into one or more textures (multiple render targets). */
class GlFramebuffer(vararg val targets: GlTexture) {
    val id: Int = IntArray(1).also { glGenFramebuffers(1, it, 0) }[0]
    val width get() = targets[0].width
    val height get() = targets[0].height

    init {
        glBindFramebuffer(GL_FRAMEBUFFER, id)
        targets.forEachIndexed { i, t ->
            glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0 + i, GL_TEXTURE_2D, t.id, 0)
        }
        val buffers = IntArray(targets.size) { GL_COLOR_ATTACHMENT0 + it }
        glDrawBuffers(buffers.size, buffers, 0)
        val status = glCheckFramebufferStatus(GL_FRAMEBUFFER)
        glBindFramebuffer(GL_FRAMEBUFFER, 0)
        if (status != GL_FRAMEBUFFER_COMPLETE) throw GlException("framebuffer incomplete: 0x${status.toString(16)}")
    }

    /** Releases the framebuffer and its textures. */
    fun release() {
        glDeleteFramebuffers(1, intArrayOf(id), 0)
        targets.forEach { it.release() }
    }
}
