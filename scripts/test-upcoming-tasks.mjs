/** Native anticipation and due-time execution with isolated storage and a controlled clock. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TaskScheduler } from '../electron-dist/task-scheduler.js';
import { OrbLearning } from '../electron-dist/orb-learning.js';

const directory = mkdtempSync(path.join(tmpdir(), 'codeclub-upcoming-tasks-'));
let scheduler;
try {
  let now = Date.parse('2026-10-09T12:00:00Z'), active = true, busy = false;
  const executed = [], notices = [];
  scheduler = new TaskScheduler(path.join(directory, 'tasks.json'), async task => { executed.push(task.id); }, () => {}, () => {}, () => now);
  const base = { name: 'Study React', prompt: 'Prepare a study plan', provider: 'qa', model: 'qa', status: 'active', interval: 'Una vez', runAt: new Date(now + 16 * 60000).toISOString() };
  scheduler.save('', { ...base, id: 'study' });
  scheduler.save('C:\\fixture-project', { ...base, id: 'paused', status: 'paused' });
  scheduler.save('', { ...base, id: 'orb_internal', autonomous: true });
  const orbs = [{ id: 'one', name: 'Orb', purpose: '', providerId: 'qa', modelId: 'qa', maximumAutonomy: true }];
  const environment = { active: () => active, orbs: () => orbs, busy: () => busy, upcoming: () => scheduler.upcoming(), suggest: async (_, context) => { notices.push(JSON.parse(context)); } };
  const file = path.join(directory, 'learning.json');
  let learner = new OrbLearning(file, environment, () => now);
  learner.observe('orb', ['one']); await learner.tick();
  assert.equal(notices.length, 1); assert.deepEqual(notices[0].upcomingTasks, []);
  learner.result('one', 'General suggestion');
  now += 60000; learner.observe('orb', ['one']); await learner.tick();
  assert.equal(notices.length, 2, 'Approaching tasks bypass generic suggestion cooldowns');
  assert.equal(notices[1].upcomingTasks[0].name, 'Study React');
  assert.equal(notices[1].upcomingTasks.length, 1, 'Paused and internal orb jobs are excluded');
  assert.equal(notices[1].upcomingTasks[0].key, undefined);
  scheduler.tick(); assert.deepEqual(executed, [], 'Anticipation does not execute tasks early');
  await learner.tick(); assert.equal(notices.length, 2);
  learner = new OrbLearning(file, environment, () => now);
  learner.observe('orb', ['one']); await learner.tick(); assert.equal(notices.length, 2, 'Occurrence deduplication survives restart');
  const rescheduled = scheduler.save('', { ...base, id: 'study', runAt: new Date(now + 14 * 60000).toISOString() });
  busy = true; await learner.tick(); assert.equal(notices.length, 2);
  busy = false; active = false; await learner.tick(); assert.equal(notices.length, 2);
  active = true; learner.observe('tasks', []); await learner.tick(); assert.equal(notices.length, 2);
  learner.observe('tasks', ['one']); await learner.tick(); assert.equal(notices.length, 3, 'Rescheduling creates a new occurrence');
  scheduler.save('C:\\fixture-project', { ...base, id: 'project', runAt: rescheduled.nextRun });
  await learner.tick(); assert.equal(notices.at(-1).upcomingTasks[0].projectPath, 'C:\\fixture-project');
  now = Date.parse(rescheduled.nextRun); scheduler.tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(executed.sort(), ['project', 'study']);
  scheduler.tick(); await new Promise(resolve => setImmediate(resolve)); assert.equal(executed.length, 2, 'Repeated ticks do not duplicate runs');
  assert.equal(scheduler.list('')[0].runs[0].status, 'completed');
  assert.deepEqual(scheduler.upcoming(), []);
  console.log(JSON.stringify({ passed: true, advanceNotice: true, persistedDeduplication: true, activeUseAndCredentialGates: true, scopedTasks: true, dueTimeExecution: true, noEarlyOrDuplicateExecution: true }));
} finally {
  scheduler?.stop();
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith('codeclub-upcoming-tasks-'));
  rmSync(directory, { recursive: true, force: true });
}
