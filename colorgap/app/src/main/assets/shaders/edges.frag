// Pass 3: Sobel-structured edge strength measured with dE2000, for the
// original and the simulated image (PerceptionAnalyzer.edgeStrength).
uniform highp sampler2D uBlurO;
uniform highp sampler2D uBlurS;
uniform float uGain;

out vec4 oEdges; // edge original, edge simulated, colorLoss

vec3 at(highp sampler2D t, ivec2 q, ivec2 size) { return texelFetch(t, clampTexel(q, size), 0).rgb; }

float edge(highp sampler2D t, ivec2 p, ivec2 size) {
    vec3 tl = at(t, p + ivec2(-1, -1), size), tc = at(t, p + ivec2(0, -1), size), tr = at(t, p + ivec2(1, -1), size);
    vec3 ml = at(t, p + ivec2(-1, 0), size), mr = at(t, p + ivec2(1, 0), size);
    vec3 bl = at(t, p + ivec2(-1, 1), size), bc = at(t, p + ivec2(0, 1), size), br = at(t, p + ivec2(1, 1), size);
    float gx = deltaE2000((tl + 2.0 * ml + bl) * 0.25, (tr + 2.0 * mr + br) * 0.25);
    float gy = deltaE2000((tl + 2.0 * tc + tr) * 0.25, (bl + 2.0 * bc + br) * 0.25);
    return sqrt(gx * gx + gy * gy) * uGain;
}

void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    ivec2 size = textureSize(uBlurO, 0);
    oEdges = vec4(edge(uBlurO, p, size), edge(uBlurS, p, size), texelFetch(uBlurO, p, 0).a, 0.0);
}
