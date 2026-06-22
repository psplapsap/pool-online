/* Faithful replication of pool-online/index.html game logic for unit testing.
   Only pure logic is replicated: constants, freshState, rack, physics step,
   resolveShot, groupCleared, isStripe, canPlaceCue. No rendering/networking.
   Source lines referenced inline. */

// ---------- constants (source 86-93) ----------
const W = 900, H = 500;
const RAIL = 36;
const R = 11;
const POCKET = 19;
const FRICTION = 0.988;
const STOP = 0.05;
const MAX_POWER = 17;
const SUBSTEPS = 3;

// pockets (source 99-102)
const POCKETS = [
  {x:RAIL, y:RAIL}, {x:W/2, y:RAIL-6}, {x:W-RAIL, y:RAIL},
  {x:RAIL, y:H-RAIL}, {x:W/2, y:H-RAIL+6}, {x:W-RAIL, y:H-RAIL},
];

const isStripe = n => n >= 9 && n <= 15; // source 111

// ---------- freshState (source 121-150) ----------
function freshState() {
  const balls = [];
  balls.push({ n:0, x:W*0.25, y:H/2, vx:0, vy:0, alive:true });
  const apexX = W*0.68, apexY = H/2, gap = R*2 + 0.5;
  const order = [1,9,2,10,8,3,11,4,12,5,13,6,14,7,15];
  let idx = 0;
  for (let col=0; col<5; col++) {
    for (let row=0; row<=col; row++) {
      const n = order[idx++];
      const x = apexX + col * (gap*0.87);
      const y = apexY + (row - col/2) * gap;
      balls.push({ n, x, y, vx:0, vy:0, alive:true });
    }
  }
  return {
    balls, turn: 0, phase: 'aim', broken: false, open: true,
    groups: [null, null], ballInHand: false, message: 'Break!',
    winner: null, shot: null,
  };
}

// G is module-global to mirror source (functions reference G directly)
let G = null;

function cueBall(){ return G.balls.find(b => b.n === 0); }

// canPlaceCue (source 297-303)
function canPlaceCue(x,y){
  if (x<RAIL+R || x>W-RAIL-R || y<RAIL+R || y>H-RAIL-R) return false;
  for (const b of G.balls){
    if (b.n!==0 && b.alive && Math.hypot(b.x-x,b.y-y) < R*2.1) return false;
  }
  return true;
}

// groupCleared (source 488-491)
function groupCleared(g){
  return !G.balls.some(b => b.alive && b.n!==0 && b.n!==8 &&
    ((isStripe(b.n)?'stripe':'solid')===g));
}

// hostHandleShot (source 320-334) - sendState stripped
function hostHandleShot(angle, power){
  if (G.phase !== 'aim') return;
  const cb = cueBall();
  if (!cb.alive) return;
  cb.vx = Math.cos(angle) * power;
  cb.vy = Math.sin(angle) * power;
  G.phase = 'sim';
  G.shot = { firstHit: null, potted: [], cueScratch: false, railAfterContact: false };
  G._guestAim = null;
}

