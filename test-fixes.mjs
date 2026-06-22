/* Targeted tests for the rule fixes applied after the review:
   - Fix #6: potting your last group ball AND the 8 on the same shot = LOSE
   - Fix #5: breaking and potting BOTH a solid and a stripe leaves the table OPEN
   Replicates only the decision logic from resolveShot() faithfully. */

const isStripe = n => n >= 9 && n <= 15;

// --- replica of the relevant resolveShot decision logic (post-fix) ---
function decide({ balls, turn, open, groups, shot }) {
  const me = turn, opp = 1 - me;
  const s = shot;
  const eightPotted = s.potted.includes(8);
  const myGroup = groups[me];

  let foul = false, reason = '';
  if (s.cueScratch) { foul = true; reason = 'Scratch'; }
  if (s.firstHit == null) { foul = true; reason = 'No ball hit'; }
  if (!foul && !open && myGroup) {
    const fh = s.firstHit;
    if (fh === 8) {
      const cleared = !balls.some(b => b.alive && b.n!==0 && b.n!==8 && ((isStripe(b.n)?'stripe':'solid')===myGroup));
      if (!cleared) { foul = true; reason = 'Hit the 8 first'; }
    } else if ((isStripe(fh)?'stripe':'solid') !== myGroup) { foul = true; reason = "Hit opponent's ball first"; }
  }

  function groupClearedBeforeShot(g) {
    const aliveInGroup = balls.some(b => b.alive && b.n!==0 && b.n!==8 &&
      (isStripe(b.n)?'stripe':'solid')===g);
    const pottedThisShot = s.potted.some(n => n!==8 && (isStripe(n)?'stripe':'solid')===g);
    return !aliveInGroup && !pottedThisShot;
  }

  let result = { foul, reason };
  if (eightPotted) {
    const clearedBefore = myGroup ? groupClearedBeforeShot(myGroup) : false;
    result.over = true;
    result.winner = (open || !clearedBefore || foul) ? opp : me;
    return result;
  }

  let newOpen = open, newGroups = [...groups], pottedOwn = false;
  if (open && !foul && s.potted.length) {
    const objs = s.potted.filter(n => n !== 8);
    const sawSolid = objs.some(n => !isStripe(n));
    const sawStripe = objs.some(n => isStripe(n));
    if (objs.length && sawSolid !== sawStripe) {
      const g = sawStripe ? 'stripe' : 'solid';
      newGroups[me] = g; newGroups[opp] = g === 'solid' ? 'stripe' : 'solid';
      newOpen = false; pottedOwn = true;
    } else if (objs.length) { pottedOwn = true; } // both groups → stay open
  }
  result.over = false;
  result.open = newOpen; result.groups = newGroups; result.pottedOwn = pottedOwn;
  return result;
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS:', m); } else { fail++; console.log('  FAIL:', m); } };

// helper to build a ball set: list of {n, alive}
const mk = arr => arr.map(([n, alive]) => ({ n, alive, x:0, y:0 }));

console.log('=== Fix #6: pot last solid + 8 on SAME shot => LOSE ===');
{
  // solids = 1..7. Suppose 1..6 already gone, 7 is the last solid.
  // This shot pots BOTH 7 and 8 => 7 and 8 are now alive:false, both in s.potted.
  const balls = mk([[0,true],[7,false],[8,false],[9,true]]); // 7 sunk THIS shot (in s.potted)
  const r = decide({
    balls, turn:0, open:false, groups:['solid','stripe'],
    shot:{ firstHit:7, potted:[7,8], cueScratch:false }
  });
  ok(r.over === true, '8 potted ends game');
  ok(r.winner === 1, 'potting last group ball + 8 same shot => opponent (P1) wins');
}

console.log('=== Fix #6 control: 8 after group ALREADY cleared on a prior shot => WIN ===');
{
  // 7 already dead before this shot; this shot pots only the 8.
  const balls = mk([[0,true],[7,false],[8,true],[9,true]]);
  const r = decide({
    balls, turn:0, open:false, groups:['solid','stripe'],
    shot:{ firstHit:8, potted:[8], cueScratch:false }
  });
  ok(r.over === true && r.winner === 0, 'group cleared on earlier shot, legal 8 => shooter wins');
}

console.log('=== Fix #5: break pots a solid AND a stripe => table stays OPEN ===');
{
  const balls = mk([[0,true],[1,true],[9,true],[8,true]]);
  const r = decide({
    balls, turn:0, open:true, groups:[null,null],
    shot:{ firstHit:1, potted:[1,9], cueScratch:false }
  });
  ok(r.over === false, 'no win on break');
  ok(r.open === true, 'both groups potted on break => table remains open');
  ok(r.groups[0] === null && r.groups[1] === null, 'no group assigned yet');
  ok(r.pottedOwn === true, 'shooter still gets to continue');
}

console.log('=== Fix #5 control: break pots only stripes => assign stripes ===');
{
  const balls = mk([[0,true],[9,true],[10,true],[8,true]]);
  const r = decide({
    balls, turn:0, open:true, groups:[null,null],
    shot:{ firstHit:9, potted:[9,10], cueScratch:false }
  });
  ok(r.open === false, 'table closes when one group potted');
  ok(r.groups[0] === 'stripe' && r.groups[1] === 'solid', 'shooter=stripes, opp=solids');
  ok(r.pottedOwn === true, 'continuation granted');
}

console.log('\n=========================================');
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log('=========================================');
process.exit(fail ? 1 : 0);
