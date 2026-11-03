// Pure decision logic for the tmux options the view sets (#311 review H-1):
// an option is done only once tmux accepted it; "no server yet" is retried,
// a rejection is final.
const { test } = require('node:test');
const assert = require('node:assert');

const {
  TMUX_OPTIONS,
  classifyTmuxFailure,
  initialTmuxOptionState,
  nextTmuxOptionState,
  tmuxOptionStateForAttach,
} = require('../src/tmux-options.ts');

test('the view sets allow-passthrough and monitor-bell, and never set-clipboard', () => {
  const keys = TMUX_OPTIONS.map((o) => o.key);
  assert.deepStrictEqual(keys.sort(), ['allow-passthrough', 'monitor-bell']);
  for (const o of TMUX_OPTIONS) {
    assert.ok(!o.args.includes('set-clipboard'), `${o.key} must not touch set-clipboard`);
  }
});

test('classifies the stderr tmux 3.6 prints with no server as retryable', () => {
  // Both strings measured on tmux 3.6 against a private socket.
  assert.strictEqual(classifyTmuxFailure('error connecting to /tmp/tmux-501/x (No such file or directory)\n'), 'no-server');
  assert.strictEqual(classifyTmuxFailure('no server running on /tmp/tmux-501/x\n'), 'no-server');
  assert.strictEqual(classifyTmuxFailure('invalid option: allow-passthrough\n'), 'rejected');
  assert.strictEqual(classifyTmuxFailure(''), 'rejected');
});

test('a no-server failure stays pending (the first-attach race)', () => {
  const s0 = initialTmuxOptionState();
  const s1 = nextTmuxOptionState(s0, { 'monitor-bell': 'no-server', 'allow-passthrough': 'no-server' });
  assert.deepStrictEqual([...s1.pending].sort(), ['allow-passthrough', 'monitor-bell']);
  const s2 = nextTmuxOptionState(s1, { 'monitor-bell': 'ok', 'allow-passthrough': 'ok' });
  assert.deepStrictEqual(s2.pending, []);
  assert.deepStrictEqual(s2.failed, {});
});

test('a rejection is final and does not hold back the other option', () => {
  const s1 = nextTmuxOptionState(initialTmuxOptionState(), {
    'monitor-bell': 'ok',
    'allow-passthrough': 'rejected',
  });
  assert.deepStrictEqual(s1.pending, []);
  assert.deepStrictEqual(s1.failed, { 'allow-passthrough': 'rejected' });
});

test('no-server becomes final after the attempt bound', () => {
  let s = initialTmuxOptionState();
  for (let i = 0; i < 3; i++) {
    s = nextTmuxOptionState(s, { 'monitor-bell': 'no-server', 'allow-passthrough': 'ok' }, 3);
  }
  assert.deepStrictEqual(s.pending, []);
  assert.deepStrictEqual(s.failed, { 'monitor-bell': 'no-server' });
  assert.strictEqual(s.attempts['monitor-bell'], 3);
});

test('a key with no outcome this round is left pending untouched', () => {
  const s1 = nextTmuxOptionState(initialTmuxOptionState(), { 'monitor-bell': 'ok' });
  assert.deepStrictEqual(s1.pending, ['allow-passthrough']);
  assert.strictEqual(s1.attempts['allow-passthrough'], undefined);
});

test('every attach re-applies all options, even ones a previous server accepted', () => {
  // exit-empty: the server that accepted them may be gone by the next attach.
  const done = nextTmuxOptionState(initialTmuxOptionState(), {
    'monitor-bell': 'ok',
    'allow-passthrough': 'rejected',
  });
  assert.deepStrictEqual(done.pending, []);
  const next = tmuxOptionStateForAttach(done);
  assert.deepStrictEqual([...next.pending].sort(), ['allow-passthrough', 'monitor-bell']);
  assert.deepStrictEqual(next.failed, {});
  assert.deepStrictEqual(next.attempts, {});
});