// stepPhysics (source 337-403)
function stepPhysics(){
  let moving = false;
  for (let s=0; s<SUBSTEPS; s++){
    for (const b of G.balls){
      if (!b.alive) continue;
      b.x += b.vx / SUBSTEPS;
      b.y += b.vy / SUBSTEPS;
    }
    for (const b of G.balls){
      if (!b.alive) continue;
      let hit=false;
      if (b.x < RAIL+R){ b.x=RAIL+R; b.vx=-b.vx; hit=true; }
      if (b.x > W-RAIL-R){ b.x=W-RAIL-R; b.vx=-b.vx; hit=true; }
      if (b.y < RAIL+R){ b.y=RAIL+R; b.vy=-b.vy; hit=true; }
      if (b.y > H-RAIL-R){ b.y=H-RAIL-R; b.vy=-b.vy; hit=true; }
      if (hit && G.shot && G.shot.firstHit!=null) G.shot.railAfterContact = true;
    }
    for (let i=0;i<G.balls.length;i++){
      const a=G.balls[i]; if(!a.alive) continue;
      for (let j=i+1;j<G.balls.length;j++){
        const b=G.balls[j]; if(!b.alive) continue;
        let dx=b.x-a.x, dy=b.y-a.y, dist=Math.hypot(dx,dy);
        if (dist>0 && dist < 2*R){
          if (G.shot && G.shot.firstHit==null){
            if (a.n===0) G.shot.firstHit=b.n;
            else if (b.n===0) G.shot.firstHit=a.n;
          }
          const nx=dx/dist, ny=dy/dist;
          const overlap = 2*R - dist;
          a.x -= nx*overlap/2; a.y -= ny*overlap/2;
          b.x += nx*overlap/2; b.y += ny*overlap/2;
          const dvx=b.vx-a.vx, dvy=b.vy-a.vy;
          const rel = dvx*nx + dvy*ny;
          if (rel < 0){
            a.vx += rel*nx; a.vy += rel*ny;
            b.vx -= rel*nx; b.vy -= rel*ny;
          }
        }
      }
    }
    for (const b of G.balls){
      if (!b.alive) continue;
      for (const p of POCKETS){
        if (Math.hypot(b.x-p.x, b.y-p.y) < POCKET){
          b.alive=false; b.vx=b.vy=0;
          if (b.n===0) G.shot.cueScratch=true;
          else G.shot.potted.push(b.n);
          break;
        }
      }
    }
  }
  for (const b of G.balls){
    if (!b.alive) continue;
    b.vx*=FRICTION; b.vy*=FRICTION;
    if (Math.hypot(b.vx,b.vy) < STOP){ b.vx=0; b.vy=0; }
    else moving = true;
  }
  return moving;
}

// resolveShot (source 406-486) - sendState() calls stripped (no-op)
function sendState(){}
function resolveShot(){
  const s = G.shot;
  const me = G.turn, opp = 1-me;
  const eight = G.balls.find(b=>b.n===8);
  const eightPotted = s.potted.includes(8);
  const myGroup = G.groups[me];

  let foul = false, reason='';

  if (s.cueScratch) { foul = true; reason='Scratch'; }
  if (s.firstHit == null) { foul = true; reason='No ball hit'; }

  if (!foul && !G.open && myGroup){
    const fh = s.firstHit;
    if (fh === 8){
      if (!groupCleared(myGroup)) { foul=true; reason='Hit the 8 first'; }
    } else {
      const fhGroup = isStripe(fh) ? 'stripe' : 'solid';
      if (fhGroup !== myGroup) { foul=true; reason='Hit opponent\'s ball first'; }
    }
  }

  if (eightPotted){
    const cleared = myGroup ? groupCleared(myGroup) : false;
    if (G.open || !cleared || foul){
      G.phase='over'; G.winner = opp;
      G.message = (me===0?'P1':'P2') + ' potted the 8 early — ' + (opp===0?'P1':'P2') + ' wins!';
      sendState(); return;
    } else {
      G.phase='over'; G.winner = me;
      G.message = (me===0?'P1':'P2') + ' sinks the 8 — wins the game! 🏆';
      sendState(); return;
    }
  }

  let pottedOwn = false;
  if (G.open && !foul && s.potted.length){
    const firstObj = s.potted.find(n=>n!==8);
    if (firstObj!=null){
      const g = isStripe(firstObj) ? 'stripe' : 'solid';
      G.groups[me] = g;
      G.groups[opp] = (g==='solid') ? 'stripe' : 'solid';
      G.open = false;
      pottedOwn = true;
    }
  } else if (!G.open && !foul && myGroup){
    pottedOwn = s.potted.some(n => (isStripe(n)?'stripe':'solid')===myGroup);
  }

  if (!G.broken) G.broken = true;

  if (s.cueScratch){
    const cb = cueBall();
    cb.alive = true; cb.x = W*0.25; cb.y = H/2; cb.vx=cb.vy=0;
  }

  G.shot = null;
  if (foul){
    G.turn = opp;
    G.ballInHand = true;
    G.message = reason + '! ' + (opp===0?'P1':'P2') + ' — ball in hand';
  } else if (pottedOwn){
    G.turn = me;
    G.ballInHand = false;
    G.message = (me===0?'P1':'P2') + ': potted one — go again';
  } else {
    G.turn = opp;
    G.ballInHand = false;
    G.message = (opp===0?'P1':'P2') + '\'s turn';
  }
  G.phase = 'aim';
  sendState();
}

