import { test } from 'node:test';
import assert from 'node:assert/strict';

import { schedulePhrase } from '../src/game/sound.js';

// An AudioParam stand-in that records every value it is given.
function fakeParam(log) {
  let current = 0;
  const set = (v) => {
    current = v;
    log.push(v);
  };
  return {
    get value() {
      return current;
    },
    set value(v) {
      set(v);
    },
    setValueAtTime(v) {
      set(v);
      return this;
    },
    linearRampToValueAtTime(v) {
      set(v);
      return this;
    },
    exponentialRampToValueAtTime(v) {
      set(v);
      return this;
    },
    setTargetAtTime(v) {
      set(v);
      return this;
    },
    cancelScheduledValues() {
      return this;
    },
  };
}

// The AudioContext surface schedulePhrase may use: createOscillator, createGain, destination.
function fakeContext({ stopThrowsAfter = Infinity } = {}) {
  const oscillators = [];
  const gainValues = [];
  const node = () => ({
    connect(target) {
      return target;
    },
    disconnect() {},
  });
  return {
    oscillators,
    gainValues,
    destination: node(),
    createOscillator() {
      const osc = {
        ...node(),
        type: 'sine',
        frequency: fakeParam([]),
        starts: [],
        stops: [],
        start(t) {
          this.starts.push(t);
        },
        stop(t) {
          this.stops.push(t);
          if (this.stops.length > stopThrowsAfter) throw new Error('InvalidStateError');
        },
        addEventListener() {},
        onended: null,
      };
      oscillators.push(osc);
      return osc;
    },
    createGain() {
      return { ...node(), gain: fakeParam(gainValues) };
    },
  };
}

const NOTES = [
  { startMs: 0, durationMs: 500, frequency: 220 },
  { startMs: 625, durationMs: 500, frequency: 330 },
  { startMs: 1875, durationMs: 1100, frequency: 440 },
];
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} vs ${expected}`);

test('AC-4: schedulePhrase plays one oscillator per note at the right times, never louder than 0.2', () => {
  const context = fakeContext();
  const handle = schedulePhrase(context, NOTES, { when: 2, volume: 0.1 });
  assert.equal(context.oscillators.length, NOTES.length, 'one oscillator per note');
  NOTES.forEach((note, k) => {
    const osc = context.oscillators[k];
    assert.equal(osc.frequency.value, note.frequency, `note ${k} frequency`);
    assert.equal(osc.starts.length, 1, `note ${k} starts once`);
    near(osc.starts[0], 2 + note.startMs / 1000, `note ${k} start`);
    assert.equal(osc.stops.length, 1, `note ${k} has one scheduled stop`);
    near(osc.stops[0], 2 + (note.startMs + note.durationMs) / 1000, `note ${k} stop`);
  });
  assert.ok(context.gainValues.length > 0, 'gain envelope is set');
  assert.ok(context.gainValues.every((v) => Number.isFinite(v) && v >= 0 && v <= 0.2), 'no gain above 0.2');
  assert.ok(context.gainValues.some((v) => Math.abs(v - 0.1) < 1e-9), 'the envelope peaks at the volume');

  const loud = fakeContext();
  schedulePhrase(loud, NOTES, { when: 0, volume: 5 });
  assert.ok(loud.gainValues.every((v) => v <= 0.2), 'volume is clamped to 0.2');

  assert.doesNotThrow(() => {
    handle.stop();
    handle.stop();
  }, 'stop() twice throws nothing');
  for (const [k, osc] of context.oscillators.entries()) {
    assert.ok(osc.stops.length <= 2, `note ${k} is stopped by stop() at most once`);
  }
});

test('AC-4: stop() swallows errors from oscillators that already ended', () => {
  const context = fakeContext({ stopThrowsAfter: 1 });
  const handle = schedulePhrase(context, NOTES, { when: 0, volume: 0.1 });
  assert.doesNotThrow(() => {
    handle.stop();
    handle.stop();
  });
  for (const osc of context.oscillators) assert.ok(osc.stops.length <= 2, 'stopped at most once by stop()');
});
