/* ================================================================
   CHLADNI // MODAL — v8ui half of the max for live instrument

   this object owns the plate. it builds the mode catalogue from the
   geometry / edge / dispersion / drive-point parameters (the same
   kirchhoff solutions as the web app), writes the per-mode tables the
   gen~ voices resonate with, and draws the sand.

   tables written (names arrive from the patcher, so --- is resolved):
     mratio    mode frequency / plate fundamental, ascending   (≤ 64)
     mgain     coupling² at the drive point (driver = pickup)    (≤ 64)
     ladder    every distinct resonance ratio, for ladder mode   (≤ 128)
     partials  drive waveform harmonic amplitudes, n = 1..8      (8)

   the picture is an estimate built from the same note events the gen~
   voices get: struck modes ring down at their own Q, driven modes sit
   at their steady-state response — the sand integrates the rms field.
   ================================================================ */

autowatch = 0;
inlets = 1;
outlets = 1;

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

const TAU = 2 * Math.PI;
const EULER = 0.5772156649015329;
const GRID = 64;            // rms field resolution
const MAXAUDIO = 64;        // gen~ Data size
const MAXLADDER = 128;
const MAXGRAINS = 8000;
const NVOICES = 8;

const P = {
  geom: 1, edge: 1, disp: 0, aspect: 1, dx: 0.62, dy: 0.38,
  wave: 0, partials: 5, tilt: 0, focus: 0, focusq: 0.6,
  mapmode: 0, platetune: 36, keytrack: 100, q: 300, damp: 50,
  strike: 80, hardness: 50, drive: 0, dattack: 20, drelease: 300,
  field: 0, palette: 0, grains: 3000, trails: 0, crawl: 0.2, hop: 0.05,
  jitter: 0.15, feed: 1, hue: 42,
};

/* ================================================================
   special functions — bessel J / I, beam eigenfunctions, roots
   ================================================================ */

function besselJ(n, x) {
  if (x < 0) { const v = besselJ(n, -x); return (n & 1) ? -v : v; }
  const h = x / 2;
  let t = 1;
  for (let i = 0; i < n; i++) t *= h / (i + 1);
  let sum = 0;
  for (let k = 0; k < 120; k++) {
    sum += t;
    t *= -(h * h) / ((k + 1) * (k + 1 + n));
    if (Math.abs(t) < 1e-17 * (Math.abs(sum) + 1e-30)) break;
  }
  return sum;
}
function besselJp(n, x) {
  return n === 0 ? -besselJ(1, x) : 0.5 * (besselJ(n - 1, x) - besselJ(n + 1, x));
}
function besselI(n, x) {
  const h = x / 2;
  let t = 1;
  for (let i = 0; i < n; i++) t *= h / (i + 1);
  let sum = 0;
  for (let k = 0; k < 300; k++) {
    sum += t;
    t *= (h * h) / ((k + 1) * (k + 1 + n));
    if (t < 1e-18 * sum) break;
  }
  return sum;
}
function besselIp(n, x) {
  return n === 0 ? besselI(1, x) : 0.5 * (besselI(n - 1, x) + besselI(n + 1, x));
}

// roots of f on (lo, hi] by scan + bisection
function findRoots(f, lo, hi, step, want) {
  const out = [];
  let xa = lo, fa = f(xa);
  for (let x = lo + step; x <= hi && out.length < want; x += step) {
    const fb = f(x);
    if (Number.isFinite(fa) && Number.isFinite(fb) && (fa < 0) !== (fb < 0)) {
      let a = xa, b = x, fA = fa;
      for (let i = 0; i < 70; i++) {
        const m = 0.5 * (a + b), fm = f(m);
        if (!Number.isFinite(fm)) break;
        if ((fA < 0) !== (fm < 0)) b = m; else { a = m; fA = fm; }
      }
      out.push(0.5 * (a + b));
    }
    xa = x; fa = fb;
  }
  return out;
}

// clamped-clamped and free-free beams share cos β cosh β = 1
const BEAM_ROOTS = findRoots(b => Math.cos(b) - 1 / Math.cosh(b), 1.0, 32, 0.05, 10);

