// Pure decision logic for the bell's time-boxed resume, split out of
// webview-terminal.js so it can be unit-tested with `node --test` without a
// browser, Web Audio, or a pty — the same treatment webview-keymap.js gets, and
// for the same reason: the one line below is what keeps the #70 pile-up from
// coming back, and an untested invariant is one a later refactor deletes.
//
// This file is loaded into the webview as a plain <script> (NOT an ES module,
// NOT bundled by esbuild — see CLAUDE.md), so it must not put bare `export` /
// `require` / `import` at top level. The UMD guard below attaches
// `window.TmuxSound` in the webview and sets `module.exports` under Node; the
// `module` reference lives only inside a `typeof` check, which is safe in a
// browser where `module` is undefined.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.TmuxSound = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // How long a bell may wait on a resume before it stops being news.
  const RESUME_GRACE_MS = 250;

  /**
   * Whether a bell whose `AudioContext.resume()` has just settled may still be
   * scheduled. `elapsedMs` is the monotonic time (`performance.now()`) the
   * resume took to land; `userInitiated` marks the single replay behind the
   * toast's `Play Sound` action.
   *
   * This is the #70 invariant in one line, so read it as such:
   *
   * - A real bell is a "now" signal. A resume that parked because the context
   *   was never allowed to start does not fail — it hangs (Web Audio §1.2.4) —
   *   and when a gesture finally arms the context, *every* parked resume settles
   *   at once. Scheduling them all then replays every unheard bell as a single
   *   blast (suspension freezes `currentTime` rather than advancing it, so each
   *   `t0` is still ahead of the clock). Measuring each bell's own wait against
   *   the grace is what makes those bells drop themselves instead.
   * - `userInitiated` lifts the deadline for that one bell and no other. It is
   *   passed per message and read inside that message's closure, so the bells
   *   parked earlier cannot see it and are still measured. Never widen it into
   *   `RESUME_GRACE_MS` itself: a sound the user just asked for is not a claim
   *   that something *just happened*, whereas a real bell arriving seconds late
   *   says something happened about something that didn't.
   *
   * The elapsed time is measured by the caller off `performance.now()`, and the
   * deadline is never expired by a renderer timer — those are throttled in
   * exactly the state this guard exists for (a hidden or minimized window
   * stretches them to >=1s, ~1/minute once intensively throttled), so an
   * un-expired one would let those same parked bells look live. Keep this
   * predicate pure: give it the elapsed time, don't let it read a clock.
   */
  function shouldScheduleAfterResume(elapsedMs, userInitiated) {
    return userInitiated === true || elapsedMs < RESUME_GRACE_MS;
  }

  return { RESUME_GRACE_MS, shouldScheduleAfterResume };
});
