// Behavioral tests for the pure bell-notification logic. Node 24 strips the
// types from the required `.ts` module, so this plain-JS suite runs it under
// `node --test` with no build step and no `vscode` import (same pattern as
// test/session-name.test.js — Issue #18).
const { test } = require('node:test');
const assert = require('node:assert');

const {
  DEFAULT_COOLDOWN_MS,
  initialBellState,
  detectBellEdges,
  shouldNotifySession,
  parseBellingSessions,
  bellNotificationSurfaces,
  SOUND_OUTCOMES,
  soundOutcomeFor,
  shouldTrackSoundAck,
  shouldOfferSoundUnlock,
} = require('../src/bell-notify.ts');

// The bell *reason* half of notifyBell (#47/#64) lives in status-bridge; the
// #109 scenarios at the bottom of this file fold the two modules together the
// way notifyBell does, so both sets of imports belong up here.
const {
  isFresh,
  resolveBellReason,
  shouldSettleBell,
  selectPreset,
  selectToastMessageKey,
  BELL_SETTLE_MS,
  STATUS_FRESHNESS_MS,
  TOAST_DEFAULT,
  TOAST_ASK,
} = require('../src/status-bridge.ts');

test('DEFAULT_COOLDOWN_MS is 5000ms', () => {
  assert.strictEqual(DEFAULT_COOLDOWN_MS, 5000);
});

test('initialBellState has no seeded poll and no notification history', () => {
  assert.deepStrictEqual(initialBellState(), { active: null, lastNotifiedAt: {} });
});

test('first poll only seeds — a ringing session does not notify', () => {
  const { toNotify, nextState } = detectBellEdges(initialBellState(), ['foo'], 0);
  assert.deepStrictEqual(toNotify, []);
  assert.deepStrictEqual(nextState.active, ['foo']);
  assert.deepStrictEqual(nextState.lastNotifiedAt, {});
});

test('null/undefined prior state is treated as the initial seed', () => {
  assert.deepStrictEqual(detectBellEdges(null, ['foo'], 0).toNotify, []);
  assert.deepStrictEqual(detectBellEdges(undefined, ['foo'], 0).toNotify, []);
  assert.deepStrictEqual(detectBellEdges(null, ['foo'], 0).nextState.active, ['foo']);
});

test('a 0->1 transition notifies', () => {
  const seed = detectBellEdges(null, [], 0).nextState; // active: []
  const { toNotify, nextState } = detectBellEdges(seed, ['foo'], 100);
  assert.deepStrictEqual(toNotify, ['foo']);
  assert.deepStrictEqual(nextState.active, ['foo']);
  assert.strictEqual(nextState.lastNotifiedAt.foo, 100);
});

test('a sustained 1->1 flag does not re-notify', () => {
  const seed = detectBellEdges(null, [], 0).nextState;
  const first = detectBellEdges(seed, ['foo'], 100); // 0->1, notifies
  const second = detectBellEdges(first.nextState, ['foo'], 200); // 1->1
  assert.deepStrictEqual(second.toNotify, []);
  assert.deepStrictEqual(second.nextState.active, ['foo']);
});

test('a 1->0->1 cycle re-notifies once the cooldown has elapsed', () => {
  const seed = detectBellEdges(null, [], 0).nextState;
  const on = detectBellEdges(seed, ['foo'], 100); // 0->1 notifies at 100
  const off = detectBellEdges(on.nextState, [], 200); // 1->0, no notify
  assert.deepStrictEqual(off.toNotify, []);
  // Ring again well past the cooldown -> notifies again.
  const again = detectBellEdges(off.nextState, ['foo'], 100 + DEFAULT_COOLDOWN_MS + 1);
  assert.deepStrictEqual(again.toNotify, ['foo']);
});

