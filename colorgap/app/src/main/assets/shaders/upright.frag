// Freeze frame: the camera buffer resampled upright into the target (row 0 = top).
uniform highp sampler2D uSrc;
uniform vec4 uCrop;
uniform int uRotation;
uniform vec2 uSrcSize;
uniform vec2 uTargetSize;

out vec4 oColor;

void main() {
    vec2 up = gl_FragCoord.xy / uTargetSize;
    oColor = vec4(texture(uSrc, sourceUv(up, uCrop, uRotation, uSrcSize)).rgb, 1.0);
}
