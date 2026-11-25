// Game rules for LIFE VI: stat drain, sleep, items, missions, wanted level, alerts and save-file validation. No DOM here.

export const HOUR = 3600e3;
export const DAY = 24 * HOUR;
export const DRAIN = { health: 2, energy: 5, focus: 6 }; // points lost per hour awake
export const MAX_STARS = 6;
export const MAX_MISSIONS = 8;
export const MAX_ALERTS = 40;
export const MAX_TITLE = 40;
export const FOCUS_MS = 25 * 60e3;
export const GAP_ASK_MS = 4 * HOUR; // away this long and we ask whether it was sleep
export const MAX_SLEEP_HOURS = 12;
export const ICONS = {
  shirt: 'Chores', phone: 'Family', dumbbell: 'Fitness', 'book-open': 'Growth',
  briefcase: 'Work', 'heart-pulse': 'Health', users: 'Social', wallet: 'Money',
  house: 'Home', 'graduation-cap': 'School', car: 'Errands', 'chef-hat': 'Food',
};
export const ITEMS = {
  meal: { stat: 'health', amount: 15 },
  water: { stat: 'health', amount: 5 },
  walk: { stat: 'energy', amount: 10 },
};
const STATS = ['health', 'energy', 'focus'];
const SKILLS = ['stamina', 'sleep', 'discipline'];
const SKILL_NAMES = { stamina: 'Stamina', sleep: 'Sleep', discipline: 'Discipline' };
const LOW = {
  health: ['Your Body', 'Health is low. Eat something real and drink some water.'],
  energy: ['Your Legs', 'Energy is low. A walk or a nap would fix this.'],
  focus: ['Your Brain', 'Focus is gone. Put the phone down for 25 minutes.'],
};

const clamp = (v) => Math.max(0, Math.min(100, v));

export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function freshState(now) {
  return {
    v: 1,
    last: now,
    day: dayKey(now),
    stats: { health: 70, energy: 70, focus: 70 },
    respect: 0,
    streak: { count: 0, day: null },
    skills: { stamina: { lv: 1, xp: 0 }, sleep: { lv: 1, xp: 0 }, discipline: { lv: 1, xp: 0 } },
    missions: [],
    alerts: [],
    nextId: 1,
    focusUntil: null,
    sleepStart: null,
    burnt: false,
    warned: { health: false, energy: false, focus: false },
    seenIntro: false,
  };
}

export function notify(s, from, msg, now) {
  s.alerts.unshift({ id: s.nextId++, from, msg, at: now, read: false });
  if (s.alerts.length > MAX_ALERTS) s.alerts.length = MAX_ALERTS;
}
export const unreadCount = (s) => s.alerts.filter((a) => !a.read).length;
export function markAllRead(s) { for (const a of s.alerts) a.read = true; }

function bump(s, stat, n) { s.stats[stat] = clamp(s.stats[stat] + n); }
function gainXp(s, skill, n, now) {
  const k = s.skills[skill];
  k.xp += n;
  while (k.xp >= 100) {
    k.xp -= 100;
    k.lv++;
    notify(s, 'Skill up', `${SKILL_NAMES[skill]} is now level ${k.lv}.`, now);
  }
}

function drain(s, from, to) {
  const hours = (to - from) / HOUR;
  s.stats.health = clamp(s.stats.health - DRAIN.health * hours);
  s.stats.energy = clamp(s.stats.energy - DRAIN.energy * hours);
  // Focus holds during a focus session and drains only for the time after it ended
  const focusFrom = s.focusUntil === null ? from : Math.max(from, Math.min(to, s.focusUntil));
  s.stats.focus = clamp(s.stats.focus - DRAIN.focus * ((to - focusFrom) / HOUR));
}

// Away long enough that we should ask whether the gap was sleep, before draining for it.
export function pendingGap(s, now) {
  if (s.sleepStart !== null || s.burnt) return null;
  return now - s.last >= GAP_ASK_MS ? { from: s.last, to: now } : null;
}

