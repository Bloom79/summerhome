// Pass 5: widen lost edges into visible bands (square max filter), average
// color loss over a box, combine: score = max(contrastLoss, colorWeight * colorLoss).
uniform highp sampler2D uContrast;
uniform int uSpread;
uniform float uColorWeight;
uniform int uColorSmooth; // box average radius of color loss (AnalysisConfig.colorSmooth)

out vec4 oScore; // score, contrastLoss, colorLoss (RGBA8)

void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    ivec2 size = textureSize(uContrast, 0);
    float c = 0.0;
    for (int dy = -uSpread; dy <= uSpread; dy++) {
        for (int dx = -uSpread; dx <= uSpread; dx++) {
            c = max(c, texelFetch(uContrast, clampTexel(p + ivec2(dx, dy), size), 0).r);
        }
    }
    // Color loss averaged over a box, so an area is marked whole rather than in speckles.
    float colorLoss = 0.0;
    for (int dy = -uColorSmooth; dy <= uColorSmooth; dy++) {
        for (int dx = -uColorSmooth; dx <= uColorSmooth; dx++) {
            colorLoss += texelFetch(uContrast, clampTexel(p + ivec2(dx, dy), size), 0).g;
        }
    }
    float side = float(2 * uColorSmooth + 1);
    colorLoss /= side * side;
    oScore = vec4(max(c, uColorWeight * colorLoss), c, colorLoss, 1.0);
}
