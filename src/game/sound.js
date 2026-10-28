// Plays a melody phrase with Web Audio: one oscillator per note, no audio files.
// Plain JS with no globals at import time; the caller passes in the AudioContext
// (created in a click handler), so this also runs in Node against a fake one.

/** Loudest a note may get (gain), whatever the caller asks for. */
const MAX_VOLUME = 0.2;
/** Seconds a note takes to fade in, so it starts without a click. */
const ATTACK_S = 0.02;

/**
 * Schedules every note on `context`, relative to `when` (context seconds).
 * Uses only context.createOscillator, context.createGain, and context.destination.
 * @param {{ createOscillator: Function, createGain: Function, destination: object }} context
 * @param {Array<{ startMs: number, durationMs: number, frequency: number }>} notes
 * @param {{ when: number, volume: number }} options volume is clamped to 0..0.2
 * @returns {{ stop(): void }} stops every note that has not ended yet; safe to call twice
 */
export function schedulePhrase(context, notes, { when, volume }) {
  const peak = Number.isFinite(volume) ? Math.min(Math.max(volume, 0), MAX_VOLUME) : 0;
  const voices = notes.map(({ startMs, durationMs, frequency }) => {
    const start = when + startMs / 1000;
    const end = when + (startMs + durationMs) / 1000;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + Math.min(ATTACK_S, (end - start) / 2));
    gain.gain.linearRampToValueAtTime(0, end);
    oscillator.connect(gain);
    gain.connect(context.destination);
    const voice = { oscillator, gain, done: false };
    oscillator.onended = () => {
      voice.done = true;
      gain.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(end);
    return voice;
  });
  return {
    stop() {
      for (const voice of voices) {
        if (voice.done) continue;
        voice.done = true;
        try {
          voice.oscillator.stop();
          voice.gain.disconnect();
        } catch {
          // Already stopped, or the context is closed: nothing left to silence.
        }
      }
    },
  };
}