test('a 0->1 edge inside the cooldown window is suppressed, and fires after it elapses', () => {
  const seed = detectBellEdges(null, [], 0).nextState;
  const on = detectBellEdges(seed, ['foo'], 100); // notifies at 100
  assert.deepStrictEqual(on.toNotify, ['foo']);
  // Drop then ring again while still inside the cooldown -> suppressed.
  const off = detectBellEdges(on.nextState, [], 200);
  const tooSoon = detectBellEdges(off.nextState, ['foo'], 100 + DEFAULT_COOLDOWN_MS - 1);
  assert.deepStrictEqual(tooSoon.toNotify, []);
  // lastNotifiedAt is unchanged by a suppressed edge.
  assert.strictEqual(tooSoon.nextState.lastNotifiedAt.foo, 100);
  // Exactly at the cooldown boundary it fires again.
  const off2 = detectBellEdges(tooSoon.nextState, [], 100 + DEFAULT_COOLDOWN_MS - 1);
  const atBoundary = detectBellEdges(off2.nextState, ['foo'], 100 + DEFAULT_COOLDOWN_MS);
  assert.deepStrictEqual(atBoundary.toNotify, ['foo']);
  assert.strictEqual(atBoundary.nextState.lastNotifiedAt.foo, 100 + DEFAULT_COOLDOWN_MS);
});

test('an explicit cooldownMs argument overrides the default', () => {
  const seed = detectBellEdges(null, [], 0).nextState;
  const on = detectBellEdges(seed, ['foo'], 100, 1000);
  const off = detectBellEdges(on.nextState, [], 200, 1000);
  // 999ms after the notification -> still suppressed at cooldown 1000.
  const tooSoon = detectBellEdges(off.nextState, ['foo'], 100 + 999, 1000);
  assert.deepStrictEqual(tooSoon.toNotify, []);
  const off2 = detectBellEdges(tooSoon.nextState, [], 100 + 999, 1000);
  const ok = detectBellEdges(off2.nextState, ['foo'], 100 + 1000, 1000);
  assert.deepStrictEqual(ok.toNotify, ['foo']);
});

test('sessions are tracked independently — one ringing does not seed the other', () => {
  const seed = detectBellEdges(null, [], 0).nextState;
  const a = detectBellEdges(seed, ['foo'], 100); // foo 0->1
  assert.deepStrictEqual(a.toNotify, ['foo']);
  // Next cycle: foo still rings (1->1, silent), bar newly rings (0->1, notifies).
  const b = detectBellEdges(a.nextState, ['foo', 'bar'], 200);
  assert.deepStrictEqual(b.toNotify, ['bar']);
  assert.deepStrictEqual(new Set(b.nextState.active), new Set(['foo', 'bar']));
  assert.strictEqual(b.nextState.lastNotifiedAt.foo, 100);
  assert.strictEqual(b.nextState.lastNotifiedAt.bar, 200);
});

test('duplicate session names in a poll are collapsed and notify once', () => {
  const seed = detectBellEdges(null, [], 0).nextState;
  const { toNotify, nextState } = detectBellEdges(seed, ['foo', 'foo'], 100);
  assert.deepStrictEqual(toNotify, ['foo']);
  assert.deepStrictEqual(nextState.active, ['foo']);
});

test('shouldNotifySession notifies the first time and records the time', () => {
  const { notify, nextState } = shouldNotifySession(initialBellState(), 'foo', 100);
  assert.strictEqual(notify, true);
  assert.strictEqual(nextState.lastNotifiedAt.foo, 100);
});

test('shouldNotifySession suppresses a repeat inside the cooldown, allows it after', () => {
  const first = shouldNotifySession(initialBellState(), 'foo', 100);
  const soon = shouldNotifySession(first.nextState, 'foo', 100 + DEFAULT_COOLDOWN_MS - 1);
  assert.strictEqual(soon.notify, false);
  assert.strictEqual(soon.nextState.lastNotifiedAt.foo, 100); // unchanged
  const later = shouldNotifySession(soon.nextState, 'foo', 100 + DEFAULT_COOLDOWN_MS);
  assert.strictEqual(later.notify, true);
  assert.strictEqual(later.nextState.lastNotifiedAt.foo, 100 + DEFAULT_COOLDOWN_MS);
});