// ============ test harness ============
let pass=0, fail=0; const failures=[];
function ok(cond, name, detail=''){
  if (cond){ pass++; console.log('  PASS:', name); }
  else { fail++; failures.push(name+(detail?' :: '+detail:'')); console.log('  FAIL:', name, detail); }
}
function approx(a,b,eps=1e-6){ return Math.abs(a-b)<eps; }

// helper: run a complete shot to rest
function settle(maxFrames=20000){
  let f=0;
  while (stepPhysics() && f<maxFrames) f++;
  return f;
}

console.log('=== RACK SETUP ===');
{
  G = freshState();
  ok(G.balls.length===16, 'rack has 16 balls (cue + 15)', 'got '+G.balls.length);
  const nums = G.balls.map(b=>b.n).sort((a,b)=>a-b);
  const expected = Array.from({length:16},(_,i)=>i);
  ok(JSON.stringify(nums)===JSON.stringify(expected), 'numbers 0..15 all present', nums.join(','));
  const cb = G.balls.find(b=>b.n===0);
  ok(approx(cb.x,W*0.25)&&approx(cb.y,H/2), 'cue ball at head spot');
  const eight = G.balls.find(b=>b.n===8);
  // 8 is order index 4 => col=2,row=1 ; verify it is reasonably central in rack rows
  ok(approx(eight.y, H/2), '8-ball vertically centered (apex row middle)', 'y='+eight.y);
  // no two object balls overlap initially
  let overlap=false;
  for(let i=0;i<G.balls.length;i++)for(let j=i+1;j<G.balls.length;j++){
    const a=G.balls[i],b=G.balls[j];
    if(Math.hypot(a.x-b.x,a.y-b.y)<2*R-1e-9) overlap=true;
  }
  ok(!overlap, 'no overlapping balls at rack', 'rack gap='+(R*2+0.5));
}

console.log('=== isStripe / group mapping ===');
{
  ok([9,10,11,12,13,14,15].every(isStripe), 'stripes 9-15 detected');
  ok([1,2,3,4,5,6,7].every(n=>!isStripe(n)), 'solids 1-7 not stripe');
  ok(!isStripe(8), '8 not classified as stripe');
}

console.log('=== CUSHION BOUNCE ===');
{
  G = freshState();
  // remove all but cue, send cue straight right toward right rail
  G.balls = [{ n:0, x:W/2, y:H/2, vx:10, vy:0, alive:true }];
  G.shot = { firstHit:null, potted:[], cueScratch:false, railAfterContact:false };
  G.phase='sim';
  const cb = G.balls[0];
  // step until it bounces (vx becomes negative) or stops
  let bounced=false, frames=0;
  while(frames<5000){
    const wasPos = cb.vx>0;
    stepPhysics();
    if(wasPos && cb.vx<0){ bounced=true; break; }
    if(cb.vx===0 && cb.vy===0) break;
    frames++;
  }
  ok(bounced, 'cue ball reverses vx after hitting right cushion');
  ok(cb.x <= W-RAIL-R+1e-6, 'cue ball never penetrates right cushion', 'x='+cb.x);
}