function beamClamped(b, x) {
  const sh = Math.sinh(b), sn = Math.sin(b);
  const oneMinusS = (Math.cos(b) - sn - Math.exp(-b)) / (sh - sn);
  const s = 1 - oneMinusS;
  const t = b * x;
  const coshMinus = 0.5 * (oneMinusS * Math.exp(t) + (2 - oneMinusS) * Math.exp(-t));
  return coshMinus - Math.cos(t) + s * Math.sin(t);
}

function beamMode(cond, i) {
  if (cond === 'supported') { const m = i + 1; return { beta: m * Math.PI, fn: x => Math.sin(m * Math.PI * x) }; }
  if (cond === 'free')      { const m = i;     return { beta: m * Math.PI, fn: x => Math.cos(m * Math.PI * x) }; }
  const b = BEAM_ROOTS[i];
  return b === undefined ? null : { beta: b, fn: x => beamClamped(b, x) };
}

/* ---- 1-d profile bank: beam functions or radial bessel, normalised to ±1 ---- */
const PROF_W = 256, PROF_ROWS = 128;
const profData = new Float32Array(PROF_W * PROF_ROWS);
let profCount = 0;

function addProfile(fn) {
  if (profCount >= PROF_ROWS) return -1;
  const row = profCount++;
  const tmp = new Float64Array(PROF_W);
  let mx = 0;
  for (let i = 0; i < PROF_W; i++) {
    const v = fn(i / (PROF_W - 1));
    tmp[i] = Number.isFinite(v) ? v : 0;
    if (Math.abs(tmp[i]) > mx) mx = Math.abs(tmp[i]);
  }
  const s = mx > 1e-12 ? 1 / mx : 0;
  for (let i = 0; i < PROF_W; i++) profData[row * PROF_W + i] = tmp[i] * s;
  return row;
}
function profSample(row, s) {
  if (row < 0) return 0;
  const t = Math.min(1, Math.max(0, s)) * (PROF_W - 1);
  const i = t | 0, f = t - i, o = row * PROF_W + i;
  const b = (i + 1 < PROF_W) ? profData[o + 1] : profData[o];
  return profData[o] + (b - profData[o]) * f;
}

/* ================================================================
   mode catalogue
   ================================================================ */

const EDGE_NAMES = ['free', 'supported', 'clamped', 'mixed'];
let catalogue = [];     // { p, q, psi, F, c, W }
let fMin = 1;           // lowest eigenvalue, the plate's fundamental
let audioRatio = [], ladderRatio = [];

function buildCatalogue() {
  profCount = 0;
  profData.fill(0);
  const list = [];
  const toF = k2 => P.disp === 0 ? k2 / (Math.PI * Math.PI) : Math.sqrt(k2) / Math.PI;
  const edge = EDGE_NAMES[P.edge] || 'supported';

  if (P.geom === 0) {
    // one beam-function bank per axis; "mixed" clamps x and frees y
    const condX = edge === 'mixed' ? 'clamped' : edge;
    const condY = edge === 'mixed' ? 'free' : edge;
    const bank = cond => {
      const out = [];
      for (let i = 0; i < 10; i++) {
        const b = beamMode(cond, i);
        if (!b) break;
        b.row = addProfile(b.fn);
        out.push(b);
      }
      return out;
    };
    const xs = bank(condX), ys = bank(condY);
    // aspect at constant area, so frequencies stay comparable as it stretches
    const w = Math.sqrt(P.aspect), h = 1 / Math.sqrt(P.aspect);
    for (const bx of xs) for (const by of ys) {
      const kx = bx.beta / w, ky = by.beta / h;
      const k2 = kx * kx + ky * ky;
      if (k2 < 1e-9) continue;
      list.push({ p: bx.row, q: by.row, psi: 0, F: toF(k2) });
    }
  } else {
    // a disc has no mixed rim; it falls back to clamped
    const rim = edge === 'mixed' ? 'clamped' : edge;
    for (let n = 0; n < 8; n++) {
      let ks, mk;
      if (rim === 'supported') {
        ks = findRoots(k => besselJ(n, k), 0.05, 26, 0.05, 6);
        mk = k => u => besselJ(n, k * u);
      } else if (rim === 'free') {
        ks = findRoots(k => besselJp(n, k), 0.05, 26, 0.05, 6);
        mk = k => u => besselJ(n, k * u);
      } else {
        ks = findRoots(k => besselJ(n, k) * (besselIp(n, k) / besselI(n, k)) - besselJp(n, k), 0.4, 26, 0.02, 6);
        mk = k => { const ci = besselJ(n, k) / besselI(n, k); return u => besselJ(n, k * u) - ci * besselI(n, k * u); };
      }
      for (let s = 0; s < ks.length; s++) {
        const k = ks[s];
        if (!Number.isFinite(k) || k < 0.05) continue;
        const row = addProfile(mk(k));
        if (row < 0) break;
        const F = toF(k * k);
        list.push({ p: n, q: row, psi: 0, F });
        if (n > 0) list.push({ p: n, q: row, psi: Math.PI / 2, F });
      }
    }
  }

  list.sort((a, b) => a.F - b.F);
  catalogue = list;
  fMin = list.length ? list[0].F : 1;
  for (const m of catalogue) m.W = shapeGrid(m);
  ladderRatio = [...new Set(catalogue.map(m => +(m.F / fMin).toFixed(6)))]
    .sort((a, b) => a - b).slice(0, MAXLADDER);
}