// Advance the world to `now`: drain, finish focus sessions, roll the day, raise alerts.
export function tick(s, now) {
  if (now < s.last) s.last = now; // device clock moved backwards: skip, don't refill
  if (s.sleepStart === null && !s.burnt) {
    drain(s, s.last, now);
    if (s.focusUntil !== null && now >= s.focusUntil) {
      s.focusUntil = null;
      bump(s, 'focus', 20);
      gainXp(s, 'discipline', 15, now);
      notify(s, 'Your Brain', 'Focus session done. +20 Focus.', now);
    }
  }
  s.last = now;
  rollover(s, now);
  for (const m of s.missions) {
    if (m.status === 'open' && m.due !== null && now > m.due && !m.lateNotified) {
      m.lateNotified = true;
      notify(s, 'Dispatch', `Wanted level up. Suspect missed a deadline: ${m.title}.`, now);
    }
  }
  if (s.sleepStart === null) {
    for (const k of STATS) {
      const v = s.stats[k];
      if (v < 25 && !s.warned[k]) { s.warned[k] = true; notify(s, ...LOW[k], now); }
      else if (v > 40) s.warned[k] = false;
    }
    if (s.stats.energy <= 0 && !s.burnt) { s.burnt = true; s.focusUntil = null; }
  }
}

function sameTimeOn(dayStart, ms) {
  const src = new Date(ms), d = new Date(dayStart);
  d.setHours(src.getHours(), src.getMinutes(), 0, 0);
  return d.getTime();
}

// New day: reopen daily missions, clear finished one-offs, report missed dailies.
export function rollover(s, now) {
  const today = dayKey(now);
  if (s.day === today) return;
  const start = startOfDay(now);
  s.missions = s.missions.filter((m) => m.daily || m.status !== 'done' || m.doneAt >= start);
  for (const m of s.missions) {
    if (!m.daily || m.due === null) continue;
    const doneBeforeToday = m.status === 'done' && m.doneAt < start;
    if (m.due >= start && !doneBeforeToday) continue;
    if (m.status === 'open') notify(s, 'Dispatch', `You missed ${m.title} yesterday.`, now);
    if (m.due < start) m.due = sameTimeOn(start, m.due);
    m.status = 'open';
    m.doneAt = null;
    m.lateNotified = false;
  }
  s.day = today;
}

export function wantedReasons(s, now) {
  const reasons = s.missions
    .filter((m) => m.status === 'open' && m.due !== null && now > m.due)
    .map((m) => ({ key: `m${m.id}`, missionId: m.id, icon: m.icon, text: `Suspect missed a deadline: ${m.title} (${lateText(now - m.due)}).` }));
  const hour = new Date(now).getHours();
  if (s.sleepStart === null && hour < 5) reasons.push({ key: 'night', missionId: null, icon: 'moon', text: 'Suspect is still awake past midnight.' });
  return reasons.slice(0, MAX_STARS);
}

export function streakCount(s, now) {
  const today = dayKey(now), yesterday = dayKey(startOfDay(now) - 1);
  return s.streak.day === today || s.streak.day === yesterday ? s.streak.count : 0;
}

export function logItem(s, kind, now) {
  if (kind === 'focus') {
    if (s.focusUntil === null) s.focusUntil = now + FOCUS_MS;
    return;
  }
  const item = ITEMS[kind];
  if (!item) return;
  bump(s, item.stat, item.amount);
  if (kind === 'walk') gainXp(s, 'stamina', 10, now);
}