console.log('=== BALL-BALL ELASTIC COLLISION (momentum conservation, equal mass) ===');
{
  // head-on: moving ball hits stationary ball -> full transfer (Newton's cradle)
  G = { balls:[
    { n:0, x:200, y:H/2, vx:8, vy:0, alive:true },
    { n:1, x:200+2*R-1, y:H/2, vx:0, vy:0, alive:true }, // slightly overlapping to force collision
  ], shot:{firstHit:null,potted:[],cueScratch:false,railAfterContact:false}, phase:'sim' };
  const a=G.balls[0], b=G.balls[1];
  const pBefore = a.vx + b.vx; // x-momentum (mass equal => proportional to vx sum)
  // single physics frame resolves the collision
  stepPhysics();
  const pAfter = (a.vx + b.vx)/FRICTION; // undo the friction damping applied at end of frame
  ok(approx(pBefore, pAfter, 1e-3), 'x-momentum conserved across collision', `before=${pBefore} after=${pAfter}`);
  // for head-on equal-mass, velocities should swap: a~0, b~8 (pre-friction)
  ok(a.vx/FRICTION < 0.5, 'striker nearly stops after head-on (velocity transfer)', 'a.vx='+a.vx);
  ok(b.vx/FRICTION > 7.0, 'target takes the velocity', 'b.vx='+b.vx);
  ok(G.shot.firstHit===1, 'firstHit records the contacted ball number');
}
{
  // kinetic energy should not increase (rel<0 guard prevents injecting energy)
  G = { balls:[
    { n:0, x:200, y:H/2, vx:6, vy:2, alive:true },
    { n:3, x:200+2*R-2, y:H/2+1, vx:-1, vy:0, alive:true },
  ], shot:{firstHit:null,potted:[],cueScratch:false,railAfterContact:false}, phase:'sim' };
  const ke=(arr)=>arr.reduce((s,b)=>s+b.vx*b.vx+b.vy*b.vy,0);
  const before=ke(G.balls);
  stepPhysics();
  const after=ke(G.balls)/(FRICTION*FRICTION);
  ok(after <= before+1e-6, 'kinetic energy not increased by collision', `before=${before} after=${after}`);
}

console.log('=== FOUL: no ball hit ===');
{
  G = freshState();
  // aim cue into empty space (downward into open felt, never touches a ball)
  G.balls = [{ n:0, x:W/2, y:H/2, vx:0, vy:0, alive:true }];
  hostHandleShot(Math.PI/2, 5); // straight down
  settle();
  G.open=true; G.groups=[null,null];
  resolveShot();
  ok(G.turn===1 && G.ballInHand===true, 'no-ball-hit => foul, opponent ball in hand', 'msg='+G.message);
  ok(/No ball hit/.test(G.message), 'reason is "No ball hit"');
}

console.log('=== FOUL: scratch (cue potted) ===');
{
  G = freshState();
  // Cue placed near top-left corner pocket, aimed straight at the pocket center so it
  // rolls in (verified trajectory). Cue alone: this also produces a no-ball-hit foul,
  // but Scratch is checked first in resolveShot so the message is "Scratch".
  G.balls = [
    { n:0, x:POCKETS[0].x+25, y:POCKETS[0].y+25, vx:0, vy:0, alive:true },
  ];
  hostHandleShot(Math.atan2(POCKETS[0].y-(POCKETS[0].y+25), POCKETS[0].x-(POCKETS[0].x+25)), 5);
  settle();
  ok(G.shot.cueScratch===true, 'cue scratch detected (cue entered pocket)', 'scratch='+G.shot.cueScratch);
  G.open=true; G.groups=[null,null];
  resolveShot();
  ok(G.turn===1 && G.ballInHand===true, 'scratch => opponent ball in hand');
  const cb=G.balls.find(b=>b.n===0);
  ok(cb.alive && approx(cb.x,W*0.25) && approx(cb.y,H/2), 'cue ball respotted at head after scratch');
  // NOTE: in this isolated case both Scratch and No-ball-hit set foul; resolveShot checks
  // scratch first (L416) then no-ball-hit (L417), so reason ends as "No ball hit".
  // The scratch respot + ball-in-hand still apply correctly (the behavior under test).
}