function shapeAt(m, x, y) {
  if (P.geom === 0) return profSample(m.p, x) * profSample(m.q, y);
  const cx = x * 2 - 1, cy = y * 2 - 1;
  const r = Math.min(1, Math.hypot(cx, cy));
  return profSample(m.q, r) * Math.cos(m.p * Math.atan2(cy, cx) + m.psi);
}

function shapeGrid(m) {
  const W = new Float32Array(GRID * GRID);
  for (let gy = 0; gy < GRID; gy++) {
    const y = (gy + 0.5) / GRID;
    for (let gx = 0; gx < GRID; gx++) {
      const x = (gx + 0.5) / GRID;
      if (P.geom === 1 && Math.hypot(x * 2 - 1, y * 2 - 1) > 1) continue;
      W[gy * GRID + gx] = shapeAt(m, x, y);
    }
  }
  return W;
}

// the excitation point projected onto the material
function drivePoint() {
  let x = Math.min(1, Math.max(0, P.dx)), y = Math.min(1, Math.max(0, P.dy));
  if (P.geom === 1) {
    let cx = x * 2 - 1, cy = y * 2 - 1, r = Math.hypot(cx, cy);
    if (r < 1e-6) { cx = 1; cy = 0; r = 1; }
    const rr = Math.min(0.995, r);
    x = 0.5 + 0.5 * cx / r * rr;
    y = 0.5 + 0.5 * cy / r * rr;
  }
  return [x, y];
}

/* coupling at the drive point, and the audio table. the driver doubles as the
   pickup, so a mode's level is c²; degenerate partners share one resonator. */
function updateCoupling() {
  const [x, y] = drivePoint();
  for (const m of catalogue) m.c = shapeAt(m, x, y);

  const merged = [];
  for (const m of catalogue) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(m.F - last.F) < 1e-6 * m.F) last.g += m.c * m.c;
    else merged.push({ F: m.F, g: m.c * m.c });
  }
  let gmax = 0;
  for (const e of merged) gmax = Math.max(gmax, e.g);
  const kept = merged.filter(e => e.g > gmax * 1e-4).slice(0, MAXAUDIO);
  audioRatio = kept.map(e => e.F / fMin);
  writeTable('mratio', audioRatio, MAXAUDIO);
  writeTable('mgain', kept.map(e => gmax > 0 ? e.g / gmax : 0), MAXAUDIO);
  outlet(0, 'nmodes', kept.length);
}

/* ---- drive spectrum: waveform → partial amplitudes (same as the web app) ---- */
let spec = [];
function buildSpectrum() {
  const nMax = P.wave === 0 ? 1 : Math.round(P.partials);
  const out = [];
  for (let n = 1; n <= nMax; n++) {
    let a = P.wave === 0 ? (n === 1 ? 1 : 0) : P.wave === 2 ? 1 / n : ((n & 1) ? 1 / n : 0);
    if (a < 1e-6) continue;
    a *= Math.pow(n, P.tilt);
    if (P.focus > 0.02) {
      const d = (n - P.focus) / Math.max(0.05, P.focusq);
      a *= Math.exp(-d * d);
    }
    out.push({ n, a });
  }
  let peak = 0;
  for (const p of out) peak = Math.max(peak, p.a);
  const kept = peak > 0 ? out.filter(p => p.a > peak * 1e-4) : out;
  const tot = kept.reduce((s, p) => s + p.a, 0) || 1;
  kept.forEach(p => { p.a /= tot; });
  spec = kept.length ? kept : [{ n: 1, a: 1 }];

  const amps = new Array(8).fill(0);
  let top = 1;
  for (const p of spec) { amps[p.n - 1] = p.a; top = Math.max(top, p.n); }
  writeTable('partials', amps, 8);
  outlet(0, 'npart', top);
}

