// Pass 0, full camera resolution: YUV_420_888 planes -> RGBA8 in buffer
// orientation. Each plane is an R8 texture of its raw bytes (width = row
// stride), so any pixel stride works: planar (1) or interleaved chroma (2).
uniform highp sampler2D uY;
uniform highp sampler2D uU;
uniform highp sampler2D uV;
uniform ivec3 uPixelStride; // Y, U, V

out vec4 oColor;

void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    ivec2 c = p / 2;
    float y = texelFetch(uY, ivec2(p.x * uPixelStride.x, p.y), 0).r * 255.0;
    float u = texelFetch(uU, ivec2(c.x * uPixelStride.y, c.y), 0).r * 255.0;
    float v = texelFetch(uV, ivec2(c.x * uPixelStride.z, c.y), 0).r * 255.0;
    oColor = vec4(yuvToRgb(y, u, v), 1.0);
}
