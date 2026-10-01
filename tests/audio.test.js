/* audio.js at runtime: silent by design, and sfx() never throws (#06). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initAudio, sfx, sfxReset } from '../audio.js';

test('without the launcher audio the game is silent, and sfx never throws', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.doesNotThrow(() => sfx('uncap', { hive: 'clover' }));
  globalThis.window = {};
  assert.doesNotThrow(() => initAudio());
  globalThis.window = { Arcade: {}, ArcadeSoundPack: { ROOM: {}, SENDS: {}, CUES: { uncap() {} } } };
  initAudio();                                  // no Arcade.audio: nothing registered
  assert.doesNotThrow(() => sfx('uncap', {}));
  assert.doesNotThrow(() => sfx());
  assert.doesNotThrow(() => sfxReset());
});

test('with it, cues are registered, throttled, and a throwing play is swallowed', () => {
  const played = [];
  const graphs = [];
  globalThis.window = {
    Arcade: { audio: {
      room() {}, graph(name) { graphs.push(name); },
      play(name, p) { if (name === 'boom') throw new Error('boom'); played.push([name, p]); },
    } },
    ArcadeSoundPack: { ROOM: {}, SENDS: { uncap: 0.1, boom: 0 }, CUES: { uncap() {}, boom() {} } },
  };
  initAudio();
  assert.deepEqual(graphs, ['uncap', 'boom']);
  sfx('uncap', { hive: 'clover', seed: 1, progress: 0.5, cells: 1, secret: 'G' });
  sfx('uncap', { hive: 'clover', seed: 1, progress: 0.5, cells: 1 });   // inside 40 ms: folded
  assert.equal(played.length, 1);
  assert.equal(played[0][0], 'uncap');
  assert.equal('secret' in played[0][1], false, 'fields outside the allowed set never reach a cue');
  assert.equal(played[0][1].step, 3);
  assert.doesNotThrow(() => sfx('boom', {}));
  assert.doesNotThrow(() => sfx('uncap', 'not an object'));
  delete globalThis.window;
  assert.doesNotThrow(() => sfx('won', {}), 'the page going away mid-play is still silent');
});