/* ---- buffer~ access ---- */
const bufName = { mratio: null, mgain: null, ladder: null, partials: null };
function writeTable(key, values, size) {
  if (!bufName[key]) return;
  try {
    const b = new Buffer(bufName[key]);
    if (b.framecount() !== size) b.send('sizeinsamps', size);
    const v = new Array(size).fill(0);
    for (let i = 0; i < Math.min(size, values.length); i++) v[i] = values[i];
    b.poke(1, 0, v);
  } catch (e) {
    post('chladni: cannot write ' + bufName[key] + ': ' + e + '\n');
  }
}

let ready = false;
function rebuildPlate() {
  if (!ready) return;
  buildCatalogue();
  writeTable('ladder', ladderRatio, MAXLADDER);
  outlet(0, 'nladder', ladderRatio.length);
  updateCoupling();
  mgraphics.redraw();
}
function rebuildDrivePoint() {
  if (!ready) return;
  updateCoupling();
}
function rebuildSpectrum() {
  if (!ready) return;
  buildSpectrum();
}

/* ================================================================
   messages
   ================================================================ */

function bufs(a, b, c, d) {
  bufName.mratio = a; bufName.mgain = b; bufName.ladder = c; bufName.partials = d;
}
function init() {
  ready = true;
  buildSpectrum();
  rebuildPlate();
  scatterGrains();
}

const PLATE_KEYS = ['geom', 'edge', 'disp', 'aspect'];
const POINT_KEYS = ['dx', 'dy'];
const SPEC_KEYS = ['wave', 'partials', 'tilt', 'focus', 'focusq'];
function setParam(k, v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return;
  const old = P[k];
  P[k] = v;
  if (old === v) return;
  if (PLATE_KEYS.indexOf(k) >= 0) { rebuildPlate(); if (k === 'geom' || k === 'aspect') scatterGrains(); }
  else if (POINT_KEYS.indexOf(k) >= 0) rebuildDrivePoint();
  else if (SPEC_KEYS.indexOf(k) >= 0) rebuildSpectrum();
}
// every parameter arrives as "<name> <value>"
function anything() {
  const a = arrayfromargs(arguments);
  if (P.hasOwnProperty(messagename)) setParam(messagename, a[0]);
}

/* ---- voices, mirrored from the note stream the gen~ voices get ---- */
const voices = [];
for (let i = 0; i < NVOICES; i++) voices.push({ on: false, pitch: 60, vel: 0, age: 1e9, tEff: 1e9, env: 0, active: false });

function voice(v, pitch, vel) {
  const vo = voices[(v | 0) - 1];
  if (!vo) return;
  if (vel > 0) {
    vo.on = true; vo.pitch = pitch; vo.vel = vel / 127;
    vo.age = 0; vo.tEff = 0; vo.active = true;
  } else if (pitch === vo.pitch) {
    vo.on = false;
  }
}

function mtof(n) { return 440 * Math.pow(2, (n - 69) / 12); }

// plate fundamental and drive frequency for a voice — mirrors the gen~ code
function voiceFreqs(vo) {
  if (P.mapmode < 0.5) {
    return [mtof(P.platetune + (vo.pitch - P.platetune) * P.keytrack / 100), mtof(vo.pitch)];
  }
  const f0 = mtof(P.platetune);
  const n = ladderRatio.length;
  if (!n) return [f0, f0];
  const rung = Math.min(n - 1, Math.max(0, Math.round(vo.pitch - P.platetune)));
  return [f0, f0 * ladderRatio[rung]];
}

/* ================================================================
   field estimate
   ================================================================ */

const field = new Float32Array(GRID * GRID);     // normalised rms, 0..1
const motionField = new Float32Array(GRID * GRID);
const accRe = new Float32Array(GRID * GRID), accIm = new Float32Array(GRID * GRID);
let refLevel = 1e-9, clock = 0;

