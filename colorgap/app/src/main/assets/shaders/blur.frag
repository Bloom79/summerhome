// Pass 2: 3x3 box blur of both Lab images (clamped borders), against sensor noise.
uniform highp sampler2D uLabO;
uniform highp sampler2D uLabS;

layout(location = 0) out vec4 oBlurO; // blurred Lab, colorLoss passed through
layout(location = 1) out vec4 oBlurS;

void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    ivec2 size = textureSize(uLabO, 0);
    vec3 so = vec3(0.0);
    vec3 ss = vec3(0.0);
    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            ivec2 q = clampTexel(p + ivec2(dx, dy), size);
            so += texelFetch(uLabO, q, 0).rgb;
            ss += texelFetch(uLabS, q, 0).rgb;
        }
    }
    oBlurO = vec4(so / 9.0, texelFetch(uLabO, p, 0).a);
    oBlurS = vec4(ss / 9.0, texelFetch(uLabS, p, 0).a);
}