function restoreFromSleep(s, hours, now) {
  const h = Math.min(Math.max(hours, 0), MAX_SLEEP_HOURS);
  bump(s, 'health', Math.min(25, h * 3));
  bump(s, 'energy', h * 12.5);
  bump(s, 'focus', h * 12.5);
  if (h >= 7) gainXp(s, 'sleep', 25, now);
  s.burnt = false;
  s.focusUntil = null;
  s.last = now;
  notify(s, 'Your Body', `You slept ${durationText(h * HOUR)}. Health, Energy and Focus refilled.`, now);
  return h;
}
export function startSleep(s, now) {
  tick(s, now);
  s.sleepStart = now;
  s.focusUntil = null;
}
export function wake(s, now) {
  if (s.sleepStart === null) return 0;
  const hours = (now - s.sleepStart) / HOUR;
  s.sleepStart = null;
  const h = restoreFromSleep(s, hours, now);
  rollover(s, now);
  return h;
}
export function cancelSleep(s, now) {
  // tapped Sleep by mistake: no refill, and no drain for the few minutes it was on
  s.sleepStart = null;
  s.last = now;
}
export function acceptGapAsSleep(s, gap) {
  const h = restoreFromSleep(s, (gap.to - gap.from) / HOUR, gap.to);
  rollover(s, gap.to);
  return h;
}

export function cleanMissionInput(input, now) {
  const title = String(input.title ?? '').trim().replace(/\s+/g, ' ');
  if (!title) throw new Error('Give the mission a name.');
  if (title.length > MAX_TITLE) throw new Error(`Keep the name to ${MAX_TITLE} characters.`);
  if (!Object.hasOwn(ICONS, input.icon)) throw new Error('Pick an icon.');
  const due = input.due === null || input.due === '' || input.due === undefined ? null : Number(input.due);
  if (due !== null && !Number.isFinite(due)) throw new Error('That deadline is not a valid date.');
  const daily = Boolean(input.daily);
  if (daily && due === null) throw new Error('A daily mission needs a time.');
  return { title, icon: input.icon, due: daily ? nextDaily(due, now) : due, daily };
}
// A daily mission starts at its time today, or tomorrow if that time has already passed
function nextDaily(due, now) {
  const today = sameTimeOn(startOfDay(now), due);
  return today > now ? today : sameTimeOn(startOfDay(now) + DAY + HOUR, due);
}
export function addMission(s, input, now) {
  if (s.missions.length >= MAX_MISSIONS) throw new Error(`You can have ${MAX_MISSIONS} missions at a time.`);
  const c = cleanMissionInput(input, now);
  const m = { id: s.nextId++, title: c.title, icon: c.icon, due: c.due, daily: c.daily, status: 'open', doneAt: null, lateNotified: c.due !== null && now > c.due };
  s.missions.push(m);
  return m;
}
export function editMission(s, id, input, now) {
  const m = s.missions.find((x) => x.id === id);
  if (!m) throw new Error('That mission no longer exists.');
  const c = cleanMissionInput(input, now);
  Object.assign(m, { title: c.title, icon: c.icon, due: c.due, daily: c.daily, lateNotified: c.due !== null && now > c.due });
  return m;
}
export function deleteMission(s, id) { s.missions = s.missions.filter((m) => m.id !== id); }

export function completeMission(s, id, now) {
  const m = s.missions.find((x) => x.id === id);
  if (!m || m.status === 'done') return null;
  const wasLate = m.due !== null && now > m.due;
  m.status = 'done';
  m.doneAt = now;
  s.respect += 50;
  gainXp(s, 'discipline', 30, now);
  const today = dayKey(now), yesterday = dayKey(startOfDay(now) - 1);
  if (s.streak.day !== today) {
    s.streak.count = s.streak.day === yesterday ? s.streak.count + 1 : 1;
    s.streak.day = today;
  }
  return { mission: m, wasLate };
}

