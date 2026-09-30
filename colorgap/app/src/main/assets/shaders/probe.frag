// Tap probe: average of the 5x5 upright pixels around uProbe (1x1 target).
uniform highp sampler2D uSrc;
uniform ivec4 uCrop;
uniform int uRotation;
uniform ivec2 uProbe;
uniform ivec2 uUprightSize;

out vec4 oColor;

void main() {
    vec3 sum = vec3(0.0);
    for (int dy = -2; dy <= 2; dy++) {
        for (int dx = -2; dx <= 2; dx++) {
            ivec2 q = clampTexel(uProbe + ivec2(dx, dy), uUprightSize);
            sum += texelFetch(uSrc, sourcePixel(q, uCrop, uRotation), 0).rgb;
        }
    }
    oColor = vec4(sum / 25.0, 1.0);
}
