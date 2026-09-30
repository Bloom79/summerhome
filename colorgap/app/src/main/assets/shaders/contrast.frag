// Pass 4: lost contrast. An edge is lost when it dropped meaningfully AND
// what remains (judged at its local 3x3 peak) is too weak to see.
uniform highp sampler2D uEdges;
uniform float uContrastFloor;
uniform float uContrastScale;
uniform float uEdgeInvisible;
uniform float uEdgeVisible;

out vec4 oContrast; // raw contrast loss, colorLoss

void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    ivec2 size = textureSize(uEdges, 0);
    float peak = 0.0;
    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            peak = max(peak, texelFetch(uEdges, clampTexel(p + ivec2(dx, dy), size), 0).g);
        }
    }
    vec4 e = texelFetch(uEdges, p, 0);
    float drop = clamp((e.r - peak - uContrastFloor) / uContrastScale, 0.0, 1.0);
    float hidden = 1.0 - smoothstep(uEdgeInvisible, uEdgeVisible, peak);
    oContrast = vec4(drop * hidden, e.b, 0.0, 0.0);
}
