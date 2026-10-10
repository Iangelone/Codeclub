import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OrbLearning, proactiveOrbTask } from '../electron-dist/orb-learning.js';
import { TaskScheduler } from '../electron-dist/task-scheduler.js';

const directory = mkdtempSync(path.join(tmpdir(), 'codeclub-orb-learning-'));
try {
  const file = path.join(directory, 'learning.json');
  let clock = 100000, active = true, busy = false;
  let orbs = [{ id: 'one', name: 'Orb', purpose: '', providerId: 'qa', modelId: 'qa', chatId: 'orb-chat-one', maximumAutonomy: true, allowComputer: false }];
  const scheduler = new TaskScheduler(path.join(directory, 'tasks.json'), async () => {}, () => {}, () => {}, () => clock);
  const scheduled = scheduler.save('', proactiveOrbTask(orbs[0], '{"currentSurface":"orb"}', 'en', clock));
  assert.equal(scheduled.status, 'paused'); assert.equal(scheduled.nextRun, undefined);
  assert.equal(scheduler.run('', scheduled.id).chatId, 'orb-chat-one'); scheduler.stop();
  const calls = [];
  const environment = { active: () => active, orbs: () => orbs, busy: () => busy, suggest: async (orb, context) => calls.push({ id: orb.id, context: JSON.parse(context) }) };
  const learner = new OrbLearning(file, environment, () => clock);
  learner.observe('orb', ['one']); await learner.tick(); assert.equal(calls.length, 1);
  assert.equal(learner.result('one', 'Would you like help with the next step?'), true);
  assert.equal(learner.result('one', 'Would you like help with the next step?'), false);
  assert.equal(learner.result('one', 'NO_SUGGESTION'), false);
  learner.respond('orb-chat-one'); assert.equal(learner.status('one').samples, 1);
  const trained = JSON.parse(readFileSync(file, 'utf8')).one;
  assert.ok(trained.weights.some(weight => weight !== 0), 'Online SGD changes weights after engagement');
  learner.observeApplication('chrome'); assert.equal(JSON.parse(readFileSync(file, 'utf8')).one.contexts['app:chrome'], undefined);
  orbs[0].allowComputer = true; learner.observeApplication('chrome', ['one']);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).one.contexts['app:chrome'], 1);
  learner.observeApplication('password-manager', ['one']);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).one.contexts['app:password-manager'], undefined);
  learner.observe('arbitrary private text', ['one']); assert.equal(learner.status('one').observations, 2);
  busy = true; clock += 61 * 60000; learner.observe('tasks', ['one']); await learner.tick(); assert.equal(calls.length, 1);
  busy = false; await learner.tick(); assert.equal(calls.length, 2);
  active = false; clock += 61 * 60000; learner.observe('chat', ['one']); await learner.tick(); assert.equal(calls.length, 2);
  assert.equal(learner.result('one', 'Hidden-window suggestion'), false);
  active = true; learner.observe('chat', []); await learner.tick(); assert.equal(calls.length, 2, 'Missing credentials prevents model work');
  orbs[0].maximumAutonomy = false; learner.refresh(); learner.observe('chat', ['one']); await learner.tick(); assert.equal(calls.length, 2);
  assert.equal(learner.status('one').samples, 1, 'Pausing retains learned weights');
  orbs[0].allowComputer = false; learner.refresh(); assert.equal(JSON.parse(readFileSync(file, 'utf8')).one.contexts['app:chrome'], undefined);
  const restored = new OrbLearning(file, environment, () => clock); assert.equal(restored.status('one').samples, 1);
  orbs = []; restored.refresh(); assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {});
  console.log(JSON.stringify({ passed: true, onlineLearning: true, metadataOnly: true, permissionGates: true, activeWindow: true, cooldown: true, deduplication: true, persistence: true }));
} finally {
  const resolved = path.resolve(directory);
  assert.ok(path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith('codeclub-orb-learning-'));
  rmSync(resolved, { recursive: true, force: true });
}