// @testdoc bellNotificationSurfaces reports whether a cooldown-cleared bell
// will actually surface, so notifyBell can gate the shared cooldown commit on
// it. The regression: with notifyOnBell on but both notifyToast and notifySound
// off, the cooldown must NOT advance — otherwise a silent bell throttles a
// later, audible one behind a notification that never happened.
test('bellNotificationSurfaces is true when either channel is on', () => {
  assert.strictEqual(bellNotificationSurfaces(true, true), true);
  assert.strictEqual(bellNotificationSurfaces(true, false), true); // sound only
  assert.strictEqual(bellNotificationSurfaces(false, true), true); // toast only
});

test('bellNotificationSurfaces is false only when both channels are off', () => {
  // The reachable settings combo the reviewer flagged: notifyOnBell on, but the
  // user muted both the sound and the toast. Nothing surfaces -> the cooldown
  // gate must return false so notifyBell leaves bellState untouched.
  assert.strictEqual(bellNotificationSurfaces(false, false), false);
});

test('a silenced bell (both channels off) must not advance the cooldown', () => {
  // Mirrors notifyBell's guard: shouldNotifySession would clear the cooldown and
  // hand back a committed nextState, but with nothing to surface we discard it
  // and keep the prior state, so a later audible bell still fires on time.
  const before = initialBellState();
  const { notify, nextState } = shouldNotifySession(before, 'foo', 100);
  assert.strictEqual(notify, true); // the cooldown gate itself would pass...
  const committed = bellNotificationSurfaces(false, false) ? nextState : before;
  assert.deepStrictEqual(committed, before); // ...but nothing surfaced, so no advance.
  assert.strictEqual(committed.lastNotifiedAt.foo, undefined);
});

// @testdoc shouldOfferSoundUnlock decides whether a bell's toast carries the
// `Play Sound` action (#81, design #78 D10). The webview reports one conclusive
// outcome per bell it was asked to play; only `blocked` (a resume that parked
// and never landed) is fixable by a click, and only then when all three
// surfaces exist. Every other outcome — including `unknown`, the silence of a
// webview that never answered — must leave the toast alone: silence is
// "undetermined", never "blocked" (fail-safe).
//
// The sweep below iterates `SOUND_OUTCOMES` *imported from the module*, not a
// copy kept here: `SoundOutcome` is derived from that array (`typeof
// SOUND_OUTCOMES[number]`), so a new outcome cannot enter the type without
// entering this sweep. A hand-kept copy would leave the claim of exhaustiveness
// resting on nothing — types are gone at runtime, and the new value would simply
// go untested.
const FLAG_COMBOS = [
  [false, false, false],
  [false, false, true],
  [false, true, false],
  [false, true, true],
  [true, false, false],
  [true, false, true],
  [true, true, false],
  [true, true, true],
];

test('shouldOfferSoundUnlock offers the action only for blocked with all three surfaces on', () => {
  for (const outcome of SOUND_OUTCOMES) {
    for (const [notifySound, notifyToast, hasView] of FLAG_COMBOS) {
      const expected = outcome === 'blocked' && notifySound && notifyToast && hasView;
      assert.strictEqual(
        shouldOfferSoundUnlock(notifySound, notifyToast, hasView, outcome),
        expected,
        `outcome=${outcome} sound=${notifySound} toast=${notifyToast} view=${hasView}`,
      );
    }
  }
});

test('shouldOfferSoundUnlock never offers the action on silence (unknown)', () => {
  // The fail-safe: a webview that says nothing (dead, unreachable, or just slow
  // past SOUND_ACK_TIMEOUT_MS) is undetermined, not blocked. Offering the button
  // here is how the case that most needs this feature — Remote-SSH, high RTT —
  // would instead get a lying button on bells that did ring.
  assert.strictEqual(shouldOfferSoundUnlock(true, true, true, 'unknown'), false);
});

