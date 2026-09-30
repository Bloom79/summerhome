// Verifies the app's GLSL shaders against colorcore, without an Android device.
//
// WebGL2 runs GLSL ES 3.00, the same shading language as OpenGL ES 3.0, so the
// shader files in app/src/main/assets/shaders are loaded verbatim (with the
// same header the app prepends) and run in headless Chromium.
//
// Checks:
//   1. dE2000 in GLSL against Sharma's 34 reference pairs;
//   2. the full analysis passes against `colorgap dump` output (the CPU
//      pipeline on the same pixels): color delta, score, criticality;
//   3. buffer geometry: rotation 90/180/270 + crop + 2x box downscale must
//      reproduce the upright factor-1 result exactly;
//   4. the display pass (heatmap, stripes) against the CPU-baked overlays;
//   5. freeze frame (upright.frag) and tap probe (probe.frag) on a rotated buffer;
//   6. camera YUV_420_888 -> RGB (yuv.frag) with padded rows and interleaved chroma.
//
// Usage (from colorgap/):
//   ./gradlew -q :cli:run --args="dump samples/confusion-chart.png --out out/dump/chart"
//   node tools/gpu-check/check.mjs out/dump/chart [more dump dirs...]
//
// Needs Node and Playwright with Chromium (dev tooling only, not an app dependency).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/node22/lib/node_modules/playwright');
}

const here = dirname(fileURLToPath(import.meta.url));
const shaderDir = join(here, '../../app/src/main/assets/shaders');
const shader = (name) => readFileSync(join(shaderDir, name), 'utf8');
const sources = Object.fromEntries(
  ['common.glsl', 'fullscreen.vert', 'yuv.frag', 'lab.frag', 'blur.frag', 'edges.frag', 'contrast.frag', 'score.frag', 'display.frag', 'upright.frag', 'probe.frag']
    .map((n) => [n, shader(n)]),
);