console.log('=== GROUP ASSIGNMENT on first legal pot ===');
{
  G = freshState();
  // P0 pots ball 1 (solid) legally on open table
  G.balls = [
    { n:0, x:200, y:H/2, vx:0, vy:0, alive:true },
    { n:1, x:POCKETS[3].x+20, y:POCKETS[3].y-20, vx:0, vy:0, alive:true },
  ];
  G.open=true; G.groups=[null,null];
  // line up cue to strike ball 1 toward bottom-left pocket
  // place cue just up-right of ball 1, aim at pocket direction through ball
  const ball=G.balls[1];
  G.balls[0].x = ball.x + 30; G.balls[0].y = ball.y - 30;
  const ang = Math.atan2(POCKETS[3].y-G.balls[0].y, POCKETS[3].x-G.balls[0].x);
  hostHandleShot(ang, 7);
  settle();
  ok(G.shot.potted.includes(1), 'ball 1 was potted', 'potted='+G.shot.potted);
  ok(!G.shot.cueScratch, 'no scratch on this pot', 'scratch='+G.shot.cueScratch);
  resolveShot();
  ok(G.groups[0]==='solid' && G.groups[1]==='stripe', 'P0 -> solid, P1 -> stripe', JSON.stringify(G.groups));
  ok(G.open===false, 'table no longer open');
  ok(G.turn===0 && !G.ballInHand, 'potted own => same player shoots again');
}

console.log('=== "pot your own = shoot again" vs pass turn ===');
{
  G = freshState();
  G.open=false; G.groups=['solid','stripe']; G.turn=0;
  // P0 (solid) pots solid ball 2 cleanly
  G.balls = [
    { n:0, x:300, y:H/2, vx:0, vy:0, alive:true },
    { n:2, x:POCKETS[5].x-20, y:POCKETS[5].y-20, vx:0, vy:0, alive:true }, // near bottom-right
  ];
  const ball=G.balls[1];
  G.balls[0].x=ball.x-30; G.balls[0].y=ball.y-30;
  const ang=Math.atan2(POCKETS[5].y-G.balls[0].y, POCKETS[5].x-G.balls[0].x);
  hostHandleShot(ang,7);
  settle();
  ok(G.shot.potted.includes(2),'solid 2 potted','potted='+G.shot.potted);
  resolveShot();
  ok(G.turn===0 && !G.ballInHand, 'P0 potted own solid => shoots again', 'turn='+G.turn);
}
{
  // pass turn when nothing potted (and a legal ball was hit first)
  G = freshState();
  G.open=false; G.groups=['solid','stripe']; G.turn=0;
  G.balls = [
    { n:0, x:300, y:H/2, vx:0, vy:0, alive:true },
    { n:2, x:340, y:H/2, vx:0, vy:0, alive:true }, // solid, just gets nudged, not potted
  ];
  hostHandleShot(0, 4); // hit solid 2, nothing pots
  settle();
  ok(G.shot.firstHit===2,'hit own solid first','fh='+G.shot.firstHit);
  ok(G.shot.potted.length===0,'nothing potted','potted='+G.shot.potted);
  resolveShot();
  ok(G.turn===1 && !G.ballInHand, 'no pot, legal hit => turn passes, no ball in hand', 'turn='+G.turn);
}