test('shouldOfferSoundUnlock never offers the action when a gesture cannot fix it', () => {
  // `unavailable` (no Web Audio at all) and `resume-rejected` (a closed or
  // interrupted context) do not become playable by clicking, so a button would
  // be a permanent loop: offer -> click -> reject -> offer again.
  assert.strictEqual(shouldOfferSoundUnlock(true, true, true, 'unavailable'), false);
  assert.strictEqual(shouldOfferSoundUnlock(true, true, true, 'resume-rejected'), false);
  assert.strictEqual(shouldOfferSoundUnlock(true, true, true, 'played'), false);
});

test('shouldOfferSoundUnlock requires all three surfaces even when blocked', () => {
  // D6: sound off -> nothing to unblock; toast off -> nothing to hang the action
  // on; no view -> nobody to re-post the playSound to.
  assert.strictEqual(shouldOfferSoundUnlock(true, true, true, 'blocked'), true);
  assert.strictEqual(shouldOfferSoundUnlock(false, true, true, 'blocked'), false);
  assert.strictEqual(shouldOfferSoundUnlock(true, false, true, 'blocked'), false);
  assert.strictEqual(shouldOfferSoundUnlock(true, true, false, 'blocked'), false);
});

test('the tracking gate and the action gate cannot drift apart', () => {
  // The three-surface rule is decided twice per bell: once to choose whether the
  // host waits for a verdict at all (shouldTrackSoundAck), and once to choose
  // whether that verdict earns a button (shouldOfferSoundUnlock). Written as two
  // separate conjunctions they could disagree — and the failure is silent: an
  // untracked bell always resolves to `unknown`, so the action would simply never
  // appear again. Here the second is defined on the first; this pins that.
  for (const [notifySound, notifyToast, hasView] of FLAG_COMBOS) {
    const tracked = shouldTrackSoundAck(notifySound, notifyToast, hasView);
    assert.strictEqual(tracked, notifySound && notifyToast && hasView);
    for (const outcome of SOUND_OUTCOMES) {
      assert.strictEqual(
        shouldOfferSoundUnlock(notifySound, notifyToast, hasView, outcome),
        tracked && outcome === 'blocked',
        `outcome=${outcome} sound=${notifySound} toast=${notifyToast} view=${hasView}`,
      );
    }
  }
});

// --- soundOutcomeFor: the wire -> verdict fold (#81) ------------------------
// `handleSoundResult` used to inline this mapping, which put the only fail-safe
// in the protocol (an unrecognized reason must not become `blocked`) somewhere
// no test could reach.

test('soundOutcomeFor maps every conclusive message the webview can send', () => {
  assert.strictEqual(soundOutcomeFor(true), 'played'); // Rang: synchronously, or a resume in time.
  assert.strictEqual(soundOutcomeFor(false, 'grace-exceeded'), 'blocked'); // Landed too late to be news.
  assert.strictEqual(soundOutcomeFor(false, 'resume-rejected'), 'resume-rejected'); // closed/interrupted.
  assert.strictEqual(soundOutcomeFor(false, 'unavailable'), 'unavailable'); // No Web Audio at all.
});

test('soundOutcomeFor: played wins regardless of any reason riding along', () => {
  // The webview only says `played: true` after scheduling the sound, so the bell
  // rang. Nothing in a `reason` field may talk us out of that — least of all into
  // `blocked`, which would put a button on a bell the user just heard.
  assert.strictEqual(soundOutcomeFor(true, 'grace-exceeded'), 'played');
  assert.strictEqual(soundOutcomeFor(true, 'whatever'), 'played');
});

test('soundOutcomeFor folds an unrecognized reason to unknown, never to blocked', () => {
  // The fail-safe. `unknown` offers no action — the same verdict silence gets —
  // whereas guessing `blocked` would hang a `Play Sound` button on a bell that may
  // well have rung, and VS Code cannot take an action off a toast already shown.
  assert.strictEqual(soundOutcomeFor(false, 'a-reason-from-a-later-webview'), 'unknown');
  assert.strictEqual(soundOutcomeFor(false, ''), 'unknown');
  assert.strictEqual(soundOutcomeFor(false, undefined), 'unknown');
  // `resume-pending` is the protocol's one *intermediate* message: the host acts
  // on it (swapping deadlines) before the fold ever sees it. If a refactor ever
  // routes it here anyway, it must land in the fail-safe rather than be read as a
  // conclusion.
  assert.strictEqual(soundOutcomeFor(false, 'resume-pending'), 'unknown');
});

