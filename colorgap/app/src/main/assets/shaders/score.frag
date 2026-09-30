// Pass 5: widen lost edges into visible bands (square max filter) and
// combine with color loss: score = max(contrastLoss, colorWeight * colorLoss).
uniform highp sampler2D uContrast;
uniform int uSpread;
uniform float uColorWeight;

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
    float colorLoss = texelFetch(uContrast, p, 0).g;
    oScore = vec4(max(c, uColorWeight * colorLoss), c, colorLoss, 1.0);
}