console.log('=== FOUL: wrong-ball-first (hit opponent group) ===');
{
  G = freshState();
  G.open=false; G.groups=['solid','stripe']; G.turn=0;
  G.balls = [
    { n:0, x:300, y:H/2, vx:0, vy:0, alive:true },
    { n:9, x:340, y:H/2, vx:0, vy:0, alive:true }, // stripe = opponent's
  ];
  hostHandleShot(0, 4);
  settle();
  ok(G.shot.firstHit===9, 'cue hit a stripe (9) first', 'fh='+G.shot.firstHit);
  resolveShot();
  ok(G.turn===1 && G.ballInHand, 'wrong-ball-first => foul, opp ball in hand');
  ok(/opponent/.test(G.message), 'reason mentions opponent ball', G.message);
}

console.log('=== FOUL: hitting 8 first illegally (group not cleared) ===');
{
  G = freshState();
  G.open=false; G.groups=['solid','stripe']; G.turn=0;
  // P0 still has a solid alive, so hitting 8 first is a foul
  G.balls = [
    { n:0, x:300, y:H/2, vx:0, vy:0, alive:true },
    { n:8, x:340, y:H/2, vx:0, vy:0, alive:true },
    { n:1, x:500, y:100, vx:0, vy:0, alive:true }, // solid still on table
  ];
  hostHandleShot(0, 4);
  settle();
  ok(G.shot.firstHit===8, 'cue hit 8 first', 'fh='+G.shot.firstHit);
  resolveShot();
  ok(G.turn===1 && G.ballInHand, 'hit-8-first-illegally => foul');
  ok(/Hit the 8 first/.test(G.message), 'reason is "Hit the 8 first"', G.message);
}

console.log('=== LEGAL: hitting 8 first when group cleared ===');
{
  G = freshState();
  G.open=false; G.groups=['solid','stripe']; G.turn=0;
  // P0 solids all gone -> hitting 8 first is legal
  G.balls = [
    { n:0, x:300, y:H/2, vx:0, vy:0, alive:true },
    { n:8, x:340, y:H/2, vx:0, vy:0, alive:true },
  ];
  ok(groupCleared('solid')===true, 'groupCleared(solid) true when no solids alive');
  hostHandleShot(0, 4);
  settle();
  resolveShot();
  ok(!G.ballInHand && G.turn===1, 'hit 8 first legally (group cleared) => no foul, turn passes (8 not potted)');
}

console.log('=== WIN: pot 8 last legally ===');
{
  G = freshState();
  G.open=false; G.groups=['solid','stripe']; G.turn=0;
  // all solids gone; pot the 8 cleanly into bottom-left
  G.balls = [
    { n:0, x:300, y:H/2, vx:0, vy:0, alive:true },
    { n:8, x:POCKETS[3].x+20, y:POCKETS[3].y-20, vx:0, vy:0, alive:true },
  ];
  const ball=G.balls[1];
  G.balls[0].x=ball.x+30; G.balls[0].y=ball.y-30;
  const ang=Math.atan2(POCKETS[3].y-G.balls[0].y, POCKETS[3].x-G.balls[0].x);
  hostHandleShot(ang,7);
  settle();
  ok(G.shot.potted.includes(8),'8 potted','potted='+G.shot.potted);
  ok(!G.shot.cueScratch,'no scratch on win shot');
  resolveShot();
  ok(G.phase==='over' && G.winner===0, 'pot 8 with group cleared, no foul => shooter (P0) wins', 'winner='+G.winner);
}

console.log('=== LOSE: pot 8 early (group not cleared) ===');
{
  G = freshState();
  G.open=false; G.groups=['solid','stripe']; G.turn=0;
  G.balls = [
    { n:0, x:300, y:H/2, vx:0, vy:0, alive:true },
    { n:8, x:POCKETS[3].x+20, y:POCKETS[3].y-20, vx:0, vy:0, alive:true },
    { n:1, x:500, y:120, vx:0, vy:0, alive:true }, // solid still alive
  ];
  const ball=G.balls[1];
  G.balls[0].x=ball.x+30; G.balls[0].y=ball.y-30;
  const ang=Math.atan2(POCKETS[3].y-G.balls[0].y, POCKETS[3].x-G.balls[0].x);
  hostHandleShot(ang,7);
  settle();
  ok(G.shot.potted.includes(8),'8 potted early','potted='+G.shot.potted);
  resolveShot();
  ok(G.phase==='over' && G.winner===1, 'pot 8 early => opponent (P1) wins', 'winner='+G.winner);
}

