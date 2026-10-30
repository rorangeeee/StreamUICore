import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoSave } from '../src/sdk/autosave.ts';

test('flush starts the transport synchronously so pagehide can send a keepalive write', async () => {
  const writes = [], save = createAutoSave(async value => { writes.push(value); });
  save.update({ title: 'Last edit' }); const completed = save.flush();
  assert.deepEqual(writes, [{ title: 'Last edit' }]); await completed;
});

test('autosave coalesces independent fields without saving a stale settings snapshot', async () => {
  const writes = [], statuses = [];
  const save = createAutoSave(async value => { writes.push(value); }, { onStatus: value => statuses.push(value) });
  save.update({ titles: { english: ['First'] } });
  save.update({ away: { overlayOpacity: .5 } });
  save.update({ titles: { english: ['Latest'] } });
  await save.flush();
  assert.deepEqual(writes, [{ titles: { english: ['Latest'] }, away: { overlayOpacity: .5 } }]);
  assert.equal(statuses.at(-1), 'saved');
});

test('a newer edit waits for the current write and is persisted last', async () => {
  const writes = []; let release;
  const save = createAutoSave(value => {
    writes.push(value);
    return writes.length === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  });
  save.update({ gain: 1 }); const first = save.flush();
  await new Promise(setImmediate);
  save.update({ gain: 2 }, true);
  assert.deepEqual(writes, [{ gain: 1 }]);
  release(); await first; await save.flush();
  assert.deepEqual(writes, [{ gain: 1 }, { gain: 2 }]);
});

test('failed writes retain pending edits for retry without reverting newer input', async () => {
  const writes = []; let release;
  const save = createAutoSave(value => {
    writes.push(value);
    return writes.length === 1 ? new Promise((_, reject) => { release = reject; }) : Promise.resolve();
  });
  save.update({ title: 'First', custom: true }); const failed = save.flush();
  await new Promise(setImmediate); save.update({ title: 'Latest' });
  release(new Error('offline')); await assert.rejects(failed, /offline/);
  await save.flush();
  assert.deepEqual(writes[1], { title: 'Latest', custom: true });
});

test('whole-object JSON editors can replace a draft and remove keys', async () => {
  const writes = [];
  const save = createAutoSave(async value => { writes.push(value); }, { merge: (_, next) => next });
  save.update({ keep: true, remove: true }); save.update({ keep: true });
  await save.flush(); assert.deepEqual(writes, [{ keep: true }]);
});
