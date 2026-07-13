'use strict';

// Regression tests for the bell's time-boxed resume — the one line that keeps
// the #70 pile-up from coming back (fixed in #73, then extended with the ack
// protocol in #81, which is what made `userInitiated` an input at all).
//
// The bug: an `AudioContext.resume()` that is not allowed to start never settles
// (Web Audio §1.2.4 parks it), so continuing straight from it into a schedule
// leaves one resolver per bell. The moment a gesture finally arms the context,
// every parked resume settles at once, each schedules against the same frozen
// `currentTime`, and every unheard bell rings as a single blast.
//
// `shouldScheduleAfterResume` is the guard against that, and it is pure — it is
// handed the elapsed time rather than reading a clock — so the property can be
// asserted directly here, with no Web Audio, no browser, and no timers.

const test = require('node:test');
const assert = require('node:assert/strict');
const { RESUME_GRACE_MS, shouldScheduleAfterResume } = require('../media/webview-sound.js');

test('RESUME_GRACE_MS is 250ms', () => {
  // Load-bearing enough to pin: it is the window in which a resume that lands
  // still counts as "now" (CLAUDE.md's audio invariant).
  assert.equal(RESUME_GRACE_MS, 250);
});

test('a real bell whose resume landed in time is scheduled', () => {
  // The case the grace exists to save: an editor click armed the Window's sticky
  // activation without running the webview's own `unlockAudio`, so the context is
  // still suspended when this bell arrives — and its resume then lands in ms.
  assert.equal(shouldScheduleAfterResume(0, undefined), true);
  assert.equal(shouldScheduleAfterResume(RESUME_GRACE_MS - 1, undefined), true);
});

test('#70: a parked real bell is dropped once the grace has passed', () => {
  // THE pile-up regression. These are the bells that parked with no activation
  // and were settled — possibly minutes later, all together — by the user's first
  // gesture. Every one of them must drop itself. Widen this and they all ring at
  // once again.
  assert.equal(shouldScheduleAfterResume(RESUME_GRACE_MS, undefined), false);
  assert.equal(shouldScheduleAfterResume(RESUME_GRACE_MS + 1, undefined), false);
  assert.equal(shouldScheduleAfterResume(60_000, undefined), false);
  assert.equal(shouldScheduleAfterResume(Number.MAX_SAFE_INTEGER, undefined), false);
  // `false` is what the message carries when the host doesn't mark it; the bell
  // is still a real one and must be dropped just the same.
  assert.equal(shouldScheduleAfterResume(60_000, false), false);
});

test('#70: only the user-initiated replay is exempt from the grace', () => {
  // The `Play Sound` action's single bell. The user just asked for it, so it is
  // not a "now" signal about anything and may land late — but the exemption rides
  // on that one message's own flag, never on module state, which is exactly why
  // the bells parked before it (asserted above) stay dropped when the same
  // gesture settles them all.
  assert.equal(shouldScheduleAfterResume(60_000, true), true);
  assert.equal(shouldScheduleAfterResume(RESUME_GRACE_MS, true), true);
  assert.equal(shouldScheduleAfterResume(0, true), true);
});

test('the exemption is not a truthiness test', () => {
  // `userInitiated` arrives over postMessage, so only an explicit `true` lifts the
  // deadline; anything else is treated as a real bell (fail-safe: drop, don't
  // pile up).
  assert.equal(shouldScheduleAfterResume(60_000, 'no'), false);
  assert.equal(shouldScheduleAfterResume(60_000, 1), false);
  assert.equal(shouldScheduleAfterResume(60_000, {}), false);
});
