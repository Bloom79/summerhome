// Pass 1, at map resolution: box-downscale the camera buffer into upright
// pixels (8-bit rounding as in Resample.boxDownscale), then Lab of the
// original and of the simulated color, and the color loss (dE2000 between them).
uniform highp sampler2D uSrc;
uniform ivec4 uCrop;
uniform int uRotation;
uniform int uFactor;
uniform mat3 uSim;
uniform float uColorFloor;
uniform float uColorScale;

layout(location = 0) out vec4 oLabO; // L, a, b, colorLoss
layout(location = 1) out vec4 oLabS; // L, a, b, colorDelta

void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec3 sum = vec3(0.0);
    for (int dy = 0; dy < uFactor; dy++) {
        for (int dx = 0; dx < uFactor; dx++) {
            sum += texelFetch(uSrc, sourcePixel(p * uFactor + ivec2(dx, dy), uCrop, uRotation), 0).rgb;
        }
    }
    int area = uFactor * uFactor;
    ivec3 total = ivec3(round(sum * 255.0));
    vec3 srgb = vec3((total + area / 2) / area) / 255.0;

    vec3 lin = srgbDecode(srgb);
    vec3 sim = clamp(uSim * lin, 0.0, 1.0);
    vec3 labO = linearToLab(lin);
    vec3 labS = linearToLab(sim);
    float d = deltaE2000(labO, labS);
    oLabO = vec4(labO, clamp((d - uColorFloor) / uColorScale, 0.0, 1.0));
    oLabS = vec4(labS, d);
}
