// Final pass, at screen resolution: the camera frame with the selected
// visualization (Overlays.heatmap / stripes / split), drawn into the
// letterboxed viewport.
in vec2 vUv;
uniform highp sampler2D uSrc;   // camera buffer, linear filtering
uniform highp sampler2D uScore; // map, linear filtering
uniform vec4 uCrop;
uniform int uRotation;
uniform vec2 uSrcSize;
uniform int uMode; // 0 heatmap, 1 stripes, 2 split
uniform float uThreshold;
uniform float uSplit;
uniform float uMaxAlpha;
uniform vec3 uHeatLo;
uniform vec3 uHeatHi;
uniform mat3 uSim;
uniform vec4 uViewport;     // x, y, width, height in window pixels
uniform float uStripePeriod; // pixels
uniform float uLineHalf;     // split divider half width, pixels

out vec4 oColor;

void main() {
    vec2 up = vec2(vUv.x, 1.0 - vUv.y);
    vec3 c = texture(uSrc, sourceUv(up, uCrop, uRotation, uSrcSize)).rgb;
    if (uMode == 2) {
        float dx = (up.x - uSplit) * uViewport.z;
        if (abs(dx) < uLineHalf * 0.25) c = vec3(0.0);
        else if (abs(dx) < uLineHalf) c = vec3(1.0);
        else if (dx > 0.0) c = srgbEncode(clamp(uSim * srgbDecode(c), 0.0, 1.0));
    } else {
        float s = texture(uScore, up).r;
        if (s >= uThreshold) {
            if (uMode == 0) {
                float t = clamp((s - uThreshold) / max(1.0 - uThreshold, 1e-3), 0.0, 1.0);
                float fade = smoothstep(uThreshold, uThreshold + 0.08, s);
                c = mix(c, mix(uHeatLo, uHeatHi, t), uMaxAlpha * fade * (0.6 + 0.4 * t));
            } else {
                // Diagonal x + y (y down), constant spacing on screen.
                float x = floor(gl_FragCoord.x - uViewport.x);
                float y = floor(uViewport.w - (gl_FragCoord.y - uViewport.y));
                float band = max(1.0, floor(uStripePeriod / 5.0));
                float phase = mod(x + y, uStripePeriod);
                if (phase < band) c = vec3(0.0);
                else if (phase < 2.0 * band) c = vec3(1.0);
            }
        }
    }
    oColor = vec4(c, 1.0);
}