const SHARMA = [
  [50, 2.6772, -79.7751, 50, 0, -82.7485, 2.0425], [50, 3.1571, -77.2803, 50, 0, -82.7485, 2.8615],
  [50, 2.8361, -74.02, 50, 0, -82.7485, 3.4412], [50, -1.3802, -84.2814, 50, 0, -82.7485, 1.0],
  [50, -1.1848, -84.8006, 50, 0, -82.7485, 1.0], [50, -0.9009, -85.5211, 50, 0, -82.7485, 1.0],
  [50, 0, 0, 50, -1, 2, 2.3669], [50, -1, 2, 50, 0, 0, 2.3669],
  [50, 2.49, -0.001, 50, -2.49, 0.0009, 7.1792], [50, 2.49, -0.001, 50, -2.49, 0.001, 7.1792],
  [50, 2.49, -0.001, 50, -2.49, 0.0011, 7.2195], [50, 2.49, -0.001, 50, -2.49, 0.0012, 7.2195],
  [50, -0.001, 2.49, 50, 0.0009, -2.49, 4.8045], [50, -0.001, 2.49, 50, 0.001, -2.49, 4.8045],
  [50, -0.001, 2.49, 50, 0.0011, -2.49, 4.7461], [50, 2.5, 0, 50, 0, -2.5, 4.3065],
  [50, 2.5, 0, 73, 25, -18, 27.1492], [50, 2.5, 0, 61, -5, 29, 22.8977],
  [50, 2.5, 0, 56, -27, -3, 31.903], [50, 2.5, 0, 58, 24, 15, 19.4535],
  [50, 2.5, 0, 50, 3.1736, 0.5854, 1.0], [50, 2.5, 0, 50, 3.2972, 0, 1.0],
  [50, 2.5, 0, 50, 1.8634, 0.5757, 1.0], [50, 2.5, 0, 50, 3.2592, 0.335, 1.0],
  [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
  [63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.263],
  [61.2901, 3.7196, -5.3901, 61.4292, 2.248, -4.962, 1.8731],
  [35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645],
  [22.7233, 20.0904, -46.694, 23.0331, 14.973, -42.5619, 2.0373],
  [36.4612, 47.858, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146],
  [90.8027, -2.0831, 1.441, 91.1528, -1.6435, 0.0447, 1.4441],
  [90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
  [6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377],
  [2.0776, 0.0795, -1.135, 0.9033, -0.0636, -0.5514, 0.9082],
];

// Runs inside the page: a tiny GL harness mirroring GpuPipeline.kt.
function pageMain({ sources, SHARMA, dumps }) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 unavailable');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float unavailable');
  // Same header as ShaderSources.kt.
  const HEADER = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
    return s;
  }
  function program(frag, extra = '') {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, HEADER + sources['fullscreen.vert']));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, HEADER + sources['common.glsl'] + '\n' + extra + (frag ? sources[frag] : '')));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  function texture(w, h, internal, format, type, data = null, filter = gl.NEAREST) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  const f16 = (w, h) => texture(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
  function fbo(...textures) {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    textures.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers(textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('FBO incomplete ' + status);
    return f;
  }
  function run(prog, target, w, h, inputs, uniforms) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog);
    Object.entries(inputs).forEach(([name, tex], unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(prog, name), unit);
    });
    for (const [name, [kind, ...v]] of Object.entries(uniforms)) {
      const loc = gl.getUniformLocation(prog, name);
      if (kind === 'm3') gl.uniformMatrix3fv(loc, true, v[0]); // row-major, as in the app
      else gl['uniform' + kind](loc, ...v);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function readFloat(f, attachment, w, h) {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, f);
    gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachment);
    const out = new Float32Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, out);
    return out;
  }
  function readBytes(f, w, h) {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, f);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    const out = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  }
  gl.bindVertexArray(gl.createVertexArray());

  const results = {};

  // 1. Sharma pairs.
  {
    const data = new Float32Array(SHARMA.length * 2 * 4);
    SHARMA.forEach((r, i) => { data.set([r[0], r[1], r[2], 0], i * 8); data.set([r[3], r[4], r[5], 0], i * 8 + 4); });
    const pairs = texture(2, SHARMA.length, gl.RGBA32F, gl.RGBA, gl.FLOAT, data);
    const prog = program(null, `uniform highp sampler2D uPairs; out vec4 o;
      void main() { int i = int(gl_FragCoord.x);
        o = vec4(deltaE2000(texelFetch(uPairs, ivec2(0, i), 0).rgb, texelFetch(uPairs, ivec2(1, i), 0).rgb), 0.0, 0.0, 1.0); }`);
    const outTex = texture(SHARMA.length, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT);
    const f = fbo(outTex);
    run(prog, f, SHARMA.length, 1, { uPairs: pairs }, {});
    const got = readFloat(f, 0, SHARMA.length, 1);
    results.sharma = SHARMA.map((r, i) => ({ expected: r[6], got: got[i * 4] }));
  }

  const progs = {
    lab: program('lab.frag'), blur: program('blur.frag'), edges: program('edges.frag'),
    contrast: program('contrast.frag'), score: program('score.frag'), display: program('display.frag'),
    upright: program('upright.frag'), probe: program('probe.frag'), yuv: program('yuv.frag'),
  };

  // The analysis passes, as GpuPipeline.analyze runs them.
  function analyze(src, crop, rotation, factor, meta) {
    const upW = (rotation % 180 === 0 ? crop[2] : crop[3]) / factor;
    const upH = (rotation % 180 === 0 ? crop[3] : crop[2]) / factor;
    const labO = f16(upW, upH), labS = f16(upW, upH), blurO = f16(upW, upH), blurS = f16(upW, upH);
    const edges = f16(upW, upH), contrast = f16(upW, upH);
    const score = texture(upW, upH, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.LINEAR);
    const fLab = fbo(labO, labS), fBlur = fbo(blurO, blurS), fEdges = fbo(edges), fContrast = fbo(contrast), fScore = fbo(score);
    run(progs.lab, fLab, upW, upH, { uSrc: src }, {
      uCrop: ['4i', ...crop], uRotation: ['1i', rotation], uFactor: ['1i', factor], uSim: ['m3', meta.matrix],
      uColorFloor: ['1f', 3], uColorScale: ['1f', 20],
    });
    run(progs.blur, fBlur, upW, upH, { uLabO: labO, uLabS: labS }, {});
    run(progs.edges, fEdges, upW, upH, { uBlurO: blurO, uBlurS: blurS }, { uGain: ['1f', 1.5] });
    run(progs.contrast, fContrast, upW, upH, { uEdges: edges }, {
      uContrastFloor: ['1f', 2], uContrastScale: ['1f', 12], uEdgeInvisible: ['1f', 3], uEdgeVisible: ['1f', 20],
    });
    run(progs.score, fScore, upW, upH, { uContrast: contrast }, { uSpread: ['1i', 2], uColorWeight: ['1f', 0.6] });
    const labSData = readFloat(fLab, 1, upW, upH);
    return { w: upW, h: upH, score, fScore, colorDelta: labSData.filter((_, i) => i % 4 === 3), scoreBytes: readBytes(fScore, upW, upH) };
  }

  // Rotates RGBA pixels by `deg` counter-clockwise so that a clockwise rotation by `deg` restores them.
  function rotateCcw(px, w, h, deg) {
    if (deg === 0) return { px, w, h };
    const [ow, oh] = deg === 180 ? [w, h] : [h, w];
    const out = new Uint8Array(px.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let nx, ny;
      if (deg === 90) { nx = y; ny = w - 1 - x; } else if (deg === 180) { nx = w - 1 - x; ny = h - 1 - y; } else { nx = h - 1 - y; ny = x; }
      out.set(px.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (ny * ow + nx) * 4);
    }
    return { px: out, w: ow, h: oh };
  }
  // Doubles each pixel (so a 2x box downscale gives back the original) and adds a gray border (crop).
  function upscalePad(px, w, h, pad) {
    const W = 2 * w + 2 * pad, H = 2 * h + 2 * pad, out = new Uint8Array(W * H * 4).fill(128);
    for (let y = 0; y < 2 * h; y++) for (let x = 0; x < 2 * w; x++) {
      const s = ((y >> 1) * w + (x >> 1)) * 4;
      out.set(px.subarray(s, s + 4), ((y + pad) * W + x + pad) * 4);
    }
    return { px: out, w: W, h: H };
  }

  results.dumps = dumps.map((d) => {
    const meta = d.meta;
    const input = Uint8Array.from(atob(d.input), (c) => c.charCodeAt(0));
    const w = meta.width, h = meta.height;
    const src = texture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, input, gl.LINEAR);
    const base = analyze(src, [0, 0, w, h], 0, 1, meta);

    // 3. Geometry: every rotation, with crop and a 2x box downscale.
    const geometry = [90, 180, 270].map((rot) => {
      const big = upscalePad(input, w, h, 6);
      const r = rotateCcw(big.px, big.w, big.h, rot);
      const t = texture(r.w, r.h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, r.px);
      // Crop: the padded border, expressed in the rotated buffer.
      const crop = rot === 180 ? [6, 6, 2 * w, 2 * h] : [6, 6, 2 * h, 2 * w];
      const res = analyze(t, crop, rot, 2, meta);
      let diff = 0;
      for (let i = 0; i < base.scoreBytes.length; i++) diff = Math.max(diff, Math.abs(res.scoreBytes[i] - base.scoreBytes[i]));
      return { rotation: rot, size: [res.w, res.h], maxScoreDiff: diff };
    });

    // 5. Freeze (upright.frag) from a buffer rotated by 90: must give back the input pixels,
    //    and the tap probe (probe.frag) must average the same 5x5 patch as ColorProbe.at.
    let uprightDiff = 0, probeDiff = 0;
    {
      const r = rotateCcw(input, w, h, 90);
      const t = texture(r.w, r.h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, r.px, gl.LINEAR);
      const outTex = texture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      const f = fbo(outTex);
      run(progs.upright, f, w, h, { uSrc: t }, {
        uCrop: ['4f', 0, 0, r.w, r.h], uRotation: ['1i', 90], uSrcSize: ['2f', r.w, r.h], uTargetSize: ['2f', w, h],
      });
      const got = readBytes(f, w, h);
      for (let i = 0; i < got.length; i++) if (i % 4 !== 3) uprightDiff = Math.max(uprightDiff, Math.abs(got[i] - input[i]));

      const pTex = texture(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      const pf = fbo(pTex);
      for (const [px, py] of [[0, 0], [Math.floor(w / 2), Math.floor(h / 3)], [w - 1, h - 1]]) {
        run(progs.probe, pf, 1, 1, { uSrc: t }, {
          uCrop: ['4i', 0, 0, r.w, r.h], uRotation: ['1i', 90], uProbe: ['2i', px, py], uUprightSize: ['2i', w, h],
        });
        const got1 = readBytes(pf, 1, 1);
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const x = Math.min(w - 1, Math.max(0, px + dx)), y = Math.min(h - 1, Math.max(0, py + dy));
            sum += input[(y * w + x) * 4 + c];
          }
          probeDiff = Math.max(probeDiff, Math.abs(got1[c] - sum / 25));
        }
      }
    }

    // 6. Camera YUV_420_888 (NV12-like: padded rows, interleaved chroma) -> RGB,
    //    against the same formulas as colorcore's Yuv (JFIF, round half up).
    let yuvDiff = 0;
    {
      const ch = (x) => Math.min(255, Math.max(0, Math.floor(x + 0.5)));
      const fromRgb = (r, g, b) => [ch(0.299 * r + 0.587 * g + 0.114 * b), ch(128 - 0.168736 * r - 0.331264 * g + 0.5 * b), ch(128 + 0.5 * r - 0.418688 * g - 0.081312 * b)];
      const toRgb = (y, u, v) => { const cb = u - 128, cr = v - 128; return [ch(y + 1.402 * cr), ch(y - 0.344136 * cb - 0.714136 * cr), ch(y + 1.772 * cb)]; };
      const yStride = w + 8, cw = Math.ceil(w / 2), chH = Math.ceil(h / 2), cStride = 2 * cw + 8;
      const Y = new Uint8Array(yStride * h), UV = new Uint8Array(cStride * chH);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const [yy, uu, vv] = fromRgb(input[i], input[i + 1], input[i + 2]);
        Y[y * yStride + x] = yy;
        if (x % 2 === 0 && y % 2 === 0) { UV[(y / 2) * cStride + x] = uu; UV[(y / 2) * cStride + x + 1] = vv; }
      }
      const V = UV.subarray(1); // interleaved: V starts one byte after U, same strides
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const r8 = (data, width, height) => texture(width, height, gl.R8, gl.RED, gl.UNSIGNED_BYTE, data);
      const tY = r8(Y, yStride, h), tU = r8(UV, cStride, chH);
      const vPadded = new Uint8Array(cStride * chH); vPadded.set(V);
      const tV = r8(vPadded, cStride, chH);
      const outTex = texture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      const f = fbo(outTex);
      run(progs.yuv, f, w, h, { uY: tY, uU: tU, uV: tV }, { uPixelStride: ['3i', 1, 2, 2] });
      const got = readBytes(f, w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const c = ((y >> 1) * cStride) + (x >> 1) * 2;
        const exp = toRgb(Y[y * yStride + x], UV[c], UV[c + 1]);
        for (let k = 0; k < 3; k++) yuvDiff = Math.max(yuvDiff, Math.abs(got[o + k] - exp[k]));
      }
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    }

    // 4. Display pass into an image-sized target (score texels align with pixels).
    const display = {};
    for (const [mode, name] of [[0, 'heatmap'], [1, 'stripes']]) {
      const outTex = texture(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
      const f = fbo(outTex);
      const rgb = (c) => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
      run(progs.display, f, w, h, { uSrc: src, uScore: base.score }, {
        uCrop: ['4f', 0, 0, w, h], uRotation: ['1i', 0], uSrcSize: ['2f', w, h], uMode: ['1i', mode],
        uThreshold: ['1f', meta.threshold], uSplit: ['1f', 0.5], uMaxAlpha: ['1f', 0.7],
        uHeatLo: ['3f', ...rgb(meta.heatLo)], uHeatHi: ['3f', ...rgb(meta.heatHi)], uSim: ['m3', meta.matrix],
        uViewport: ['4f', 0, 0, w, h], uStripePeriod: ['1f', meta.stripePeriod], uLineHalf: ['1f', 2],
      });
      // Like the screen, the display pass puts the image top at the highest row: flip to compare.
      const bytes = readBytes(f, w, h);
      const flipped = new Uint8Array(bytes.length);
      for (let y = 0; y < h; y++) flipped.set(bytes.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      display[name] = Array.from(flipped);
    }
    return { name: d.name, w, h, yuvDiff, uprightDiff, probeDiff, colorDelta: Array.from(base.colorDelta), score: Array.from(base.scoreBytes.filter((_, i) => i % 4 === 0)), geometry, display };
  });
  return results;
}

