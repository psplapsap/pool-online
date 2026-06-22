// test-spin.mjs
// Faithful Node replica of the cue-ball spin/english application logic in
// pool-online/index.html (stepPhysics, lines ~508-549, plus hostHandleShot
// shot setup and the constants block).
//
// What we replicate:
//   - constants R, MAX_POWER (FRICTION/STOP not needed for the instantaneous
//     post-contact assertions below)
//   - the 1D equal-mass elastic exchange along the contact normal
//     (index.html lines 524-529)
//   - the spin/english block applied ONCE on first cue<->object contact
//     (index.html lines 530-549): follow/draw longitudinal add + side rotate
//     + stability clamp.
//
// We drive a single, controlled head-on cue->object collision (object ball
// directly ahead of the cue, both at rest except the cue moving +x) and read
// the cue's post-contact velocity. This isolates exactly what the spin code
// does, matching the source's "apply once on first momentum-exchanging
// cue/object contact" semantics.

const R = 11;
const MAX_POWER = 17;

// ---- faithful replica of the relevant slice of stepPhysics ----------------
// Resolves one cue->object collision (if overlapping & closing) and applies
// the spin block exactly as index.html does. Mutates the two balls in place.
// `shot` mirrors G.shot: { spinX, spinY, dirX, dirY, power, spinApplied }.
function applyCollisionWithSpin(cue, obj, shot) {
  const a = cue, b = obj;
  let dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy);
  if (!(dist > 0 && dist < 2 * R)) return; // no contact
  const nx = dx / dist, ny = dy / dist;
  const overlap = 2 * R - dist;
  a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
  b.x += nx * overlap / 2; b.y += ny * overlap / 2;
  // 1D elastic exchange along normal (equal mass) -- index.html 524-529
  const dvx = b.vx - a.vx, dvy = b.vy - a.vy;
  const rel = dvx * nx + dvy * ny;
  if (rel < 0) {
    a.vx += rel * nx; a.vy += rel * ny;
    b.vx -= rel * nx; b.vy -= rel * ny;
    // ---- spin / english (cue ball only, once per shot) -- index.html 530-549
    if (shot && !shot.spinApplied) {
      const c = a; // cue is `a` in our setup (a.n===0)
      const s = shot;
      const k = 0.18 * (s.power || 0);
      c.vx += s.dirX * s.spinY * k;
      c.vy += s.dirY * s.spinY * k;
      const ang = s.spinX * 0.12;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const rvx = c.vx * ca - c.vy * sa;
      const rvy = c.vx * sa + c.vy * ca;
      c.vx = rvx; c.vy = rvy;
      const sp = Math.hypot(c.vx, c.vy), cap = MAX_POWER * 1.2;
      if (sp > cap) { const f = cap / sp; c.vx *= f; c.vy *= f; }
      s.spinApplied = true;
    }
  }
}

// Build a head-on shot: cue at origin moving +x at `power`, object ball just
// ahead so they are in contact along the +x axis. Returns post-contact cue.
function headOnShot({ sx, sy, power = MAX_POWER }) {
  const angle = 0; // shooting along +x
  const cue = { n: 0, x: 0, y: 0, vx: Math.cos(angle) * power, vy: Math.sin(angle) * power, alive: true };
  // object ball placed at contact distance (touching) directly ahead
  const obj = { n: 1, x: 2 * R - 0.001, y: 0, vx: 0, vy: 0, alive: true };
  const shot = {
    spinX: sx, spinY: sy,
    dirX: Math.cos(angle), dirY: Math.sin(angle),
    power, spinApplied: false,
  };
  applyCollisionWithSpin(cue, obj, shot);
  return { cue, obj, shot };
}

// ---- spin offset clamp replica (index.html spinFromEvent, lines 410-411) ----
function clampSpin(nx, ny) {
  const m = Math.hypot(nx, ny);
  if (m > 1) { nx /= m; ny /= m; }
  return { sx: nx, sy: ny };
}

// ---- tiny test harness -----------------------------------------------------
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
}
const approx = (v, t, eps = 1e-6) => Math.abs(v - t) <= eps;

// 1. Stun (sy=0): head-on contact leaves the cue ~stopped.
{
  const { cue } = headOnShot({ sx: 0, sy: 0 });
  const speed = Math.hypot(cue.vx, cue.vy);
  check('stun (sy=0) leaves cue ~stopped after head-on', speed < 1e-6,
    `cue speed=${speed.toExponential(3)} (vx=${cue.vx}, vy=${cue.vy})`);
}