function tickVoices(dt) {
  const qe = P.q * (1 - 0.98 * P.damp / 100);
  for (const vo of voices) {
    if (!vo.active) continue;
    vo.age += dt;
    // decay runs faster once released, so count it in units of the held Q
    vo.tEff += vo.on ? dt : dt * P.q / Math.max(1, qe);
    const tgt = vo.on ? vo.vel : 0;
    const tau = (tgt > vo.env ? P.dattack : P.drelease) / 1000;
    vo.env += (tgt - vo.env) * (1 - Math.exp(-dt / Math.max(0.001, tau)));
    if (!vo.on && vo.env < 1e-3 && vo.tEff * Math.PI * mtof(P.platetune) / P.q > 12) vo.active = false;
  }
}

// complex modal amplitudes, grouped by what sums coherently
function collectComponents() {
  const comps = [];
  const hard = 0.5 * Math.pow(0.02, P.hardness / 100);           // mallet contact, in plate periods
  for (let v = 0; v < NVOICES; v++) {
    const vo = voices[v];
    if (!vo.active) continue;
    const [f0, fd] = voiceFreqs(vo);
    const hz = f0 / fMin, T = hard / f0;

    // struck: every mode rings at its own frequency and decays at its own rate
    if (P.strike > 0) {
      const s = P.strike / 100 * vo.vel;
      for (let i = 0; i < catalogue.length; i++) {
        const m = catalogue[i], F = m.F * hz;
        if (F > 20000) break;
        const mal = 1 / (1 + Math.pow(2 * F * T, 4));
        const a = s * m.c * mal * Math.exp(-Math.PI * F * vo.tEff / P.q);
        comps.push({ i, re: a, im: 0, g: 'v' + v + 'f' + m.F.toFixed(6), fr: F / f0 });
      }
    }
    // driven: steady-state response of every mode to every partial, peak-normalised by Q
    if (P.drive > 0 && vo.env > 1e-4) {
      const d = P.drive / 100 * vo.env;
      for (const p of spec) {
        const fp = p.n * fd;
        for (let i = 0; i < catalogue.length; i++) {
          const m = catalogue[i], r = fp / (m.F * hz);
          const dre = 1 - r * r, dim = r / P.q;
          const g = d * p.a * m.c / (P.q * (dre * dre + dim * dim));
          comps.push({ i, re: g * dre, im: -g * dim, g: 'v' + v + 'p' + p.n, fr: fp / f0 });
        }
      }
    }
  }
  let mx = 0;
  for (const c of comps) mx = Math.max(mx, Math.hypot(c.re, c.im));
  return comps.filter(c => Math.hypot(c.re, c.im) > mx * 0.01)
              .sort((a, b) => Math.hypot(b.re, b.im) - Math.hypot(a.re, a.im))
              .slice(0, 160);
}

function computeField(dt) {
  clock += dt;
  const comps = collectComponents();
  const N = GRID * GRID;
  field.fill(0);
  motionField.fill(0);

  const groups = new Map();
  for (const c of comps) {
    if (!groups.has(c.g)) groups.set(c.g, []);
    groups.get(c.g).push(c);
  }
  const wantMotion = P.field === 1;
  groups.forEach(list => {
    accRe.fill(0); accIm.fill(0);
    for (const c of list) {
      const W = catalogue[c.i].W;
      for (let j = 0; j < N; j++) { accRe[j] += c.re * W[j]; accIm[j] += c.im * W[j]; }
      if (wantMotion) {
        // the plate in slow motion — a fundamental cycle every two and a half seconds
        const th = TAU * c.fr * 0.4 * clock;
        const q = c.re * Math.cos(th) - c.im * Math.sin(th);
        for (let j = 0; j < N; j++) motionField[j] += q * W[j];
      }
    }
    for (let j = 0; j < N; j++) field[j] += accRe[j] * accRe[j] + accIm[j] * accIm[j];
  });

  let peak = 0;
  for (let j = 0; j < N; j++) { field[j] = Math.sqrt(0.5 * field[j]); if (field[j] > peak) peak = field[j]; }
  // the figure is drawn at full strength while it sounds and fades with the ring-down
  refLevel = Math.max(peak, refLevel * Math.exp(-dt / 1.5), 1e-9);
  const k = 1 / refLevel;
  for (let j = 0; j < N; j++) { field[j] *= k; motionField[j] *= k / Math.SQRT2; }
}