export function durationText(ms) {
  const mins = Math.max(0, Math.round(ms / 60e3));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
export function lateText(ms) {
  const days = Math.floor(ms / DAY);
  if (days >= 1) return `${days} day${days > 1 ? 's' : ''} late`;
  const hours = Math.floor(ms / HOUR);
  if (hours >= 1) return `${hours} hour${hours > 1 ? 's' : ''} late`;
  return `${Math.max(1, Math.floor(ms / 60e3))} min late`;
}
export function shortLate(ms) {
  const days = Math.floor(ms / DAY);
  if (days >= 1) return `${days}d late`;
  const hours = Math.floor(ms / HOUR);
  return hours >= 1 ? `${hours}h late` : 'Late';
}

// ---- Save-file validation: everything loaded from storage or a backup file passes through here ----

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const time = (v) => num(v, 0, 8.64e15);
const str = (v, max) => typeof v === 'string' && v.length <= max;

export function validateState(raw) {
  const fail = (what) => { throw new Error(`Save data is not valid (${what}).`); };
  if (!isObj(raw) || raw.v !== 1) fail('version');
  const out = freshState(0);
  if (!time(raw.last)) fail('last');
  out.last = raw.last;
  if (!str(raw.day, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(raw.day)) fail('day');
  out.day = raw.day;
  if (!isObj(raw.stats)) fail('stats');
  for (const k of STATS) { if (!num(raw.stats[k], 0, 100)) fail(`stats.${k}`); out.stats[k] = raw.stats[k]; }
  if (!int(raw.respect, 0, 1e9)) fail('respect');
  out.respect = raw.respect;
  if (!isObj(raw.streak) || !int(raw.streak.count, 0, 1e6) || !(raw.streak.day === null || (str(raw.streak.day, 10) && /^\d{4}-\d{2}-\d{2}$/.test(raw.streak.day)))) fail('streak');
  out.streak = { count: raw.streak.count, day: raw.streak.day };
  if (!isObj(raw.skills)) fail('skills');
  for (const k of SKILLS) {
    const sk = raw.skills[k];
    if (!isObj(sk) || !int(sk.lv, 1, 9999) || !num(sk.xp, 0, 99.999)) fail(`skills.${k}`);
    out.skills[k] = { lv: sk.lv, xp: sk.xp };
  }
  if (!int(raw.nextId, 1, 1e12)) fail('nextId');
  out.nextId = raw.nextId;
  if (!Array.isArray(raw.missions) || raw.missions.length > MAX_MISSIONS) fail('missions');
  const ids = new Set();
  out.missions = raw.missions.map((m, i) => {
    if (!isObj(m) || !int(m.id, 1, 1e12) || ids.has(m.id) || m.id >= raw.nextId) fail(`missions[${i}].id`);
    ids.add(m.id);
    if (!str(m.title, MAX_TITLE) || !m.title.trim()) fail(`missions[${i}].title`);
    if (!Object.hasOwn(ICONS, m.icon)) fail(`missions[${i}].icon`);
    if (!(m.due === null || time(m.due))) fail(`missions[${i}].due`);
    if (typeof m.daily !== 'boolean' || (m.daily && m.due === null)) fail(`missions[${i}].daily`);
    if (m.status !== 'open' && m.status !== 'done') fail(`missions[${i}].status`);
    if (!(m.doneAt === null || time(m.doneAt))) fail(`missions[${i}].doneAt`);
    return { id: m.id, title: m.title, icon: m.icon, due: m.due, daily: m.daily, status: m.status, doneAt: m.doneAt, lateNotified: m.lateNotified === true };
  });
  if (!Array.isArray(raw.alerts) || raw.alerts.length > MAX_ALERTS) fail('alerts');
  out.alerts = raw.alerts.map((a, i) => {
    if (!isObj(a) || !int(a.id, 1, 1e12) || !str(a.from, 40) || !str(a.msg, 300) || !time(a.at)) fail(`alerts[${i}]`);
    return { id: a.id, from: a.from, msg: a.msg, at: a.at, read: a.read === true };
  });
  if (!(raw.focusUntil === null || time(raw.focusUntil))) fail('focusUntil');
  out.focusUntil = raw.focusUntil;
  if (!(raw.sleepStart === null || time(raw.sleepStart))) fail('sleepStart');
  out.sleepStart = raw.sleepStart;
  out.burnt = raw.burnt === true;
  if (isObj(raw.warned)) for (const k of STATS) out.warned[k] = raw.warned[k] === true;
  out.seenIntro = raw.seenIntro === true;
  return out;
}
