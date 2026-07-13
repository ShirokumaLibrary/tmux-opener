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