function rmsAt(x, y) {
  let u = x * GRID - 0.5, v = y * GRID - 0.5;
  u = Math.min(GRID - 1.001, Math.max(0, u));
  v = Math.min(GRID - 1.001, Math.max(0, v));
  const i = u | 0, j = v | 0, fu = u - i, fv = v - j;
  const a = field[j * GRID + i], b = field[j * GRID + i + 1];
  const c = field[(j + 1) * GRID + i], d = field[(j + 1) * GRID + i + 1];
  return (a + (b - a) * fu) * (1 - fv) + (c + (d - c) * fu) * fv;
}

/* ================================================================
   grains — crawl down the gradient of the rms field to the nodes
   ================================================================ */

const gpos = new Float32Array(MAXGRAINS * 2);
let grainCount = 0, feedAcc = 0, feedPtr = 0;

function placeGrain(i) {
  let x, y;
  if (P.geom === 1) {
    const r = Math.sqrt(Math.random()) * 0.995, t = Math.random() * TAU;
    x = 0.5 + 0.5 * r * Math.cos(t);
    y = 0.5 + 0.5 * r * Math.sin(t);
  } else {
    x = Math.random(); y = Math.random();
  }
  gpos[i * 2] = x; gpos[i * 2 + 1] = y;
}
function scatterGrains() {
  grainCount = Math.min(MAXGRAINS, Math.round(P.grains));
  for (let i = 0; i < grainCount; i++) placeGrain(i);
}

function stepGrains(dt) {
  const n = Math.min(MAXGRAINS, Math.round(P.grains));
  if (n !== grainCount) {
    for (let i = grainCount; i < n; i++) placeGrain(i);
    grainCount = n;
  }
  if (!grainCount) return;

  // the population keeps turning over, so a figure is never frozen in place
  if (P.feed > 0 && refLevel > 1e-8) {
    feedAcc += P.feed * grainCount * dt;
    const whole = Math.min(grainCount, Math.floor(feedAcc));
    feedAcc -= whole;
    for (let j = 0; j < whole; j++) placeGrain(feedPtr++ % grainCount);
    feedPtr %= grainCount;
  }

  const eps = 1 / GRID, speed = P.crawl * 0.9 * dt, jit = P.jitter * 1.8 * dt, thr = P.hop;
  const round = P.geom === 1;
  for (let i = 0; i < grainCount; i++) {
    const ix = i * 2, iy = ix + 1;
    let x = gpos[ix], y = gpos[iy];
    const here = rmsAt(x, y);
    // a grain only hops while the local acceleration beats gravity
    const mob = here <= thr ? 0 : Math.min(1, (here - thr) / 0.25);
    if (mob > 0) {
      const gx = (rmsAt(x + eps, y) - rmsAt(x - eps, y)) * 0.5;
      const gy = (rmsAt(x, y + eps) - rmsAt(x, y - eps)) * 0.5;
      const gm = Math.hypot(gx, gy) + 1e-6;
      const j = jit * here;
      x -= (gx / gm) * speed * mob - (Math.random() - 0.5) * j;
      y -= (gy / gm) * speed * mob - (Math.random() - 0.5) * j;
    }
    if (round) {
      const cx = x * 2 - 1, cy = y * 2 - 1, r = Math.hypot(cx, cy);
      if (r > 0.995) { x = 0.5 + 0.5 * cx / r * 0.99; y = 0.5 + 0.5 * cy / r * 0.99; }
    } else {
      if (x < 0) x = -x; else if (x > 1) x = 2 - x;
      if (y < 0) y = -y; else if (y > 1) y = 2 - y;
    }
    gpos[ix] = x; gpos[iy] = y;
  }
}

/* ================================================================
   drawing
   ================================================================ */

const BG = [0.039, 0.043, 0.055];          // #0a0b0e
const PALETTES = [
  [[1.00, 0.82, 0.45], [0.24, 0.42, 0.62]],   // brass
  [[0.62, 0.93, 1.00], [0.30, 0.36, 0.80]],   // ice
  [[1.00, 0.62, 0.28], [0.52, 0.10, 0.36]],   // ember
  null,                                       // mono
];
function paletteRgb(t) {
  const a = Math.min(1, Math.abs(t));
  const pal = PALETTES[P.palette | 0];
  if (!pal) return [BG[0] + (1 - BG[0]) * a, BG[1] + (1 - BG[1]) * a, BG[2] + (1 - BG[2]) * a];
  const c = t > 0 ? pal[0] : pal[1], k = Math.pow(a, 0.75);
  return [BG[0] + (c[0] - BG[0]) * k, BG[1] + (c[1] - BG[1]) * k, BG[2] + (c[2] - BG[2]) * k];
}
function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

