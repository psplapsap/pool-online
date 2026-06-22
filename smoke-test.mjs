// Headless Puppeteer integration smoke test for the P2P 8-Ball Pool game.
// Exercises the REAL served page at http://localhost:8080/index.html with two
// browser pages (host + guest), drives a real PeerJS/WebRTC connection, and
// performs a real break shot, verifying balls move on BOTH pages.

import puppeteer from 'puppeteer';
import { writeFileSync, appendFileSync } from 'node:fs';

const URL = 'http://localhost:8080/index.html';
const DIR = 'c:/Users/nwenjun/Documents/cc/pool-online';
const TRACE = `${DIR}/smoke-trace.log`;
try { writeFileSync(TRACE, ''); } catch {}

const failures = [];
const evidence = [];
const consoleErrors = { host: [], guest: [] };
const pageErrors = { host: [], guest: [] };

function fail(severity, title, detail) {
  failures.push({ severity, title, detail });
}
function log(s) {
  evidence.push(s);
  console.log(s);
  try { appendFileSync(TRACE, `[${new Date().toISOString()}] ${s}\n`); } catch {}
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Evaluate with a hard per-call timeout so a stuck CDP call can't hang the test.
async function safeEval(page, fn, args, ms = 5000) {
  return Promise.race([
    page.evaluate(fn, args),
    new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate-timeout')), ms)),
  ]);
}

// Wait for a predicate evaluated in-page, polling.
async function waitFor(page, fn, args, { timeout = 15000, interval = 200 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const v = await safeEval(page, fn, args, 4000);
      if (v) return v;
    } catch (e) {
      /* page may be mid-navigation or call timed out; keep polling */
    }
    await sleep(interval);
  }
  return null;
}

// Map canvas-internal coords (900x500 space) -> viewport client coords.
async function canvasToClient(page, x, y) {
  return page.evaluate(
    ({ x, y }) => {
      const cv = document.getElementById('cv');
      const r = cv.getBoundingClientRect();
      return {
        cx: r.left + (x * r.width) / cv.width,
        cy: r.top + (y * r.height) / cv.height,
      };
    },
    { x, y }
  );
}

// Snapshot live ball positions from window.G on a page.
async function ballPositions(page) {
  return page.evaluate(() => {
    if (!window.G || !window.G.balls) return null;
    return window.G.balls.map((b) => ({ n: b.n, x: b.x, y: b.y, alive: b.alive }));
  });
}

function maxDelta(before, after) {
  if (!before || !after) return -1;
  let m = 0;
  for (const a of before) {
    const b = after.find((q) => q.n === a.n);
    if (!b) continue;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d > m) m = d;
  }
  return m;
}

let browser;
let passed = false;