test('soundOutcomeFor only ever returns a declared outcome', () => {
  const reasons = [
    undefined,
    '',
    'grace-exceeded',
    'resume-rejected',
    'unavailable',
    'resume-pending',
    'not-a-reason',
  ];
  for (const played of [true, false]) {
    for (const reason of reasons) {
      assert.ok(
        SOUND_OUTCOMES.includes(soundOutcomeFor(played, reason)),
        `played=${played} reason=${reason} produced an outcome outside SOUND_OUTCOMES`,
      );
    }
  }
});

test('parseBellingSessions returns sessions whose window bell flag is set', () => {
  // One `list-windows -a -F '#{session_name}\t#{window_bell_flag}'` line per
  // window; a session appears once per window it owns.
  const output = 'foo\t1\nbar\t0\nbaz\t1\n';
  assert.deepStrictEqual(parseBellingSessions(output), ['foo', 'baz']);
});

test('parseBellingSessions collapses a session with several windows to one entry', () => {
  // A session ringing in more than one window must still notify once.
  const output = 'foo\t0\nfoo\t1\nfoo\t1\n';
  assert.deepStrictEqual(parseBellingSessions(output), ['foo']);
});

test('parseBellingSessions ignores blank lines and a session ringing in no window', () => {
  const output = '\nfoo\t0\n\nbar\t0\n';
  assert.deepStrictEqual(parseBellingSessions(output), []);
});

test('parseBellingSessions tolerates empty output', () => {
  assert.deepStrictEqual(parseBellingSessions(''), []);
});

test('parseBellingSessions treats only "1" as set (not other truthy strings)', () => {
  // window_bell_flag is 0/1; guard against a stray value being read as a bell.
  const output = 'foo\t2\nbar\t1\n';
  assert.deepStrictEqual(parseBellingSessions(output), ['bar']);
});

test('front (onBell) and background poller share one cooldown per session', () => {
  // A front-of-house onBell notification suppresses a background edge that
  // arrives within the cooldown for the same session, because they read and
  // write the same lastNotifiedAt map.
  const front = shouldNotifySession(initialBellState(), 'foo', 100);
  assert.strictEqual(front.notify, true);
  const seeded = { active: [], lastNotifiedAt: front.nextState.lastNotifiedAt };
  const bg = detectBellEdges(seeded, ['foo'], 100 + DEFAULT_COOLDOWN_MS - 1);
  assert.deepStrictEqual(bg.toNotify, []);
});

// --- #109: a second BEL source beside the bell-reason hooks ------------------
// These pin what happens when the reference bell hooks (`tmux-opener-bell.sh`,
// the "bell-reason sound" setup) run while Claude Code's own
// `preferredNotifChannel` is still `"terminal_bell"` — i.e. TWO sources emit a
// BEL for the same event: the hook (which writes its reason file *before*
// ringing) and Claude Code's built-in bell (which writes no reason file at all).
//
// They are characterization tests: they add no behavior, they establish — from
// the code rather than from a guess — what that combination does, which is what
// the README documents. The decisions live in two modules, so a scenario has to
// fold them together exactly as `notifyBell` (extension.ts) does, and that is
// THREE stages, not two:
//   1. `shouldNotifySession` gates on the shared 5s per-session cooldown, so the
//      first BEL inside the window is the only one ever judged (VS Code cannot
//      amend a toast it has already shown);
//   2. the reason files are read, and `shouldSettleBell` asks whether EITHER file
//      *exists* (fresh or stale — the #113 gate; the hooks only overwrite, never
//      delete, so an existing file means "this session is hook-wired");
//   3. and only if a reason file exists — the stage the first cut of these tests
//      dropped — does it wait BELL_SETTLE_MS (250ms), RE-READ both files, resolve
//      the reason, and take `anyFresh` (the toast-wording gate) from that re-read.
// Stage 3 is what decides whether the built-in bell winning the race actually
// costs anything: a hook file that lost by milliseconds still lands inside the
// settle and is picked up — and post-#113 that holds even for a session idle past
// the 30s window, because the gate is existence, not freshness. `foldNotifyBell`
// below models all three, so these tests cannot claim an outcome the real pipeline
// does not produce.
//
// What these tests do NOT establish: which of the two BELs actually arrives
// first. Nothing in this repository orders them, and it was not measured.