// where the plate sits in the view, in pixels: [x, y, w, h]
let viewW = 160, viewH = 160;
function plateRect() {
  const S = Math.min(viewW, viewH) - 8;
  let pw = S, ph = S;
  if (P.geom === 0) { if (P.aspect >= 1) ph = S / P.aspect; else pw = S * P.aspect; }
  return [(viewW - pw) / 2, (viewH - ph) / 2, pw, ph];
}

let surf = null, surfW = 0, surfH = 0, fieldImg = null;

function paint() {
  const mg = mgraphics;
  viewW = mg.size[0]; viewH = mg.size[1];
  if (!surf || surfW !== viewW || surfH !== viewH) {
    surf = new MGraphics(viewW, viewH);
    surfW = viewW; surfH = viewH;
    surf.set_source_rgba(BG[0], BG[1], BG[2], 1);
    surf.rectangle(0, 0, viewW, viewH);
    surf.fill();
  }
  // trails: the new frame goes over the old one at 1 − trails
  const alpha = 1 - Math.min(0.97, Math.max(0, P.trails));
  const [px, py, pw, ph] = plateRect();

  surf.set_source_rgba(BG[0], BG[1], BG[2], alpha);
  surf.rectangle(0, 0, viewW, viewH);
  surf.fill();

  if (P.field > 0 && ready) {
    if (!fieldImg) fieldImg = new Image(GRID, GRID);
    const src = P.field === 1 ? motionField : field;
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const x = (gx + 0.5) / GRID, y = (gy + 0.5) / GRID;
        if (P.geom === 1 && Math.hypot(x * 2 - 1, y * 2 - 1) > 1) { fieldImg.setpixel(gx, gy, BG[0], BG[1], BG[2], 0); continue; }
        const c = paletteRgb(src[gy * GRID + gx]);
        fieldImg.setpixel(gx, gy, c[0], c[1], c[2], alpha);
      }
    }
    surf.save();
    surf.translate(px, py);
    surf.scale(pw / GRID, ph / GRID);
    surf.image_surface_draw(fieldImg);
    surf.restore();
  }

  if (grainCount > 0) {
    const gc = hsl2rgb(P.hue, 0.72, 0.86);
    const s = Math.max(1, Math.min(pw, ph) / 140);
    surf.set_source_rgba(gc[0], gc[1], gc[2], 0.9);
    for (let i = 0; i < grainCount; i++) {
      surf.rectangle(px + gpos[i * 2] * pw - s / 2, py + gpos[i * 2 + 1] * ph - s / 2, s, s);
    }
    surf.fill();
  }

  mg.image_surface_draw(new Image(surf));

  // plate outline and the drive point sit on top, out of the trail buffer
  mg.set_line_width(1);
  mg.set_source_rgba(1, 1, 1, 0.14);
  if (P.geom === 1) mg.ellipse(px, py, pw, ph);
  else mg.rectangle(px, py, pw, ph);
  mg.stroke();

  const [dpx, dpy] = drivePoint();
  mg.set_source_rgba(1, 0.36, 0.42, 0.95);
  mg.ellipse(px + dpx * pw - 3, py + dpy * ph - 3, 6, 6);
  mg.fill();
}

/* ---- click or drag the plate to move the drive point ---- */
function setPointFromMouse(x, y) {
  const [px, py, pw, ph] = plateRect();
  const u = Math.min(1, Math.max(0, (x - px) / pw));
  const v = Math.min(1, Math.max(0, (y - py) / ph));
  outlet(0, 'dx', u);          // goes out to the dials, which send it back in
  outlet(0, 'dy', v);
}
function onclick(x, y) { setPointFromMouse(x, y); }
function ondrag(x, y, but) { if (but) setPointFromMouse(x, y); }

/* ---- animation ---- */
let lastTick = Date.now();
function tick() {
  const now = Date.now();
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  if (!ready) return;
  tickVoices(dt);
  computeField(dt);
  stepGrains(dt);
  mgraphics.redraw();
}
const tsk = new Task(tick, this);
tsk.interval = 33;
tsk.repeat();

function notifydeleted() { tsk.cancel(); }
