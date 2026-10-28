import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneCoordinator } from '../src/scene-coordinator.ts';
const scene = (id, transition = '') => ({ id, name: id, entry: 'scenes/' + id + '/index.html', obsScene: '', width: 1920, height: 1080, transition, settingsPage: '' });
function setup() {
  const shown = [], removed = [], calls = [];
  const driver = {
    async load(scene) { return { id: scene.id }; },
    async transition(from, to, covered) { calls.push([from.id, to.id]); covered(); },
    show(next) { shown.push(next.id); }, remove(value) { removed.push(value.id); },
  };
  return { driver, shown, removed, calls, coordinator: new SceneCoordinator(driver) };
}
test('initial scene loads once and repeated state snapshots do not remount it', async () => {
  const x = setup(); await x.coordinator.activate(scene('a', 'fade.js')); await x.coordinator.activate(scene('a', 'fade.js'));
  assert.deepEqual(x.shown, ['a']); assert.deepEqual(x.calls, []);
});
test('the old scene stays visible until covered() and duplicate covered signals commit only once', async () => {
  const x = setup(); let release;
  await x.coordinator.activate(scene('a'));
  x.driver.transition = async (_, __, covered) => { await new Promise(resolve => release = resolve); covered(); covered(); };
  const changing = x.coordinator.activate(scene('b', 'fade.js'));
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(x.shown, ['a']);
  release(); await changing; assert.deepEqual(x.shown, ['a', 'b']); assert.deepEqual(x.removed, ['a']);
});
test('a newer request cancels an older uncommitted transition', async () => {
  const x = setup(); await x.coordinator.activate(scene('a'));
  x.driver.transition = async (_, __, covered, signal) => { await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('canceled')), { once: true })); covered(); };
  const old = x.coordinator.activate(scene('b', 'fade.js')); await new Promise(resolve => setImmediate(resolve));
  await x.coordinator.activate(scene('c')); await old;
  assert.deepEqual(x.shown, ['a', 'c']); assert.ok(x.removed.includes('b')); assert.ok(x.removed.includes('a'));
});
test('a stale loader is disposed even if it ignores cancellation', async () => {
  const x = setup(); let release;
  x.driver.load = value => value.id === 'a' ? new Promise(resolve => release = () => resolve({ id: 'a' })) : Promise.resolve({ id: value.id });
  const old = x.coordinator.activate(scene('a')); await x.coordinator.activate(scene('b')); release(); await old;
  assert.deepEqual(x.shown, ['b']); assert.deepEqual(x.removed, ['a']);
});
test('invalid transition implementations leave the current scene intact and can be retried', async () => {
  const x = setup(); await x.coordinator.activate(scene('a')); x.driver.transition = async () => {};
  await assert.rejects(x.coordinator.activate(scene('b', 'bad.js')), /covered/); assert.deepEqual(x.shown, ['a']);
  x.driver.transition = async (_, __, covered) => covered(); await x.coordinator.activate(scene('b', 'bad.js')); assert.deepEqual(x.shown, ['a', 'b']);
});
test('clearing disposes the active scene and permits opening it again', async () => {
  const x = setup(); await x.coordinator.activate(scene('a')); x.coordinator.clear(); await x.coordinator.activate(scene('a'));
  assert.deepEqual(x.removed, ['a']); assert.deepEqual(x.shown, ['a', 'a']);
});

test('views sharing a runtime keep their page and update the active scene context', async () => {
  const x = setup(), updates = [];
  x.driver.update = (value, previous, next) => updates.push([value.id, previous.id, next.id]);
  const wide = { ...scene('wide'), entry: 'presets/demo/ui/index.html', runtimeGroup: 'demo__overlay' };
  const full = { ...wide, id: 'full', view: '16:9' };
  await x.coordinator.activate(wide); await x.coordinator.activate(full); await x.coordinator.activate(full);
  assert.deepEqual(x.shown, ['wide']); assert.deepEqual(x.removed, []);
  assert.deepEqual(updates, [['wide', 'wide', 'full']]);
  await x.coordinator.activate({ ...full, id: 'other', entry: 'presets/demo/other.html' });
  assert.deepEqual(x.shown, ['wide', 'other']); assert.deepEqual(x.removed, ['wide']);
});