/**
 * Replay `notifyBell`'s three stages over a fake disk. `writes` gives the ms at
 * which each reason file is written (absent = never); a file is visible to a
 * read at `t` only once it has been written, which is what lets a scenario put
 * the hook's write *after* the built-in bell it lost the race to.
 * Returns what the two user-visible choices are made from: `anyFresh` (the toast
 * wording key, taken post-settle, as in extension.ts) and `reason` (the sound
 * preset, also post-settle).
 *
 * `preSettle` is the raw first read (the mtimes as of `bellAt`). It is NOT a
 * fourth stage — extension.ts never resolves a reason from it — but it is what a
 * test needs to show that a given outcome does *not* ride on the settle: resolve
 * it, and if it already agrees with `reason`, the 250ms wait changed nothing.
 */
function foldNotifyBell({ state, session, bellAt, writes, askType }) {
  const { notify, nextState } = shouldNotifySession(state, session, bellAt);
  if (!notify) {
    return { notified: false, nextState };
  }
  const readAt = (t) => ({
    stopMtime: writes.stop !== undefined && writes.stop <= t ? writes.stop : undefined,
    askMtime: writes.ask !== undefined && writes.ask <= t ? writes.ask : undefined,
    // The ask reason file carries its notification_type (#116); it is visible only
    // once that file has been written, exactly like the mtime above.
    askType: writes.ask !== undefined && writes.ask <= t ? askType : undefined,
  });
  const initial = readAt(bellAt);
  if (!shouldSettleBell(initial)) {
    // No reason file has ever existed (hook-less, or the first bell): no settle,
    // no re-read; `anyFresh` is false and `reason` stays at its 'stop' initializer.
    return {
      notified: true,
      nextState,
      anyFresh: false,
      settled: false,
      reason: 'stop',
      preSettle: initial,
    };
  }
  const after = bellAt + BELL_SETTLE_MS;
  const settled = readAt(after);
  // `anyFresh` — the toast-wording gate — is taken *post-settle* (as in
  // extension.ts), so a reason that lands during the 250ms settle corrects the
  // wording as well as the preset; a hook-wired but genuinely idle bell whose
  // files stay stale through the settle keeps `anyFresh` false and the neutral
  // default toast.
  const anyFresh =
    (settled.stopMtime !== undefined && isFresh(settled.stopMtime, after)) ||
    (settled.askMtime !== undefined && isFresh(settled.askMtime, after));
  return {
    notified: true,
    nextState,
    anyFresh,
    settled: true,
    reason: resolveBellReason({ ...settled, now: after }),
    preSettle: initial,
  };
}

test('#113: the shared cooldown still drops the hook follow-up BEL — now harmlessly', () => {
  // The mechanism that made #113 a *permanent* mis-verdict, pinned so it stays
  // understood: the hook's own BEL (ask file now on disk) arrives 40ms after the
  // built-in bell and is dropped by the shared 5s cooldown before its reason is
  // ever read — VS Code cannot amend a toast it has already shown. Under the old
  // freshness gate this was fatal (the first, reason-less bell had resolved
  // `stop`). Post-#113 it is harmless: the first bell already settled and resolved
  // `ask` (see the cold-rescue test above), so there is nothing left to correct.
  const idleAt = 100_000;
  const bellAt = idleAt + STATUS_FRESHNESS_MS + 1_000; // stop file is >30s stale
  const first = foldNotifyBell({
    state: initialBellState(),
    session: 'foo',
    bellAt,
    writes: { stop: idleAt, ask: bellAt + 40 },
  });
  assert.strictEqual(first.reason, 'ask'); // already correct — no correction needed

  const hookBell = foldNotifyBell({
    state: first.nextState,
    session: 'foo',
    bellAt: bellAt + 40,
    writes: { stop: idleAt, ask: bellAt + 40 },
  });
  assert.strictEqual(hookBell.notified, false); // dropped by the cooldown, as before
});