console.log('=== LOSE: pot 8 on open table ===');
{
  G = freshState();
  G.open=true; G.groups=[null,null]; G.turn=0;
  G.balls = [
    { n:0, x:300, y:H/2, vx:0, vy:0, alive:true },
    { n:8, x:POCKETS[3].x+20, y:POCKETS[3].y-20, vx:0, vy:0, alive:true },
  ];
  const ball=G.balls[1];
  G.balls[0].x=ball.x+30; G.balls[0].y=ball.y-30;
  const ang=Math.atan2(POCKETS[3].y-G.balls[0].y, POCKETS[3].x-G.balls[0].x);
  hostHandleShot(ang,7);
  settle();
  resolveShot();
  ok(G.phase==='over' && G.winner===1, 'pot 8 on open table => opponent wins');
}

console.log('=== LOSE: scratch while potting the 8 ===');
{
  // 8 potted AND cue scratch -> foul -> lose even if group cleared
  G = { balls:[
    { n:0, x:0, y:0, vx:0, vy:0, alive:true },
    { n:8, x:0, y:0, vx:0, vy:0, alive:true },
  ], turn:0, phase:'aim', broken:true, open:false, groups:['solid','stripe'],
     ballInHand:false, winner:null, shot:null };
  // simulate the shot result directly: both 8 potted and cue scratched
  G.shot = { firstHit:8, potted:[8], cueScratch:true, railAfterContact:true };
  // group cleared (only cue and 8 listed)
  ok(groupCleared('solid')===true,'precondition: solids cleared');
  resolveShot();
  ok(G.phase==='over' && G.winner===1, 'scratch on 8 (foul) => opponent wins even though group cleared', 'winner='+G.winner);
}

console.log('=== groupCleared correctness ===');
{
  G = { balls:[
    {n:0,alive:true},{n:8,alive:true},
    {n:1,alive:true},{n:9,alive:false},
  ]};
  ok(groupCleared('stripe')===true, 'stripe cleared (only dead stripe present)');
  ok(groupCleared('solid')===false, 'solid not cleared (solid 1 alive)');
  G.balls.push({n:2,alive:false});
  G.balls[2].alive=false; // kill solid 1
  ok(groupCleared('solid')===true, 'solid cleared after last solid dies');
  // cue and 8 must NOT count toward a group
  G = { balls:[{n:0,alive:true},{n:8,alive:true}] };
  ok(groupCleared('solid')===true && groupCleared('stripe')===true, 'cue & 8 excluded from group-clear check');
}

console.log('=== canPlaceCue (ball-in-hand legality) ===');
{
  G = freshState();
  G.balls = [
    { n:0, x:0,y:0, alive:false }, // cue currently off table
    { n:1, x:400, y:250, alive:true },
  ];
  ok(canPlaceCue(400,250)===false, 'cannot place on top of another ball');
  ok(canPlaceCue(400+R*2.1+1,250)===true, 'can place clear of other balls');
  ok(canPlaceCue(RAIL+R-1, 250)===false, 'cannot place inside cushion (left)');
  ok(canPlaceCue(W-RAIL-R+1, 250)===false, 'cannot place inside cushion (right)');
  ok(canPlaceCue(W/2, H/2)===true, 'can place in open center');
}

console.log('\n=========================================');
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail){ console.log('FAILURES:'); failures.forEach(f=>console.log('  - '+f)); }
console.log('=========================================');
process.exit(fail?1:0);
