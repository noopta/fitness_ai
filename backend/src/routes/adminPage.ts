/**
 * The admin dashboard page itself.
 *
 * Embedded as a string rather than shipped as a .html file because the esbuild
 * step only compiles .ts into dist/ — a sibling .html would silently not be
 * deployed. Inlining it guarantees the page ships with the build.
 *
 * Served from the API origin so the liftoff_jwt cookie (first-party for
 * api.airthreads.ai) authenticates the fetches with no extra login. A token box
 * is offered as a fallback for the case where the cookie is absent or expired.
 *
 * Deliberately dependency-free: no CDN, no framework. The whole dataset is a
 * few hundred rows, and a build pipeline for an internal page nobody but us
 * loads would cost more than it saves.
 */
export const ADMIN_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Axiom · Admin</title>
<style>
  :root {
    --bg:#fff; --fg:#18181b; --muted:#71717a; --border:#e4e4e7;
    --card:#fafafa; --accent:#18181b; --warn:#b45309; --good:#15803d;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#09090b; --fg:#fafafa; --muted:#a1a1aa; --border:#27272a;
            --card:#131316; --accent:#fafafa; --warn:#f59e0b; --good:#4ade80; }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);
       font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:1180px;margin:0 auto;padding:28px 20px 80px}
  h1{font-size:19px;margin:0;letter-spacing:-.3px}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);
     margin:34px 0 12px;font-weight:600}
  header{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .sub{color:var(--muted);font-size:12px}
  button{font:inherit;background:var(--card);color:var(--fg);border:1px solid var(--border);
         border-radius:8px;padding:6px 12px;cursor:pointer}
  button:hover{border-color:var(--muted)}
  .card{border:1px solid var(--border);border-radius:12px;background:var(--card);padding:16px}

  /* Funnel */
  .stage{display:grid;grid-template-columns:230px 1fr 62px;gap:14px;align-items:center;padding:7px 0}
  .stage .label{color:var(--fg)}
  .bar{height:24px;background:var(--accent);border-radius:5px;min-width:3px}
  .count{text-align:right;font-variant-numeric:tabular-nums;font-weight:700;font-size:16px}
  .lost{grid-column:1/-1;color:var(--warn);font-size:12px;padding:1px 0 5px 230px}
  .note{color:var(--muted);font-size:12px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)}

  /* Users */
  .toolbar{display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
  input[type=search]{font:inherit;padding:7px 11px;border:1px solid var(--border);border-radius:8px;
                     background:var(--bg);color:var(--fg);min-width:230px}
  .scroll{overflow-x:auto;border:1px solid var(--border);border-radius:12px}
  table{border-collapse:collapse;width:100%;font-size:13px;white-space:nowrap}
  th,td{padding:8px 11px;text-align:left;border-bottom:1px solid var(--border)}
  th{position:sticky;top:0;background:var(--card);cursor:pointer;user-select:none;
     font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  th:hover{color:var(--fg)}
  tr:last-child td{border-bottom:0}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  .pill{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;border:1px solid var(--border)}
  .on{color:var(--good);border-color:currentColor}
  .off{color:var(--muted);opacity:.55}
  .quiet-hot{color:var(--good)} .quiet-warm{color:var(--warn)} .quiet-cold{color:var(--muted)}
  .never{color:var(--muted);font-style:italic}
  #err{color:var(--warn);margin:16px 0}
  #auth{display:none;margin:16px 0}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>Axiom · Admin</h1>
      <div class="sub" id="stamp">loading…</div>
    </div>
    <button onclick="load()">Refresh</button>
  </header>

  <div id="err"></div>
  <div id="auth" class="card">
    <div style="margin-bottom:8px">Not authenticated. Paste an admin JWT:</div>
    <input type="search" id="tok" placeholder="eyJhbGciOi..." style="min-width:330px">
    <button onclick="saveTok()">Save</button>
  </div>

  <h2>Lifecycle</h2>
  <div class="card" id="funnel"></div>

  <h2>Users</h2>
  <div class="toolbar">
    <input type="search" id="q" placeholder="Filter by email, username, name…" oninput="renderUsers()">
    <label><input type="checkbox" id="onlyActive" onchange="renderUsers()"> only ever-active</label>
    <span class="sub" id="ucount"></span>
  </div>
  <div class="scroll"><table id="users">
    <thead><tr></tr></thead><tbody></tbody>
  </table></div>
</div>

<script>
const COLS = [
  { k:'email',           t:'User',      fmt:u => u.username ? u.username+' · '+(u.email||'') : (u.email||u.name||u.id.slice(0,8)) },
  { k:'signedUp',        t:'Signed up' },
  { k:'tier',            t:'Tier',      fmt:u => u.tier==='free' ? '<span class="off">free</span>' : '<span class="pill on">'+u.tier+'</span>' },
  { k:'hasProgram',      t:'Program',   fmt:u => flag(u.hasProgram), num:true },
  { k:'usedChat',        t:'Chat',      fmt:u => flag(u.usedChat),   num:true },
  { k:'meals',           t:'Meals',     num:true },
  { k:'workouts',        t:'Workouts',  num:true },
  { k:'wellness',        t:'Wellness',  num:true },
  { k:'activeDays',      t:'Active days', num:true },
  { k:'lastActionType',  t:'Last action', fmt:u => u.lastActionType || '<span class="never">never</span>' },
  { k:'daysQuiet',       t:'Days quiet', num:true, fmt:quiet },
];
let USERS = [], sortKey = 'daysQuiet', sortDir = 1;

const flag = v => v ? '<span class="pill on">yes</span>' : '<span class="off">—</span>';
function quiet(u){
  if (u.daysQuiet === null) return '<span class="never">never active</span>';
  const c = u.daysQuiet <= 7 ? 'quiet-hot' : u.daysQuiet <= 30 ? 'quiet-warm' : 'quiet-cold';
  return '<span class="'+c+'">'+u.daysQuiet+'d</span>';
}
const tok = () => localStorage.getItem('axiom_admin_tok');
function saveTok(){ localStorage.setItem('axiom_admin_tok', document.getElementById('tok').value.trim()); load(); }

async function api(path){
  const h = {};
  if (tok()) h.Authorization = 'Bearer ' + tok();
  const r = await fetch(path, { headers:h, credentials:'include' });
  if (r.status === 401 || r.status === 403) { document.getElementById('auth').style.display='block'; throw new Error('Not authorised — paste an admin token above.'); }
  if (!r.ok) throw new Error(path + ' → ' + r.status);
  return r.json();
}

function renderFunnel(d){
  const max = Math.max(...d.stages.map(s => s.count), 1);
  let h = '';
  d.stages.forEach((s, i) => {
    if (i > 0) {
      const lost = d.stages[i-1].count - s.count;
      if (lost > 0) h += '<div class="lost">↓ lost '+lost+'</div>';
    }
    h += '<div class="stage"><div class="label">'+s.label+'</div>'
       + '<div><div class="bar" style="width:'+Math.max((s.count/max)*100,0.4)+'%"></div></div>'
       + '<div class="count">'+s.count+'</div></div>';
  });
  const o = d.offPath || {};
  h += '<div class="note">';
  if (d.biggestDropOff) h += '<b>Biggest drop:</b> '+d.biggestDropOff.from+' → '+d.biggestDropOff.to+' ('+d.biggestDropOff.lost+' people).<br>';
  h += 'Stages are a strictly nested cohort, so each “lost” figure is real people. '
     + 'Off-path: <b>'+(o.loggedWithoutProgram||0)+'</b> logged without ever having a program'
     + (o.programWithoutIntakeFlag ? ', <b>'+o.programWithoutIntakeFlag+'</b> have a program but no intake flag (legacy rows)' : '')
     + '.<br>Ever used coach chat: <b>'+(d.side?.usedCoachChat ?? '?')+'</b> · Paying: <b>'+(d.side?.payingUsers ?? '?')+'</b>';
  h += '</div>';
  document.getElementById('funnel').innerHTML = h;
}

function renderUsers(){
  const q = document.getElementById('q').value.toLowerCase();
  const onlyActive = document.getElementById('onlyActive').checked;
  let rows = USERS.filter(u =>
    (!onlyActive || u.lastActivityDay !== null) &&
    (!q || [u.email,u.username,u.name].filter(Boolean).join(' ').toLowerCase().includes(q))
  );
  rows.sort((a,b) => {
    let x = a[sortKey], y = b[sortKey];
    // Never-active users sort last regardless of direction — they are a
    // separate condition, not "infinitely quiet".
    if (sortKey === 'daysQuiet') { if (x === null) return 1; if (y === null) return -1; }
    if (x === null) x = ''; if (y === null) y = '';
    return (typeof x === 'number' && typeof y === 'number') ? (x-y)*sortDir : String(x).localeCompare(String(y))*sortDir;
  });
  document.querySelector('#users thead tr').innerHTML =
    COLS.map(c => '<th onclick="sortBy(\''+c.k+'\')">'+c.t+(sortKey===c.k ? (sortDir>0?' ▲':' ▼') : '')+'</th>').join('');
  document.querySelector('#users tbody').innerHTML = rows.map(u =>
    '<tr>' + COLS.map(c =>
      '<td'+(c.num?' class="num"':'')+'>'+(c.fmt ? c.fmt(u) : (u[c.k] ?? ''))+'</td>'
    ).join('') + '</tr>').join('');
  document.getElementById('ucount').textContent =
    rows.length + ' of ' + USERS.length + ' shown · ' + USERS.filter(u=>u.lastActivityDay===null).length + ' never active';
}
function sortBy(k){ sortDir = (sortKey === k) ? -sortDir : 1; sortKey = k; renderUsers(); }

async function load(){
  document.getElementById('err').textContent = '';
  try {
    const [f, u] = await Promise.all([api('/api/admin/funnel'), api('/api/admin/users')]);
    renderFunnel(f);
    USERS = u.users; renderUsers();
    document.getElementById('auth').style.display = 'none';
    document.getElementById('stamp').textContent = 'generated ' + new Date(f.generatedAt).toLocaleString();
  } catch (e) {
    document.getElementById('err').textContent = e.message;
    document.getElementById('stamp').textContent = '';
  }
}
load();
</script>
</body>
</html>`;