test('#113 (cold rescue): a hook-wired session idle past 30s now settles and picks up the late ask', () => {
  // The #113 fix, and the exact scenario the old `#109 (cold)` test pinned as
  // unsalvageable. The session has been idle past the 30s freshness window (a long
  // tool call, then a permission prompt), so its `bell-<s>.stop.json` is stale —
  // but it EXISTS, which is the signal `shouldSettleBell` now gates on. The
  // built-in bell wins the race by 40ms; because a reason file exists, the
  // extension settles 250ms, re-reads, finds the hook's ask file (40ms < 250ms),
  // and resolves `ask`. Under the old freshness gate this was `stop` + neutral
  // toast, dropped forever behind the committed cooldown.
  const idleAt = 100_000;
  const bellAt = idleAt + STATUS_FRESHNESS_MS + 1_000; // stop file is >30s stale
  const rescued = foldNotifyBell({
    state: initialBellState(),
    session: 'foo',
    bellAt,
    writes: { stop: idleAt, ask: bellAt + 40 }, // the hook's ask lands 40ms late
  });

  assert.strictEqual(rescued.notified, true);
  assert.strictEqual(rescued.settled, true); // gated on existence, not freshness
  assert.strictEqual(rescued.reason, 'ask'); // the late ask was picked up by the re-read
  assert.strictEqual(rescued.anyFresh, true); // post-settle: the ask file is now fresh
  assert.strictEqual(selectPreset(rescued.reason, 'classic', 'siren'), 'siren'); // the ask preset
  assert.strictEqual(selectToastMessageKey(rescued.anyFresh, rescued.reason), TOAST_ASK);

  // And it does NOT ride on the pre-settle snapshot — the whole point is the
  // 250ms wait: at `bellAt` only the stale stop file is visible, so a resolve then
  // would have said `stop`. This is what distinguishes the fix from a tautology.
  assert.strictEqual(resolveBellReason({ ...rescued.preSettle, now: bellAt }), 'stop');
});

test('#113 (truly hook-less): a session that never had a reason file stays zero-latency', () => {
  // The invariant #113 must NOT regress. A user without the bell-reason hooks has
  // no reason file at all, so `shouldSettleBell` is false: no settle, no added
  // latency, plain preset, neutral toast — exactly the pre-#47 behavior. The
  // first bell of any session (before any hook has written) is the same shape.
  const bellAt = 100_000;
  const hookless = foldNotifyBell({
    state: initialBellState(),
    session: 'foo',
    bellAt,
    writes: {}, // neither file ever written
  });

  assert.strictEqual(hookless.notified, true);
  assert.strictEqual(hookless.settled, false); // no reason file -> no settle
  assert.strictEqual(hookless.anyFresh, false);
  assert.strictEqual(hookless.reason, 'stop');
  assert.strictEqual(selectPreset(hookless.reason, 'classic', 'siren'), 'classic');
  assert.strictEqual(selectToastMessageKey(hookless.anyFresh, hookless.reason), TOAST_DEFAULT);
});

