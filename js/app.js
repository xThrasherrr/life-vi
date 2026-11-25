// LIFE VI screen code: draws the HUD from saved state, handles taps and overlays, and saves to this device only.
import * as L from './logic.js';
import { VERSION } from './version.js';

const KEY = 'life-vi';
const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SKY = [
  [0, ['#0b1530', '#15224a', '#24305c']], [5, ['#1b2452', '#4b4180', '#b7849c']], [7, ['#5e93d2', '#e9bfa0', '#f6dab6']],
  [12, ['#3a88da', '#8cc0ee', '#d5eaf9']], [17, ['#4778c4', '#dda57e', '#f3cb98']], [19.5, ['#2a2d69', '#a9557c', '#e9845c']],
  [21, ['#101a3c', '#1f2b5c', '#2f3b6c']], [24, ['#0b1530', '#15224a', '#24305c']],
];

let state;
let saveFailed = false;
let gapShown = null;
let selectedId = null;
let tab = 'missions';
let editingId = null;
let opener = null;
let completeTimer = null;
let installPrompt = null;
let pendingImport = null;
let prevStars = -1;
let prevUnread = -1;
let slotsSig = null; // null forces the first draw, even with no missions
let badgeSig = '';
let alertsSig = '';

// ---- small DOM helpers (all text goes in through textContent, never as HTML) ----
function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `i ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}
function make(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}
function restart(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth; // restart the CSS animation
  el.classList.add(cls);
}
function announce(text) { $('announce').textContent = text; }

const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function fmtWhen(ms, now) {
  return L.dayKey(ms) === L.dayKey(now) ? fmtTime(ms) : `${DAYS[new Date(ms).getDay()]} ${fmtTime(ms)}`;
}
function toLocalInput(ms) {
  const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(v) { return v ? new Date(v).getTime() : null; }

function statusText(m, now) {
  if (m.status === 'done') return m.daily ? 'Done today' : 'Done';
  if (m.due === null) return 'Anytime';
  if (now > m.due) return L.lateText(now - m.due);
  if (L.dayKey(m.due) === L.dayKey(now)) return `Due ${fmtTime(m.due)}`;
  if (L.dayKey(m.due) === L.dayKey(L.startOfDay(now) + L.DAY + L.HOUR)) return `Due tomorrow ${fmtTime(m.due)}`;
  return `Due ${new Date(m.due).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`;
}
function tagText(m, now) {
  if (m.status === 'done') return 'Done';
  if (m.due === null) return 'Anytime';
  if (now > m.due) return L.shortLate(now - m.due);
  if (L.dayKey(m.due) === L.dayKey(now)) return fmtTime(m.due).replace(/:00(?=\s)/, '');
  return new Date(m.due).toLocaleDateString([], { weekday: 'short' });
}
function categoryText(m) {
  const cat = L.ICONS[m.icon];
  return m.daily ? `Daily ${cat.toLowerCase()}` : cat;
}

// ---- storage: this device only ----
function load(now) {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { saveFailed = true; }
  if (!raw) return L.freshState(now);
  try {
    return L.validateState(JSON.parse(raw));
  } catch {
    try { localStorage.setItem(`${KEY}-unreadable-${now}`, raw); } catch { /* nothing more we can do */ }
    const s = L.freshState(now);
    L.notify(s, 'LIFE VI', 'Your saved data could not be read, so the app started fresh. A copy of the old data was kept on this device.', now);
    return s;
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    saveFailed = false;
  } catch {
    if (!saveFailed) {
      saveFailed = true;
      L.notify(state, 'LIFE VI', "This browser isn't letting the app save. Private browsing can cause this, and your progress will be lost when you close the page.", Date.now());
    }
  }
}

// ---- overlays ----
const anyOverlayOpen = () => [...document.querySelectorAll('.overlay')].some((o) => !o.hidden);
function syncInert() {
  const open = anyOverlayOpen();
  for (const id of ['hud', 'menu', 'items']) $(id).inert = open;
}
function openOverlay(id, focusEl) {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  $(id).hidden = false;
  syncInert();
  (focusEl ?? $(id).querySelector('button, input'))?.focus();
}
function closeOverlay(id) {
  if ($(id).hidden) return;
  $(id).hidden = true;
  syncInert();
  if (opener && document.contains(opener) && !opener.closest('[inert]')) opener.focus();
  opener = null;
}
function setStateOverlay(id, show, focusEl) {
  if (show === !$(id).hidden) return;
  $(id).hidden = !show;
  syncInert();
  if (show) focusEl.focus();
}

function closeComplete() {
  clearTimeout(completeTimer);
  closeOverlay('complete');
}
function openAlerts(from) {
  alertsSig = '';
  openOverlay('alerts', $('alerts').querySelector('[data-close]'));
  renderAlerts(Date.now());
  opener = from;
}
function closeAlerts() {
  if ($('alerts').hidden) return;
  L.markAllRead(state);
  save();
  closeOverlay('alerts');
}
function disarm(btn) {
  btn.classList.remove('armed');
  const span = btn.querySelector('span') ?? btn;
  if (btn.dataset.label) span.textContent = btn.dataset.label;
}
function armOrRun(btn, run) {
  if (btn.classList.contains('armed')) { disarm(btn); run(); return; }
  const span = btn.querySelector('span') ?? btn;
  btn.dataset.label = span.textContent;
  span.textContent = 'Tap again to confirm';
  btn.classList.add('armed');
}

// ---- mission form ----
function buildIconPicker() {
  const grid = $('fIcons');
  for (const [name, cat] of Object.entries(L.ICONS)) {
    const opt = make('label', 'icon-opt');
    const input = make('input');
    input.type = 'radio';
    input.name = 'icon';
    input.value = name;
    input.setAttribute('aria-label', cat);
    opt.append(input, icon(name), make('span', '', cat));
    grid.append(opt);
  }
}
function openForm(m) {
  editingId = m ? m.id : null;
  $('formTitle').textContent = m ? 'Edit mission' : 'New mission';
  $('fTitle').value = m ? m.title : '';
  const pick = m ? m.icon : 'shirt';
  for (const r of $('fIcons').querySelectorAll('input')) r.checked = r.value === pick;
  $('fDue').value = m && m.due !== null ? toLocalInput(m.due) : '';
  $('fDaily').checked = m ? m.daily : false;
  $('fDelete').hidden = !m;
  disarm($('fDelete'));
  $('fError').hidden = true;
  openOverlay('form', $('fTitle'));
}
function formError(text) {
  $('fError').textContent = text;
  $('fError').hidden = false;
}

// ---- rendering ----
function buildStars() {
  const box = $('stars');
  for (let i = 0; i < L.MAX_STARS; i++) {
    const s = make('span', 'star');
    s.append(icon('star'));
    box.append(s);
  }
}

function renderSlots(now) {
  const ms = state.missions;
  const sig = ms.map((m) => `${m.id}:${m.icon}`).join(',');
  if (sig !== slotsSig) {
    slotsSig = sig;
    const box = $('slots');
    box.replaceChildren();
    for (let i = 0; i < L.MAX_MISSIONS; i++) {
      const m = ms[i];
      let el;
      if (m) {
        el = make('button', `tile p${i}`);
        el.dataset.mission = String(m.id);
        const ic = make('span', 'ic');
        ic.append(icon(m.icon));
        el.append(ic, make('span', 'strip'));
      } else if (i === ms.length) {
        el = make('button', `tile add p${i}`);
        el.dataset.add = '';
        el.setAttribute('aria-label', 'Add a mission');
        const ic = make('span', 'ic');
        ic.append(icon('plus'));
        el.append(ic, make('span', 'strip', 'Add'));
      } else {
        el = make('div', `tile p${i}`);
        el.setAttribute('aria-hidden', 'true');
      }
      box.append(el);
    }
  }
  for (const m of ms) {
    const tile = $('slots').querySelector(`[data-mission="${m.id}"]`);
    const late = m.status === 'open' && m.due !== null && now > m.due;
    tile.classList.toggle('overdue', late);
    tile.classList.toggle('done', m.status === 'done');
    tile.setAttribute('aria-pressed', String(m.id === selectedId));
    tile.setAttribute('aria-label', `${m.title}, ${statusText(m, now)}`);
    tile.querySelector('.strip').textContent = tagText(m, now);
  }
}

function renderCenter(now) {
  const sel = state.missions.find((m) => m.id === selectedId);
  const btn = $('completeBtn');
  if (!sel) {
    $('cTitle').textContent = 'No missions';
    $('cCat').textContent = state.missions.length ? '' : 'Add your first one';
    $('cSub').textContent = '';
    btn.textContent = 'Add mission';
    btn.disabled = state.missions.length >= L.MAX_MISSIONS;
    $('editBtn').hidden = true;
    return;
  }
  const late = sel.status === 'open' && sel.due !== null && now > sel.due;
  $('cTitle').textContent = sel.title;
  $('cCat').textContent = categoryText(sel);
  $('cSub').textContent = statusText(sel, now);
  $('cSub').className = 'c-sub' + (late ? ' late' : sel.status === 'done' ? ' done' : '');
  btn.textContent = sel.status === 'done' ? 'Done' : 'Complete';
  btn.disabled = sel.status === 'done';
  $('editBtn').hidden = false;
}

function renderAlerts(now) {
  const reasons = L.wantedReasons(state, now);
  const sig = reasons.map((r) => r.text).join('|') + '#' + state.alerts.map((a) => `${a.id}${a.read}`).join();
  if (sig === alertsSig) return;
  alertsSig = sig;
  const wl = $('wantedList');
  wl.replaceChildren();
  for (const r of reasons) {
    const li = make('li', 'alert-row');
    const badge = make('span', 'badge');
    badge.append(icon(r.icon));
    const text = make('div', 'alert-text');
    text.append(make('span', 'who', 'Dispatch'), make('span', 'msg', r.text));
    li.append(badge, text);
    if (r.missionId !== null) {
      const b = make('button', 'row-btn', 'Open');
      b.dataset.goto = String(r.missionId);
      b.setAttribute('aria-label', 'Open this mission');
      li.append(b);
    }
    wl.append(li);
  }
  $('wantedEmpty').hidden = reasons.length > 0;
  const ml = $('messageList');
  ml.replaceChildren();
  for (const a of state.alerts) {
    const li = make('li', a.read ? 'alert-row' : 'alert-row unread');
    const text = make('div', 'alert-text');
    text.append(make('span', 'who', a.from), make('span', 'msg', a.msg));
    li.append(icon('message-square'), text, make('span', 'when', fmtWhen(a.at, now)));
    ml.append(li);
  }
  $('messagesEmpty').hidden = state.alerts.length > 0;
}

function hexLerp(a, b, f) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  return '#' + [16, 8, 0].map((sh) => {
    const x = (pa >> sh) & 255, y = (pb >> sh) & 255;
    return Math.round(x + (y - x) * f).toString(16).padStart(2, '0');
  }).join('');
}
function skyAt(h) {
  let i = 0;
  while (SKY[i + 1][0] <= h) i++;
  const [h0, c0] = SKY[i], [h1, c1] = SKY[i + 1];
  return c0.map((c, j) => hexLerp(c, c1[j], (h - h0) / (h1 - h0)));
}

function render() {
  const now = Date.now();
  const s = state;
  const d = new Date(now);
  $('clock').textContent = `${DAYS[d.getDay()]} ${fmtTime(now)}`;

  for (const k of ['health', 'energy', 'focus']) {
    const v = s.stats[k];
    const row = document.querySelector(`[data-stat="${k}"]`);
    row.querySelector('.fill').style.transform = `scaleX(${v / 100})`;
    row.querySelector('.bar').setAttribute('aria-valuenow', String(Math.round(v)));
    row.classList.toggle('low', v < 25);
  }

  const reasons = L.wantedReasons(s, now);
  const n = reasons.length;
  $('stars').querySelectorAll('.star').forEach((el, i) => el.classList.toggle('on', i >= L.MAX_STARS - n)); // stars light from the right
  $('wantedBtn').setAttribute('aria-label', `Wanted level ${n} of ${L.MAX_STARS}. View alerts`);
  if (prevStars >= 0 && n > prevStars) restart($('stars'), 'flash');
  prevStars = n;
  const bsig = reasons.map((r) => r.key).join();
  if (bsig !== badgeSig) {
    badgeSig = bsig;
    $('badges').replaceChildren(...reasons.map((r) => { const b = make('span', 'badge'); b.append(icon(r.icon)); return b; }));
  }
  $('respect').textContent = s.respect.toLocaleString();
  $('streak').textContent = String(L.streakCount(s, now));

  const unread = L.unreadCount(s);
  $('bellCount').textContent = String(unread);
  $('bellCount').hidden = unread === 0;
  $('bellQty').textContent = `${unread} new`;
  $('bellBtn').setAttribute('aria-label', `Alerts, ${unread} unread`);
  if (prevUnread >= 0 && unread > prevUnread) {
    restart($('bellBtn'), 'ring');
    announce(`New alert from ${s.alerts[0].from}.`);
  }
  prevUnread = unread;

  if (!s.missions.some((m) => m.id === selectedId)) {
    selectedId = (s.missions.find((m) => m.status === 'open') ?? s.missions[0])?.id ?? null;
  }
  renderSlots(now);
  renderCenter(now);

  const onMissions = tab === 'missions';
  $('tab-missions').setAttribute('aria-selected', String(onMissions));
  $('tab-skills').setAttribute('aria-selected', String(!onMissions));
  $('panel-missions').hidden = !onMissions;
  $('panel-skills').hidden = onMissions;
  for (const k of ['stamina', 'sleep', 'discipline']) {
    const el = document.querySelector(`[data-skill="${k}"]`);
    el.querySelector('.skill-lv').textContent = `LV ${s.skills[k].lv}`;
    el.querySelector('.fill').style.transform = `scaleX(${s.skills[k].xp / 100})`;
  }

  const focusing = s.focusUntil !== null;
  $('focusSlot').disabled = focusing;
  $('focusSlot').classList.toggle('running', focusing);
  $('focusQty').textContent = focusing ? `${Math.max(1, Math.ceil((s.focusUntil - now) / 60e3))}m` : '25m';

  const h = d.getHours() + d.getMinutes() / 60;
  const [a, b, c] = skyAt(h);
  const root = document.documentElement.style;
  root.setProperty('--sky1', a);
  root.setProperty('--sky2', b);
  root.setProperty('--sky3', c);
  $('tint').style.setProperty('--tint-o', (0.08 + Math.max(0, Math.sin(((h - 6) / 12) * Math.PI)) * 0.2).toFixed(3));

  const sleeping = s.sleepStart !== null;
  if (sleeping) {
    $('sleepText').textContent = `Respawn point set at ${fmtWhen(s.sleepStart, now)}. Tap Wake up when you get up.`;
    $('sleepTimer').textContent = L.durationText(now - s.sleepStart);
  }
  setStateOverlay('sleep', sleeping, $('wakeBtn'));
  setStateOverlay('burnt', s.burnt && !sleeping, $('burntSleep'));
  $('screen').classList.toggle('wasted', s.burnt && !sleeping);
  if (!s.seenIntro && $('intro').hidden) openOverlay('intro', $('introStart'));
  if (!$('alerts').hidden) renderAlerts(now);
}

// ---- the clock ----
function update() {
  const now = Date.now();
  if (!$('gap').hidden || !$('intro').hidden) { render(); return; } // wait for an answer before draining
  const gap = L.pendingGap(state, now);
  if (gap) {
    gapShown = gap;
    $('gapText').textContent = `You were away ${L.durationText(gap.to - gap.from)}, from ${fmtWhen(gap.from, now)} to ${fmtTime(gap.to)}. Were you asleep?`;
    openOverlay('gap', $('gapYes'));
    render();
    return;
  }
  L.tick(state, now);
  save();
  render();
}

// ---- actions ----
const actions = {
  settingsBtn: () => { $('importConfirm').hidden = true; $('dataMsg').textContent = ''; disarm($('eraseBtn')); openOverlay('settings'); },
  completeBtn: () => {
    if (!state.missions.some((m) => m.id === selectedId)) { openForm(null); return; }
    const now = Date.now();
    L.tick(state, now);
    const r = L.completeMission(state, selectedId, now);
    if (!r) return;
    save();
    $('completeName').textContent = r.mission.title;
    $('rewardStar').hidden = !r.wasLate;
    openOverlay('complete', $('continueBtn'));
    clearTimeout(completeTimer);
    completeTimer = setTimeout(closeComplete, 5000);
    announce(`Mission complete: ${r.mission.title}. Plus 50 Respect.`);
    selectedId = state.missions.find((m) => m.status === 'open')?.id ?? selectedId;
  },
  editBtn: () => { const m = state.missions.find((x) => x.id === selectedId); if (m) openForm(m); },
  sleepSlot: () => { L.startSleep(state, Date.now()); save(); },
  wakeBtn: () => { L.wake(state, Date.now()); save(); },
  sleepCancel: () => { L.cancelSleep(state, Date.now()); save(); },
  burntSleep: () => { L.startSleep(state, Date.now()); save(); },
  introStart: () => { state.seenIntro = true; save(); closeOverlay('intro'); update(); },
  gapYes: () => {
    L.acceptGapAsSleep(state, gapShown);
    gapShown = null;
    closeOverlay('gap');
    L.tick(state, Date.now());
    save();
  },
  gapNo: () => {
    gapShown = null;
    closeOverlay('gap');
    L.tick(state, Date.now());
    save();
  },
  fClearDue: () => { $('fDue').value = ''; $('fDaily').checked = false; },
  fDelete: (b) => armOrRun(b, () => {
    L.deleteMission(state, editingId);
    save();
    closeOverlay('form');
  }),
  exportBtn: () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = make('a');
    a.href = URL.createObjectURL(blob);
    a.download = `life-vi-backup-${L.dayKey(Date.now())}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    $('dataMsg').textContent = 'Backup downloaded. Keep it somewhere safe, like your cloud drive.';
  },
  importYes: () => {
    if (!pendingImport) return;
    const now = Date.now();
    state = pendingImport;
    pendingImport = null;
    Object.assign(state, { last: now, sleepStart: null, focusUntil: null, seenIntro: true }); // resume from now, no drain for the gap
    L.rollover(state, now);
    slotsSig = null; badgeSig = alertsSig = '';
    prevStars = prevUnread = -1;
    save();
    $('importConfirm').hidden = true;
    $('dataMsg').textContent = 'Backup restored.';
  },
  importNo: () => { pendingImport = null; $('importConfirm').hidden = true; },
  eraseBtn: (b) => armOrRun(b, () => {
    try { localStorage.removeItem(KEY); } catch { /* fresh state below overwrites it anyway */ }
    state = L.freshState(Date.now());
    selectedId = null;
    slotsSig = null; badgeSig = alertsSig = '';
    prevStars = prevUnread = -1;
    save();
    closeOverlay('settings');
  }),
  installBtn: async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch { /* dismissed */ }
    installPrompt = null;
    $('installBtn').hidden = true;
  },
};

