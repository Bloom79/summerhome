// Shared color math: the GLSL twin of colorcore (ColorSpaces.kt, DeltaE.kt).
// Keep the two in sync; tools/gpu-check verifies these shaders against colorcore.
// The loader prepends "#version 300 es" and precision statements.

const float PI = 3.14159265358979;
const float DEG = PI / 180.0;

// ---- sRGB transfer (IEC 61966-2-1) ----

float srgbDecode(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
vec3 srgbDecode(vec3 c) { return vec3(srgbDecode(c.r), srgbDecode(c.g), srgbDecode(c.b)); }

float srgbEncode(float v) {
    v = clamp(v, 0.0, 1.0);
    return v <= 0.0031308 ? 12.92 * v : 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}
vec3 srgbEncode(vec3 c) { return vec3(srgbEncode(c.r), srgbEncode(c.g), srgbEncode(c.b)); }

// ---- Linear sRGB -> CIELAB (D65; white = XYZ of RGB (1,1,1), as in colorcore) ----

const vec3 XYZ_X = vec3(0.4124564, 0.3575761, 0.1804375);
const vec3 XYZ_Y = vec3(0.2126729, 0.7151522, 0.0721750);
const vec3 XYZ_Z = vec3(0.0193339, 0.1191920, 0.9503041);
const vec3 WHITE = vec3(0.9504700, 1.0000001, 1.0889300);

float labF(float t) {
    return t > 216.0 / 24389.0 ? pow(t, 1.0 / 3.0) : ((24389.0 / 27.0) * t + 16.0) / 116.0;
}

vec3 linearToLab(vec3 rgb) {
    float fx = labF(dot(XYZ_X, rgb) / WHITE.x);
    float fy = labF(dot(XYZ_Y, rgb) / WHITE.y);
    float fz = labF(dot(XYZ_Z, rgb) / WHITE.z);
    return vec3(116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz));
}

// ---- CIEDE2000, vector form (same as DeltaE.ciede2000Fast) ----

float pow7(float v) { float v2 = v * v; float v3 = v2 * v; return v3 * v3 * v; }
const float POW25_7 = 6103515625.0;

float deltaE2000(vec3 p, vec3 q) {
    float c1 = length(p.yz);
    float c2 = length(q.yz);
    float cBar7 = pow7(0.5 * (c1 + c2));
    float g = 1.0 + 0.5 * (1.0 - sqrt(cBar7 / (cBar7 + POW25_7)));
    vec2 v1 = vec2(g * p.y, p.z);
    vec2 v2 = vec2(g * q.y, q.z);
    float c1p = length(v1);
    float c2p = length(v2);

    float dHp;
    vec2 h; // unit vector of the mean hue
    if (c1p == 0.0 || c2p == 0.0) {
        // One achromatic color: dh' = 0 and the mean hue is the other color's hue.
        dHp = 0.0;
        h = c1p != 0.0 ? v1 / c1p : (c2p != 0.0 ? v2 / c2p : vec2(1.0, 0.0));
    } else {
        vec2 u1 = v1 / c1p;
        vec2 u2 = v2 / c2p;
        vec2 m = u1 + u2;
        float mLen = length(m);
        if (mLen < 1e-6) {
            // Exactly opposite hues: Sharma's rule takes the arithmetic mean, min(h1, h2) + 90 deg.
            float h1 = atan(u1.y, u1.x); if (h1 < 0.0) h1 += 2.0 * PI;
            float h2 = atan(u2.y, u2.x); if (h2 < 0.0) h2 += 2.0 * PI;
            float hb = min(h1, h2) + 0.5 * PI;
            h = vec2(cos(hb), sin(hb));
            dHp = 2.0 * sqrt(c1p * c2p) * (h2 > h1 ? 1.0 : -1.0);
        } else {
            h = m / mLen;
            float halfSin = sqrt(max(0.0, 0.5 * (1.0 - dot(u1, u2))));
            float cross = u1.x * u2.y - u1.y * u2.x;
            dHp = 2.0 * sqrt(c1p * c2p) * (cross < 0.0 ? -halfSin : halfSin);
        }
    }

    float c2h = h.x * h.x - h.y * h.y;
    float s2h = 2.0 * h.x * h.y;
    float c3h = h.x * (4.0 * h.x * h.x - 3.0);
    float s3h = h.y * (3.0 - 4.0 * h.y * h.y);
    float c4h = c2h * c2h - s2h * s2h;
    float s4h = 2.0 * c2h * s2h;
    float t = 1.0
        - 0.17 * (h.x * cos(30.0 * DEG) + h.y * sin(30.0 * DEG))
        + 0.24 * c2h
        + 0.32 * (c3h * cos(6.0 * DEG) - s3h * sin(6.0 * DEG))
        - 0.20 * (c4h * cos(63.0 * DEG) + s4h * sin(63.0 * DEG));

    float cBarP = 0.5 * (c1p + c2p);
    float cBarP7 = pow7(cBarP);
    float rc = 2.0 * sqrt(cBarP7 / (cBarP7 + POW25_7));
    float rt = 0.0;
    // Beyond +-120 deg of 275 deg the rotation term is negligible: skip the atan.
    if (dot(h, vec2(cos(275.0 * DEG), sin(275.0 * DEG))) > -0.5) {
        float hDeg = atan(h.y, h.x) / DEG;
        if (hDeg < 0.0) hDeg += 360.0;
        float k = (hDeg - 275.0) / 25.0;
        float dTheta = 30.0 * exp(-k * k);
        rt = -sin(2.0 * dTheta * DEG) * rc;
    }

    float lm50 = 0.5 * (p.x + q.x) - 50.0;
    lm50 *= lm50;
    float sl = 1.0 + 0.015 * lm50 / sqrt(20.0 + lm50);
    float sc = 1.0 + 0.045 * cBarP;
    float sh = 1.0 + 0.015 * cBarP * t;
    float lT = (q.x - p.x) / sl;
    float cT = (c2p - c1p) / sc;
    float hT = dHp / sh;
    return sqrt(max(0.0, lT * lT + cT * cT + hT * hT + rt * cT * hT));
}

// ---- Camera frame geometry ----
// Upright coordinates have row 0 at the top. rot is the clockwise rotation
// that makes the camera buffer upright (ImageInfo.rotationDegrees); crop is
// (left, top, width, height) in buffer pixels.

ivec2 sourcePixel(ivec2 up, ivec4 crop, int rot) {
    if (rot == 90) return ivec2(crop.x + up.y, crop.y + crop.w - 1 - up.x);
    if (rot == 180) return ivec2(crop.x + crop.z - 1 - up.x, crop.y + crop.w - 1 - up.y);
    if (rot == 270) return ivec2(crop.x + crop.z - 1 - up.y, crop.y + up.x);
    return crop.xy + up;
}

// Same mapping for continuous upright coordinates in 0..1; returns buffer texture coordinates.
vec2 sourceUv(vec2 up, vec4 crop, int rot, vec2 srcSize) {
    vec2 s;
    if (rot == 90) s = vec2(crop.x + up.y * crop.z, crop.y + (1.0 - up.x) * crop.w);
    else if (rot == 180) s = vec2(crop.x + (1.0 - up.x) * crop.z, crop.y + (1.0 - up.y) * crop.w);
    else if (rot == 270) s = vec2(crop.x + (1.0 - up.y) * crop.z, crop.y + up.x * crop.w);
    else s = vec2(crop.x + up.x * crop.z, crop.y + up.y * crop.w);
    return s / srcSize;
}

ivec2 clampTexel(ivec2 p, ivec2 size) { return clamp(p, ivec2(0), size - 1); }
