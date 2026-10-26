/**
 * StartupTrace ring buffer (convergence plan W0).
 *
 * Verifies the instrumentation contract: bounded memory, scalar-only fields,
 * clamped strings, sequence-ordered reads, and a sink that can never throw
 * into the instrumented path.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  recordStartupEvent,
  readStartupTrace,
  resetStartupTrace,
  setStartupTraceSink,
} = require('../dist/application/observability/startupTrace');

test('records events with monotonic seq and wall-clock offsets', () => {
  resetStartupTrace();
  recordStartupEvent('app_boot_begin');
  recordStartupEvent('db_runtime_ready', { durationMs: 42, fts5: true });
  const entries = readStartupTrace();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'app_boot_begin');
  assert.equal(entries[0].seq, 1);
  assert.equal(entries[1].name, 'db_runtime_ready');
  assert.equal(entries[1].fields.durationMs, 42);
  assert.equal(entries[1].fields.fts5, true);
  assert.ok(entries[1].t >= entries[0].t);
});

test('non-scalar field values are dropped and strings are clamped to 64 chars', () => {
  resetStartupTrace();
  const long = 'x'.repeat(200);
  recordStartupEvent('wizard_goal_ready', {
    source: 'local',
    count: 2,
    dropMe: { nested: true },
    alsoDrop: [1, 2, 3],
    clamped: long,
  });
  const [entry] = readStartupTrace();
  assert.equal(entry.fields.source, 'local');
  assert.equal(entry.fields.clamped.length, 65); // 64 chars + ellipsis
  assert.ok(!('dropMe' in entry.fields));
  assert.ok(!('alsoDrop' in entry.fields));
});

test('ring buffer is bounded: oldest entries are evicted after 128 writes', () => {
  resetStartupTrace();
  for (let i = 0; i < 200; i += 1) {
    recordStartupEvent('app_boot_begin', { i });
  }
  const entries = readStartupTrace();
  assert.equal(entries.length, 128);
  assert.equal(entries[0].fields.i, 200 - 128);
  assert.equal(entries[entries.length - 1].fields.i, 199);
});

test('a throwing sink never propagates into the instrumented path', () => {
  resetStartupTrace();
  setStartupTraceSink(() => { throw new Error('sink exploded'); });
  try {
    recordStartupEvent('start_pressed', { mode: 'quick' });
    const [entry] = readStartupTrace();
    assert.equal(entry.name, 'start_pressed');
  } finally {
    setStartupTraceSink(null);
  }
});