document.addEventListener('click', (e) => {
  if (!$('complete').hidden && e.target.closest('#complete')) { closeComplete(); return; }
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const now = Date.now();
  if (b.dataset.log) {
    L.tick(state, now);
    L.logItem(state, b.dataset.log, now);
    save();
  } else if (b.dataset.mission) {
    selectedId = Number(b.dataset.mission);
  } else if ('add' in b.dataset) {
    openForm(null);
  } else if (b.dataset.tab) {
    tab = b.dataset.tab;
  } else if (b.dataset.open === 'alerts') {
    openAlerts(b);
  } else if (b.dataset.goto) {
    selectedId = Number(b.dataset.goto);
    tab = 'missions';
    closeAlerts();
  } else if (b.hasAttribute('data-close')) {
    const id = b.closest('.overlay').id;
    if (id === 'alerts') closeAlerts(); else closeOverlay(id);
  } else if (actions[b.id]) {
    actions[b.id](b);
  }
  render();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('complete').hidden) closeComplete();
  else if (!$('form').hidden) closeOverlay('form');
  else if (!$('settings').hidden) closeOverlay('settings');
  else if (!$('alerts').hidden) closeAlerts();
  render();
});

$('missionForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const checked = $('fIcons').querySelector('input:checked');
  const input = { title: $('fTitle').value, icon: checked ? checked.value : '', due: fromLocalInput($('fDue').value), daily: $('fDaily').checked };
  const now = Date.now();
  try {
    L.tick(state, now);
    const m = editingId === null ? L.addMission(state, input, now) : L.editMission(state, editingId, input, now);
    selectedId = m.id;
    tab = 'missions';
    save();
    closeOverlay('form');
    render();
  } catch (err) {
    formError(err instanceof Error ? err.message : 'That mission could not be saved.');
  }
});

$('importFile').addEventListener('change', async (e) => {
  const input = e.target;
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  $('importConfirm').hidden = true;
  if (file.size > 256 * 1024) { $('dataMsg').textContent = 'That file is too big to be a LIFE VI backup.'; return; }
  try {
    pendingImport = L.validateState(JSON.parse(await file.text()));
    $('importText').textContent = `Replace everything on this device with the backup saved ${new Date(pendingImport.last).toLocaleString()}? This can't be undone.`;
    $('importConfirm').hidden = false;
    $('dataMsg').textContent = '';
  } catch {
    pendingImport = null;
    $('dataMsg').textContent = "That file isn't a LIFE VI backup, or it's damaged.";
  }
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('installBtn').hidden = false;
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') update(); else save();
});
window.addEventListener('pagehide', save);

// ---- start ----
state = load(Date.now());
$('appVersion').textContent = VERSION;
buildStars();
buildIconPicker();
update();
setInterval(update, 10e3);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is a bonus, not required */ });
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
