# 🎱 8-Ball Pool — Online (P2P)

A complete two-player online 8-ball pool game in a **single HTML file**. No backend
to host: the two browsers connect **peer-to-peer** over WebRTC (via PeerJS), so you
just share a room code in Discord and play.

## Play it

**Live:** https://psplapsap.github.io/pool-online/

1. One player clicks **Create room** → gets a 4-letter code.
2. Share the code in Discord.
3. The other player types the code and clicks **Join room**.
4. You're connected directly, browser-to-browser.

## Controls

- **Aim** with the mouse — a dashed line shows the shot.
- **Power & shoot:** click and **drag backward** from the cue ball, then release.
  Farther = harder.
- **Fouls** (scratch, hitting the wrong ball first) give the opponent **ball-in-hand** —
  click an empty spot to place the cue ball.
- **Win:** clear all your group (solids or stripes), then legally pot the **8**.
  Pot the 8 early or scratch on it = you lose.

## How it works

- **Host = authoritative simulator.** The room creator runs the 2-D physics
  (ball collisions, cushions, pockets, friction) and streams ball positions to the
  guest each frame. The guest sends input (shots, cue placement) back to the host.
  This keeps both screens perfectly in sync and is lag-tolerant.
- **Signaling** uses the free public PeerJS broker just to introduce the two
  browsers; no game data flows through any server. STUN servers are configured to
  help connect across home routers (NAT).

> ⚠️ Some restrictive networks (e.g. corporate) block the PeerJS broker, so the
> connection can't be set up there. Home/personal networks work fine.

## Rules implemented

Break, open table, solids/stripes assignment (incl. correct handling when the break
pots both groups), fouls → ball-in-hand, "pot your own → shoot again", and
win/lose-on-8 (including the rule that potting your last group ball and the 8 on the
*same* shot is a loss).

## Tests

```bash
node test-logic.mjs   # 55 assertions: rules + physics helpers
node test-fixes.mjs   # 10 assertions: edge-case rule fixes
```

## Dev

It's one static file. Serve it locally with any static server:

```bash
npx http-server -p 8080
# open http://localhost:8080/index.html in two tabs to test both sides
```

## Credits

Sound effects:
- Cue strike, ball collision, and pocket (`Strike.wav`, `BallsCollide.wav`,
  `Hole.wav`) from [henshmi/Classic-Pool-Game](https://github.com/henshmi/Classic-Pool-Game) (MIT License).
- Cushion/rail (`cushion-border.mp3`) from [pxlmvr/three-pool](https://github.com/pxlmvr/three-pool).
- Win/lose chimes are synthesized in-browser.