const dumpDirs = process.argv.slice(2);
if (dumpDirs.length === 0) {
  console.error('usage: node tools/gpu-check/check.mjs <dump dir> [...]');
  process.exit(2);
}
const dumps = dumpDirs.map((dir) => ({
  name: dir,
  meta: JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')),
  input: readFileSync(join(dir, 'input.rgba')).toString('base64'),
}));

const browser = await playwright.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed = true; };
try {
  const page = await browser.newPage();
  const res = await page.evaluate(pageMain, { sources, SHARMA, dumps });

  const worst = Math.max(...res.sharma.map((r) => Math.abs(r.expected - r.got)));
  check(worst < 1e-3, `GLSL dE2000 vs Sharma's 34 pairs: max error ${worst.toExponential(2)}`);

  for (const d of res.dumps) {
    const dir = dumps.find((x) => x.name === d.name);
    const n = d.w * d.h;
    const f32 = (file) => { const b = readFileSync(join(dir.name, file)); return new Float32Array(b.buffer, b.byteOffset, n); };
    const cpuDelta = f32('colordelta.f32');
    const cpuScore = f32('score.f32');
    const threshold = dir.meta.threshold;

    let deltaMax = 0;
    for (let i = 0; i < n; i++) deltaMax = Math.max(deltaMax, Math.abs(cpuDelta[i] - d.colorDelta[i]));
    check(deltaMax < 0.05, `${d.name}: color dE2000 per pixel, max |GPU - CPU| = ${deltaMax.toFixed(4)}`);

    let sum = 0, big = 0, flips = 0;
    for (let i = 0; i < n; i++) {
      const g = d.score[i] / 255;
      const e = Math.abs(g - cpuScore[i]);
      sum += e;
      if (e > 0.05) big++;
      if ((g >= threshold) !== (cpuScore[i] >= threshold)) flips++;
    }
    check(sum / n < 0.005 && big / n < 0.005, `${d.name}: score mean |diff| ${(sum / n).toFixed(4)}, ${(100 * big / n).toFixed(2)}% pixels off by > 0.05`);
    check(flips / n < 0.005, `${d.name}: critical/non-critical disagreement on ${(100 * flips / n).toFixed(2)}% of pixels at threshold ${threshold}`);

    for (const g of d.geometry) {
      check(g.maxScoreDiff === 0, `${d.name}: rotation ${g.rotation} + crop + 2x downscale (${g.size.join('x')}) reproduces the upright map (max diff ${g.maxScoreDiff}/255)`);
    }

    check(d.yuvDiff === 0, `${d.name}: camera YUV (padded rows, interleaved chroma) -> RGB matches colorcore's formula (max diff ${d.yuvDiff})`);
    check(d.uprightDiff === 0, `${d.name}: freeze frame from a 90-degree buffer equals the input (max diff ${d.uprightDiff})`);
    // The CPU averages with integer division, the GPU rounds: up to one level apart.
    check(d.probeDiff <= 1, `${d.name}: tap probe 5x5 average vs CPU (max diff ${d.probeDiff.toFixed(2)} levels)`);

    for (const name of ['heatmap', 'stripes']) {
      const cpu = readFileSync(join(dir.name, `${name}.rgba`));
      const gpu = d.display[name];
      let off = 0;
      for (let i = 0; i < n; i++) {
        let m = 0;
        for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(cpu[i * 4 + c] - gpu[i * 4 + c]));
        if (m > 3) off++;
      }
      check(off / n < 0.01, `${d.name}: display ${name} vs CPU overlay, ${(100 * off / n).toFixed(2)}% pixels differ by > 3 levels`);
    }
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