// 2. Follow (sy>0): cue retains FORWARD (+x) velocity after head-on contact.
{
  const { cue } = headOnShot({ sx: 0, sy: 0.8 });
  check('follow (sy>0) gives cue forward velocity', cue.vx > 0,
    `cue.vx=${cue.vx} (should be >0)`);
}

// 3. Follow vs stun: follow leaves more forward speed than stun.
{
  const stun = headOnShot({ sx: 0, sy: 0 }).cue;
  const foll = headOnShot({ sx: 0, sy: 0.8 }).cue;
  check('follow forward speed > stun forward speed', foll.vx > stun.vx,
    `follow.vx=${foll.vx} > stun.vx=${stun.vx}`);
}

// 4. Draw (sy<0): cue gets BACKWARD (-x) velocity after head-on contact.
{
  const { cue } = headOnShot({ sx: 0, sy: -0.8 });
  check('draw (sy<0) gives cue backward velocity', cue.vx < 0,
    `cue.vx=${cue.vx} (should be <0)`);
}

// 5. Side english (sx) biases direction: nonzero sx deflects the cue off-axis.
//    With follow so there's a velocity to rotate, sx>0 should produce vy!=0.
{
  const { cue } = headOnShot({ sx: 0.9, sy: 0.8 });
  // ang = sx*0.12 > 0; rotating a +x velocity by +ang yields vy>0.
  check('side english (sx!=0) biases direction (vy nonzero)', Math.abs(cue.vy) > 1e-9,
    `cue.vy=${cue.vy} for sx=0.9`);
  // opposite side gives opposite-sign deflection
  const { cue: cue2 } = headOnShot({ sx: -0.9, sy: 0.8 });
  check('opposite side english flips deflection sign', Math.sign(cue.vy) === -Math.sign(cue2.vy) && cue2.vy !== 0,
    `vy(+sx)=${cue.vy}, vy(-sx)=${cue2.vy}`);
}

// 6. Spin offset is clamped to the unit circle: |(sx,sy)| <= 1 for any input.
{
  const samples = [
    [0, 0], [1, 0], [0, 1], [0.5, 0.5], [3, 4], [-10, 10], [100, -100], [0.7, 0.7],
  ];
  let allOk = true, worst = 0;
  for (const [x, y] of samples) {
    const { sx, sy } = clampSpin(x, y);
    const m = Math.hypot(sx, sy);
    if (m > worst) worst = m;
    if (m > 1 + 1e-9) allOk = false;
  }
  check('spin offset clamped to unit circle (|sx,sy|<=1)', allOk,
    `max magnitude after clamp=${worst}`);
  // sanity: a known out-of-circle point maps onto the circle (3,4)->mag 1
  const { sx, sy } = clampSpin(3, 4);
  check('clamp normalizes (3,4) onto unit circle', approx(Math.hypot(sx, sy), 1),
    `(${sx},${sy}) mag=${Math.hypot(sx, sy)}`);
}

// 7. No NaN for extreme inputs (huge power, extreme spin, post-clamp spin).
{
  const extremeCases = [
    { sx: 1, sy: 1, power: 1e6 },
    { sx: -1, sy: -1, power: MAX_POWER },
    { sx: 1, sy: -1, power: 1e9 },
    { sx: 0, sy: 1, power: 0 },
  ];
  let anyNaN = false, bad = '';
  for (const c of extremeCases) {
    // clamp spin first as the real UI does, then shoot
    const { sx, sy } = clampSpin(c.sx, c.sy);
    const { cue } = headOnShot({ sx, sy, power: c.power });
    if (!Number.isFinite(cue.vx) || !Number.isFinite(cue.vy)) {
      anyNaN = true; bad = JSON.stringify({ c, vx: cue.vx, vy: cue.vy });
    }
  }
  check('no NaN/Infinity for extreme inputs', !anyNaN, bad || 'all finite');
  // The stability clamp must keep speed <= MAX_POWER*1.2 even on absurd power.
  const { cue } = headOnShot({ sx: 1, sy: 1, power: 1e6 });
  const sp = Math.hypot(cue.vx, cue.vy);
  check('stability clamp caps cue speed at MAX_POWER*1.2', sp <= MAX_POWER * 1.2 + 1e-6,
    `capped speed=${sp}, cap=${MAX_POWER * 1.2}`);
}

// ---- report ----------------------------------------------------------------
let passCount = 0;
for (const r of results) {
  const tag = r.pass ? 'PASS' : 'FAIL';
  if (r.pass) passCount++;
  console.log(`[${tag}] ${r.name}${r.detail ? '  -- ' + r.detail : ''}`);
}
console.log(`\n${passCount}/${results.length} assertions passed`);
if (passCount !== results.length) process.exit(1);
