import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4

const board = document.querySelector('[data-testid="board"]');
const list = document.querySelector('[data-testid="incident-list"]');
const empty = document.querySelector('[data-testid="empty"]');
const errorBox = document.querySelector('.error');
const updated = document.querySelector('.updated');

const acked = new Map(); // id -> ack reply; lives outside the DOM so a refresh never loses it (R2)
const pending = new Set(); // ids with an ack in flight: one call per click
const rows = new Map(); // id -> <li>, reused across refreshes

// R5: the viewer's own locale and time zone (nothing forced), day/month order comes from the locale.
const timeFmt = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
});
const localTime = (iso) => timeFmt.format(new Date(iso));
const clockFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text; // text only: incident fields never become HTML
  return node;
}

function ackedMark(reply) {
  return el('span', { 'data-testid': 'acked', class: 'acked' }, `acked ${clockFmt.format(new Date(reply.ackedAt))}`);
}

function buildRow(i) {
  const li = el('li', { 'data-testid': 'incident-row', 'data-id': i.id, class: `row ${i.severity}` });
  li.append(
    el('span', { class: 'id' }, i.id),
    el('span', { class: 'sev' }, i.severity),
    el('span', { class: 'what' }, `${i.service} · ${i.region} · ${i.summary}`),
    el('time', { datetime: i.openedAt, title: i.openedAt }, localTime(i.openedAt)),
  );
  const cell = el('span', { class: 'action' });
  if (acked.has(i.id)) cell.append(ackedMark(acked.get(i.id)));
  else {
    const btn = el('button', { type: 'button', 'data-testid': 'ack' }, 'Ack');
    btn.addEventListener('click', () => onAck(i.id, btn, cell));
    cell.append(btn);
  }
  li.append(cell);
  return li;
}

async function onAck(id, btn, cell) {
  if (pending.has(id) || acked.has(id)) return;
  pending.add(id);
  btn.disabled = true;
  btn.textContent = 'Acking…';
  try {
    const reply = await ack(id);
    acked.set(id, reply);
    cell.replaceChildren(ackedMark(reply));
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Ack';
    showError(`Ack failed for ${id}: ${err.message}`);
  } finally {
    pending.delete(id);
  }
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
}

// R1: newest first; existing rows are kept as they are, new ones are inserted in place.
function render(incidents) {
  const sorted = [...new Map(incidents.map((i) => [i.id, i])).values()].sort((a, b) =>
    b.openedAt.localeCompare(a.openedAt),
  );
  const keep = new Set(sorted.map((i) => i.id));
  for (const [id, li] of rows) if (!keep.has(id)) (li.remove(), rows.delete(id));
  let prev = null;
  for (const i of sorted) {
    let li = rows.get(i.id);
    if (!li) rows.set(i.id, (li = buildRow(i)));
    const want = prev ? prev.nextSibling : list.firstChild;
    if (li !== want) list.insertBefore(li, want);
    prev = li;
  }
  empty.hidden = sorted.length > 0;
}

let loaded = false;
async function tick() {
  try {
    const page = await fetchIncidents();
    render(page.incidents);
    updated.textContent = `updated ${new Date(page.updatedAt).toLocaleTimeString()}`;
    errorBox.hidden = true;
    if (!loaded) {
      loaded = true;
      board.querySelector('[data-testid="loader"]')?.remove(); // R3: gone once incidents load
    }
  } catch (err) {
    showError(`Could not refresh: ${err.message}. Retrying.`);
  } finally {
    setTimeout(tick, REFRESH_MS); // R4: one request at a time, every 2 s
  }
}

tick();