try {
  browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 180000,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  log('Browser launched (headless). puppeteer ' + (await import('puppeteer/package.json', { with: { type: 'json' } })).default.version);

  const host = await browser.newPage();
  const guest = await browser.newPage();

  for (const [name, pg] of [['host', host], ['guest', guest]]) {
    pg.on('console', (msg) => {
      if (msg.type() === 'error') {
        const t = msg.text();
        consoleErrors[name].push(t);
        log(`[console.error ${name}] ${t}`);
      }
    });
    pg.on('pageerror', (err) => {
      pageErrors[name].push(err.message);
      log(`[pageerror ${name}] ${err.message}`);
    });
  }

  host.setDefaultTimeout(8000);
  guest.setDefaultTimeout(8000);

  log('Opening both pages...');
  await host.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await guest.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // give the PeerJS CDN script time to evaluate
  await sleep(1500);

  // Confirm PeerJS library loaded.
  const peerLoaded = await host.evaluate(() => typeof window.Peer === 'function');
  if (!peerLoaded) {
    fail('critical', 'PeerJS library did not load', 'window.Peer is not a function after page load; the unpkg CDN script may be blocked.');
  } else {
    log('PeerJS library loaded on host page.');
  }

  // ---- Host creates a room ----
  log('Host: clicking "Create room"...');
  // Use an evaluate-based click so we never block on page-lifecycle waits while
  // PeerJS spins up its (possibly failing) broker websocket.
  try {
    await safeEval(host, () => { document.getElementById('btnCreate').click(); return true; }, null, 6000);
  } catch (e) {
    log('Host create-click evaluate did not return cleanly: ' + e.message);
  }

  // Poll the status line so we capture whatever PeerJS reports (open vs error).
  // peer.on('error') sets "Error: <type> — try a new room."
  for (let i = 0; i < 12; i++) {
    await sleep(1500);
    let st = '(eval failed)';
    try {
      st = await safeEval(host, () => document.getElementById('status').textContent, null, 4000);
    } catch (e) {}
    log(`Host #status @${(i + 1) * 1.5}s: "${st}"`);
    if (st && (st.startsWith('Error:') || st.includes('Room created'))) break;
  }

  // The code only appears once peer "open" fires (broker reachable).
  const code = await waitFor(
    host,
    () => {
      const box = document.getElementById('codeBox');
      const c = document.getElementById('myCode').textContent.trim();
      if (box && box.style.display === 'flex' && c && c !== '…' && c.length === 4) return c;
      return null;
    },
    null,
    { timeout: 20000 }
  );

  if (!code) {
    let status = '(unavailable)';
    try { status = await safeEval(host, () => document.getElementById('status').textContent, null, 4000); } catch {}
    fail('critical', 'Host never received a room code from PeerJS broker', `#myCode never populated within 20s. Host #status text: "${status}". This indicates the PeerJS broker handshake (peer 'open' event) did not complete in this environment — the public PeerJS broker is unreachable.`);
    throw new Error('No room code; cannot continue connection test.');
  }
  log(`Host room code: ${code}`);

  // ---- Guest joins ----
  log(`Guest: typing code ${code} and clicking "Join room"...`);
  try {
    await safeEval(guest, (c) => {
      const inp = document.getElementById('codeIn');
      inp.value = c;
      document.getElementById('btnJoin').click();
      return true;
    }, code, 6000);
  } catch (e) {
    log('Guest join evaluate did not return cleanly: ' + e.message);
  }

  // ---- Verify connection established on BOTH pages ----
  // Host hides #lobby + reveals #hud + sets G when conn opens.
  const hostConnected = await waitFor(
    host,
    () => {
      const hud = document.getElementById('hud');
      return hud && !hud.classList.contains('hidden') && !!window.G;
    },
    null,
    { timeout: 15000 }
  );
  const guestConnected = await waitFor(
    guest,
    () => {
      const hud = document.getElementById('hud');
      return hud && !hud.classList.contains('hidden') && !!window.G;
    },
    null,
    { timeout: 15000 }
  );

  const safeText = async (pg, id) => {
    try { return await safeEval(pg, (i) => document.getElementById(i).textContent, id, 4000); }
    catch { return '(unavailable)'; }
  };
  const hostStatus = await safeText(host, 'status');
  const guestStatus = await safeText(guest, 'status');
  const hostTurnMsg = await safeText(host, 'turnmsg');
  const guestTurnMsg = await safeText(guest, 'turnmsg');
  log(`Host status: "${hostStatus}" | turnmsg: "${hostTurnMsg}"`);
  log(`Guest status: "${guestStatus}" | turnmsg: "${guestTurnMsg}"`);

  if (!hostConnected) fail('critical', 'Host did not reach connected/playing state', `#hud stayed hidden or window.G never set within 15s. Host #status: "${hostStatus}".`);
  if (!guestConnected) fail('critical', 'Guest did not reach connected/playing state', `#hud stayed hidden or window.G never set within 15s. Guest #status: "${guestStatus}".`);

  // Canvas drawn check: read a felt pixel + that >0 balls render. We confirm the
  // game state has the expected 16 balls and the canvas has nonzero pixel data.
  for (const [name, pg] of [['host', host], ['guest', guest]]) {
    const canvasOk = await pg.evaluate(() => {
      const cv = document.getElementById('cv');
      const ctx = cv.getContext('2d');
      const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let nonzero = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] || data[i + 1] || data[i + 2]) nonzero++;
      }
      return { nonzero, balls: window.G ? window.G.balls.length : 0 };
    });
    log(`${name} canvas: nonzero pixels=${canvasOk.nonzero}, balls in state=${canvasOk.balls}`);
    if (canvasOk.nonzero < 1000) fail('major', `${name} canvas appears not drawn`, `Only ${canvasOk.nonzero} non-black pixels.`);
    if (canvasOk.balls !== 16) fail('major', `${name} unexpected ball count`, `Expected 16 (cue + 15), got ${canvasOk.balls}.`);
  }

  if (!hostConnected || !guestConnected) {
    // Still take screenshots for evidence, then bail on the shot test.
    await host.screenshot({ path: `${DIR}/shot-host.png` });
    await guest.screenshot({ path: `${DIR}/shot-guest.png` });
    throw new Error('Connection not fully established; skipping break-shot test.');
  }

  // ---- Confirm it's the host's turn (host is P1, turn starts at 0) ----
  const turn = await host.evaluate(() => window.G.turn);
  const phase = await host.evaluate(() => window.G.phase);
  log(`Host G.turn=${turn} (expect 0), G.phase="${phase}" (expect aim)`);

  // ---- Simulate a break shot on the HOST page ----
  // Cue ball is at canvas (225, 250). Shot angle = atan2(p.y-cb.y, p.x-cb.x).
  // To shoot RIGHT toward the rack we drag the mouse to the LEFT of the cue ball
  // (so release fires the ball in the opposite/aim direction toward +x).
  // Power = clamp((dragDist - R)/14). Drag far for a strong break.
  const before = await ballPositions(host);
  log('Captured pre-shot ball positions on host.');

  const cb = { x: 225, y: 250 };
  const start = await canvasToClient(host, cb.x, cb.y); // on the cue ball
  const dragTo = await canvasToClient(host, cb.x - 180, cb.y); // 180px left -> strong power, aim +x

  log('Host: mousedown on cue ball, drag back, mouseup (break shot)...');
  await host.mouse.move(start.cx, start.cy);
  await host.mouse.down();
  // several moves so mousemove handler updates aim.angle + aim.power while dragging
  for (let i = 1; i <= 6; i++) {
    const fx = start.cx + (dragTo.cx - start.cx) * (i / 6);
    const fy = start.cy + (dragTo.cy - start.cy) * (i / 6);
    await host.mouse.move(fx, fy);
    await sleep(20);
  }
  const aimState = await host.evaluate(() => ({ angle: window.aim.angle, power: window.aim.power, dragging: window.aim.dragging }));
  log(`Host aim before release: angle=${aimState.angle.toFixed(3)} power=${aimState.power.toFixed(2)} dragging=${aimState.dragging}`);
  if (aimState.power <= 0.4) {
    fail('major', 'Break shot power too low to fire', `aim.power=${aimState.power} (needs >0.4). Mouse drag did not register enough distance.`);
  }
  await host.mouse.up();

  // ---- Wait for balls to move, then settle ----
  // Give the sim a moment, sample mid-motion to prove movement, then let it settle.
  await sleep(400);
  const hostMid = await ballPositions(host);
  const guestMid = await ballPositions(guest);
  const hostMoved = maxDelta(before, hostMid);
  log(`Host max ball displacement shortly after shot: ${hostMoved.toFixed(2)}px`);

  // also compare guest against the same baseline (guest mirrors host state)
  const guestMoved = maxDelta(before, guestMid);
  log(`Guest max ball displacement shortly after shot: ${guestMoved.toFixed(2)}px`);

  if (hostMoved < 2) fail('major', 'Balls did not move on HOST after break shot', `Max displacement only ${hostMoved.toFixed(2)}px.`);
  if (guestMoved < 2) fail('major', 'Balls did not move on GUEST after break shot', `Max displacement only ${guestMoved.toFixed(2)}px. State did not replicate over the data channel, or guest never got the shot.`);

  // Let physics settle for richer screenshots.
  await waitFor(host, () => window.G && window.G.phase !== 'sim', null, { timeout: 12000 });
  await sleep(500);

  const finalHost = await ballPositions(host);
  const phaseAfter = await host.evaluate(() => window.G.phase);
  const msgAfter = await host.evaluate(() => document.getElementById('turnmsg').textContent);
  log(`After settle: host phase="${phaseAfter}", turnmsg="${msgAfter}"`);
  const finalMoved = maxDelta(before, finalHost);
  log(`Host total displacement after settle: ${finalMoved.toFixed(2)}px`);

  // ---- Screenshots ----
  await host.screenshot({ path: `${DIR}/shot-host.png` });
  await guest.screenshot({ path: `${DIR}/shot-guest.png` });
  log('Saved screenshots shot-host.png and shot-guest.png');

  // ---- Console / pageerror gate ----
  const allConsole = [...consoleErrors.host, ...consoleErrors.guest];
  const allPageErr = [...pageErrors.host, ...pageErrors.guest];
  if (allPageErr.length) fail('critical', 'Uncaught JS errors (pageerror) occurred', allPageErr.join('\n'));
  if (allConsole.length) {
    // PeerJS sometimes logs benign errors; still report. Treat as major unless they break flow.
    fail('major', 'console.error output captured', allConsole.join('\n'));
  }

  passed = failures.filter((f) => f.severity === 'critical' || f.severity === 'major').length === 0;
} catch (e) {
  log('FATAL: ' + e.message + '\n' + (e.stack || ''));
  if (!failures.some((f) => f.title.includes(e.message)))
    fail('critical', 'Test threw before completion', e.message);
  passed = false;
} finally {
  if (browser) await browser.close();
}

const result = {
  passed,
  failures,
  consoleErrors,
  pageErrors,
  evidence,
};
writeFileSync(`${DIR}/smoke-result.json`, JSON.stringify(result, null, 2));
console.log('\n===RESULT_JSON_BEGIN===');
console.log(JSON.stringify(result));
console.log('===RESULT_JSON_END===');
