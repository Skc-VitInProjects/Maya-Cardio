const $ = (id) => document.getElementById(id);
let selected = '';
let delay = 1000;
let seen = [];
function cell(row, text) {
  const td = document.createElement('td');
  td.textContent = text ?? '—';
  row.append(td);
}
async function refresh() {
  try {
    const sessions = await fetch('/api/v1/sessions').then((r) => {
      if (!r.ok) throw Error();
      return r.json();
    });
    const select = $('sessions');
    const old = select.value;
    select.replaceChildren();
    for (const s of sessions) {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.id;
      select.append(o);
    }
    selected = old || sessions[0]?.id || '';
    if (selected) select.value = selected;
    if (!selected) {
      $('stale').hidden = true;
      return;
    }
    const data = await fetch(
      `/api/v1/sessions/${encodeURIComponent(selected)}/summary`,
    ).then((r) => {
      if (!r.ok) throw Error();
      return r.json();
    });
    $('stale').hidden = true;
    delay = 1000;
    $('mode').textContent = data.mode || '—';
    const sum = (x) => (Number(x?.[1]) || 0) + (Number(x?.[2]) || 0);
    $('saved').textContent = sum(data.saved).toLocaleString();
    $('cloud').textContent = sum(data.in_cloud).toLocaleString();
    $('backlog').textContent = sum(data.backlog).toLocaleString();
    seen = data.latest_windows || [];
    const latestRate = seen.find((x) => x.heart_rate != null)?.heart_rate;
    $('rate').textContent = latestRate == null ? '—' : `${latestRate} bpm`;
    draw(seen);
    const windows = $('windows');
    windows.replaceChildren();
    for (const w of seen.slice(0, 8)) {
      const tr = document.createElement('tr');
      cell(tr, w.window);
      cell(tr, w.mode);
      cell(tr, w.heart_rate == null ? '—' : `${w.heart_rate} bpm`);
      windows.append(tr);
    }
    const losses = $('losses');
    losses.replaceChildren();
    for (const l of (data.losses || []).slice(0, 12)) {
      const tr = document.createElement('tr');
      cell(tr, l.sensor);
      cell(tr, `${l.from_index}–${l.to_index ?? 'unknown'}`);
      cell(tr, l.reason);
      losses.append(tr);
    }
  } catch {
    $('stale').hidden = false;
    delay = Math.min(delay * 2, 15000);
  } finally {
    setTimeout(refresh, delay);
  }
}
function draw(rows) {
  const points = rows.filter((x) => Number.isFinite(x.heart_rate)).reverse();
  const path = $('line');
  const dots = $('dots');
  dots.replaceChildren();
  if (!points.length) {
    path.setAttribute('d', '');
    return;
  }
  const values = points.map((p) => p.heart_rate);
  const lo = Math.min(...values) - 5,
    hi = Math.max(...values) + 5;
  const d = values
    .map(
      (v, i) =>
        `${i ? 'L' : 'M'} ${40 + (i * 660) / Math.max(1, values.length - 1)} ${145 - ((v - lo) * 120) / Math.max(1, hi - lo)}`,
    )
    .join(' ');
  path.setAttribute('d', d);
  values.forEach((v, i) => {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', 40 + (i * 660) / Math.max(1, values.length - 1));
    c.setAttribute('cy', 145 - ((v - lo) * 120) / Math.max(1, hi - lo));
    c.setAttribute('r', 3);
    c.setAttribute('class', 'dot');
    dots.append(c);
  });
}
$('sessions').addEventListener('change', (e) => {
  selected = e.target.value;
});
refresh();
