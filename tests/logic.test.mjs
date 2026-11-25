// Tests for LIFE VI's game rules (js/logic.js). Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';

const T0 = new Date(2026, 10, 24, 9, 0).getTime(); // Tue 24 Nov 2026, 9:00 AM local
const min = (n) => n * 60e3;
const hrs = (n) => n * L.HOUR;
const fresh = () => { const s = L.freshState(T0); s.seenIntro = true; return s; };
const mission = (over = {}) => ({ title: 'Do the laundry', icon: 'shirt', due: null, daily: false, ...over });

test('bars drain while awake', () => {
  const s = fresh();
  L.tick(s, T0 + hrs(2));
  assert.equal(s.stats.energy, 60);
  assert.equal(s.stats.health, 66);
  assert.equal(s.stats.focus, 58);
});

test('a focus session holds focus, then pays out', () => {
  const s = fresh();
  L.logItem(s, 'focus', T0);
  L.tick(s, T0 + min(30));
  assert.equal(s.focusUntil, null);
  assert.equal(s.stats.focus, 70 + 20 - 0.5); // drains only for the 5 minutes after the session
  assert.equal(s.alerts[0].from, 'Your Brain');
});

test('items refill their stat and walks grow stamina', () => {
  const s = fresh();
  L.logItem(s, 'meal', T0);
  L.logItem(s, 'walk', T0);
  assert.equal(s.stats.health, 85);
  assert.equal(s.stats.energy, 80);
  assert.equal(s.skills.stamina.xp, 10);
});

test('a tap reports what it added, including nothing when the bar is full', () => {
  const s = fresh();
  assert.deepEqual(L.logItem(s, 'meal', T0), { stat: 'health', gained: 15, started: false });
  s.stats.energy = 95;
  assert.equal(L.logItem(s, 'walk', T0).gained, 5);
  assert.equal(L.logItem(s, 'walk', T0).gained, 0);
  assert.equal(L.logItem(s, 'focus', T0).started, true);
  assert.equal(L.logItem(s, 'focus', T0), null); // already running
});

test('sleeping pauses drain and refills on wake', () => {
  const s = fresh();
  s.stats.energy = 30;
  L.startSleep(s, T0);
  L.tick(s, T0 + hrs(4));
  assert.equal(s.stats.energy, 30);
  L.wake(s, T0 + hrs(8));
  assert.equal(s.stats.energy, 100);
  assert.equal(s.stats.health, 70 + 24);
  assert.equal(s.skills.sleep.xp, 25);
  assert.equal(s.sleepStart, null);
});

test('a long gap is offered as sleep instead of draining', () => {
  const s = fresh();
  assert.equal(L.pendingGap(s, T0 + hrs(3)), null);
  const gap = L.pendingGap(s, T0 + hrs(7));
  assert.deepEqual(gap, { from: T0, to: T0 + hrs(7) });
  L.acceptGapAsSleep(s, gap);
  assert.equal(s.stats.energy, 100);
  assert.equal(s.last, T0 + hrs(7));
});

test('energy at zero burns you out until you sleep', () => {
  const s = fresh();
  L.tick(s, T0 + hrs(15));
  assert.equal(s.stats.energy, 0);
  assert.equal(s.burnt, true);
  L.startSleep(s, T0 + hrs(15));
  L.wake(s, T0 + hrs(16));
  assert.equal(s.burnt, false);
});

test('the device clock going backwards never refills bars', () => {
  const s = fresh();
  L.tick(s, T0 + hrs(1));
  const before = { ...s.stats };
  L.tick(s, T0);
  assert.deepEqual(s.stats, before);
});

test('a late mission raises the wanted level and alerts once', () => {
  const s = fresh();
  L.addMission(s, mission({ due: T0 + hrs(1) }), T0);
  assert.equal(L.wantedReasons(s, T0).length, 0);
  L.tick(s, T0 + hrs(2));
  L.tick(s, T0 + hrs(3));
  assert.equal(L.wantedReasons(s, T0 + hrs(3)).length, 1);
  assert.equal(s.alerts.filter((a) => a.from === 'Dispatch').length, 1);
  const r = L.completeMission(s, s.missions[0].id, T0 + hrs(3));
  assert.equal(r.wasLate, true);
  assert.equal(L.wantedReasons(s, T0 + hrs(3)).length, 0);
  assert.equal(s.respect, 50);
});