test('#116: a genuine approval prompt co-firing within 3s of completion resolves ask, not stop', () => {
  // The bug this Issue fixes. A turn finishes, then a real permission prompt lands
  // 2.5s later — inside BELL_COFIRE_MS. The mtime-only tie-break (rule ③) read the
  // proximity as a co-firing completion and returned `stop`: completion sound +
  // "has finished" toast, while Claude was actually waiting for input. The ask
  // reason file now carries notification_type=permission_prompt, so the reason
  // resolves `ask` regardless of the mtime proximity.
  const bellAt = 100_000;
  const cofire = foldNotifyBell({
    state: initialBellState(),
    session: 'foo',
    bellAt,
    writes: {
      stop: bellAt - 2_500, // completion 2.5s ago (inside the 3s co-fire window)
      ask: bellAt, // the genuine approval prompt now
    },
    askType: 'permission_prompt',
  });

  assert.strictEqual(cofire.reason, 'ask');
  assert.strictEqual(cofire.anyFresh, true);
  assert.strictEqual(selectPreset(cofire.reason, 'classic', 'siren'), 'siren');
  assert.strictEqual(selectToastMessageKey(cofire.anyFresh, cofire.reason), TOAST_ASK);

  // Without the type, the identical mtimes fall to the tie-break and misfire as
  // `stop` — which is exactly the bug, and what proves the type is doing the work.
  const untyped = foldNotifyBell({
    state: initialBellState(),
    session: 'foo',
    bellAt,
    writes: { stop: bellAt - 2_500, ask: bellAt },
  });
  assert.strictEqual(untyped.reason, 'stop');
});

test('#109 (warm): the 250ms settle rescues the same race when a reason file is fresh', () => {
  // The counterpart, and the reason the cold case above has to be stated as the
  // *cold* case. Here the previous turn finished 29s ago, so `bell-<s>.stop.json`
  // is still fresh when the built-in bell wins the race by 40ms. That makes
  // `anyFresh` true — so the extension settles 250ms, re-reads, finds the hook's
  // ask file (40ms < 250ms), and plays the ask sound after all. The two-source
  // setup does not lose the ask here; only the cold path does.
  const bellAt = 100_000;
  const warm = foldNotifyBell({
    state: initialBellState(),
    session: 'foo',
    bellAt,
    writes: {
      stop: bellAt - (STATUS_FRESHNESS_MS - 1_000), // last turn finished 29s ago
      ask: bellAt + 40, // the hook, milliseconds behind the built-in bell
    },
  });

  assert.strictEqual(warm.anyFresh, true);
  assert.strictEqual(warm.settled, true);
  assert.strictEqual(warm.reason, 'ask'); // the late file was picked up by the re-read
  assert.strictEqual(selectPreset(warm.reason, 'classic', 'siren'), 'siren');
  assert.strictEqual(selectToastMessageKey(warm.anyFresh, warm.reason), TOAST_ASK);
});

test('#109 (prescribed): with the hooks as the only BEL source, no verdict rides on the race', () => {
  // The configuration the README prescribes (a non-bell `preferredNotifChannel`).
  // The only BEL is the hook's, and the hook writes its reason file *before* it
  // rings — so the ask file is already on disk when the bell is judged. Nothing
  // rides on the settle landing in time, and nothing rides on which source wins.
  const bellAt = 100_000;
  const prescribed = foldNotifyBell({
    state: initialBellState(),
    session: 'foo',
    bellAt,
    writes: {
      stop: bellAt - (STATUS_FRESHNESS_MS - 1_000), // an old completion, still "fresh"
      ask: bellAt - 1, // written before the hook rang
    },
  });

  assert.strictEqual(prescribed.reason, 'ask'); // beyond the 3s co-fire window -> newer wins
  assert.strictEqual(selectPreset(prescribed.reason, 'classic', 'siren'), 'siren');
  assert.strictEqual(
    selectToastMessageKey(prescribed.anyFresh, prescribed.reason),
    TOAST_ASK,
  );

  // And that is the claim in this test's name, so assert it rather than imply it.
  // The settle DOES still run here (a fresh stop file makes `anyFresh` true), so
  // "no race" cannot mean "no settle" — it means the settle is not load-bearing:
  // the pre-settle snapshot, what the extension would have resolved had it never
  // waited, already says `ask`. Without this line the test only walks the same
  // post-settle path as the warm case above and proves nothing the warm case
  // didn't.
  assert.strictEqual(prescribed.settled, true);
  assert.strictEqual(
    resolveBellReason({ ...prescribed.preSettle, now: bellAt }),
    'ask',
  );
});