test('being up past midnight adds a star', () => {
  const s = fresh();
  const lateNight = new Date(2026, 10, 25, 1, 30).getTime();
  assert.equal(L.wantedReasons(s, lateNight).length, 1);
  L.startSleep(s, lateNight);
  assert.equal(L.wantedReasons(s, lateNight).length, 0);
});

test('a new day reopens dailies, reports misses and clears finished one-offs', () => {
  const s = fresh();
  const gym = L.addMission(s, mission({ title: 'Gym', icon: 'dumbbell', due: new Date(2026, 10, 24, 18, 0).getTime(), daily: true }), T0);
  const read = L.addMission(s, mission({ title: 'Read', icon: 'book-open', due: new Date(2026, 10, 24, 21, 0).getTime(), daily: true }), T0);
  const once = L.addMission(s, mission(), T0);
  L.completeMission(s, gym.id, T0 + hrs(1));
  L.completeMission(s, once.id, T0 + hrs(1));
  const nextMorning = new Date(2026, 10, 25, 8, 0).getTime();
  L.tick(s, nextMorning);
  assert.equal(s.missions.length, 2);
  const g = s.missions.find((m) => m.id === gym.id), r = s.missions.find((m) => m.id === read.id);
  assert.equal(g.status, 'open');
  assert.equal(g.due, new Date(2026, 10, 25, 18, 0).getTime());
  assert.equal(r.due, new Date(2026, 10, 25, 21, 0).getTime());
  assert.ok(s.alerts.some((a) => a.msg === 'You missed Read yesterday.'));
});

test('a daily mission whose time already passed today starts tomorrow', () => {
  const s = fresh();
  const m = L.addMission(s, mission({ due: new Date(2026, 10, 24, 7, 0).getTime(), daily: true }), T0);
  assert.equal(m.due, new Date(2026, 10, 25, 7, 0).getTime());
});

test('the streak counts consecutive days with a finished mission', () => {
  const s = fresh();
  L.addMission(s, mission(), T0);
  L.completeMission(s, s.missions[0].id, T0);
  const tomorrow = T0 + L.DAY;
  L.addMission(s, mission({ title: 'Call Mom back', icon: 'phone' }), tomorrow);
  L.completeMission(s, s.missions.at(-1).id, tomorrow);
  assert.equal(L.streakCount(s, tomorrow), 2);
  assert.equal(L.streakCount(s, T0 + 3 * L.DAY), 0);
});

test('mission input is checked', () => {
  const s = fresh();
  assert.throws(() => L.addMission(s, mission({ title: '   ' }), T0), /name/);
  assert.throws(() => L.addMission(s, mission({ title: 'x'.repeat(41) }), T0), /40/);
  assert.throws(() => L.addMission(s, mission({ icon: 'skull' }), T0), /icon/);
  assert.throws(() => L.addMission(s, mission({ daily: true }), T0), /time/);
  assert.throws(() => L.addMission(s, mission({ due: NaN }), T0), /valid date/);
  for (let i = 0; i < L.MAX_MISSIONS; i++) L.addMission(s, mission(), T0);
  assert.throws(() => L.addMission(s, mission(), T0), /8 missions/);
});

test('saved data round-trips and tampered data is rejected', () => {
  const s = fresh();
  L.addMission(s, mission({ due: T0 + hrs(2) }), T0);
  L.tick(s, T0 + hrs(3));
  const back = L.validateState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back, s);

  const bad = (edit) => { const c = JSON.parse(JSON.stringify(s)); edit(c); return () => L.validateState(c); };
  assert.throws(bad((c) => { c.v = 2; }));
  assert.throws(bad((c) => { c.stats.health = 1e9; }));
  assert.throws(bad((c) => { c.missions[0].title = 'x'.repeat(500); }));
  assert.throws(bad((c) => { c.missions[0].icon = '<img src=x onerror=alert(1)>'; }));
  assert.throws(bad((c) => { c.missions.push(...Array(9).fill(c.missions[0])); }));
  assert.throws(bad((c) => { c.alerts = 'nope'; }));
  assert.throws(() => L.validateState(null));

  const extra = JSON.parse(JSON.stringify(s));
  extra.isAdmin = true;
  extra.missions[0].script = 'x';
  const clean = L.validateState(extra);
  assert.equal('isAdmin' in clean, false);
  assert.equal('script' in clean.missions[0], false);
  const proto = L.validateState(JSON.parse(JSON.stringify(s).replace('{"v":1', '{"__proto__":{"polluted":true},"v":1')));
  assert.equal(proto.polluted, undefined);
  assert.equal({}.polluted, undefined);
});
