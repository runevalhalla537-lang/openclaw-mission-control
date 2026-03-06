async function getJSON(path){ const r=await fetch(path); return await r.json(); }
async function postJSON(path, body){ const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); return await r.json(); }
const byId=(id)=>document.getElementById(id);
const nowStr=()=>new Date().toLocaleTimeString();

let agentsCache = [];
let sessionsCache = [];
let cronCache = [];

const AGENT_META = {
  main: { display: 'Rune', role: 'Primary assistant + orchestration' },
  forge: { display: 'Forge', role: 'Heavy coding and implementation' },
  sentinel: { display: 'Sentinel', role: 'Analysis, audits, and planning' },
  swift: { display: 'Swift', role: 'Fast lightweight tasks and triage' },
  seer: { display: 'Seer', role: 'Vision + context interpretation' },
  'ops-local': { display: 'Helios', role: 'Local ops and maintenance workflows' },
  'edge-fast': { display: 'Eos', role: 'Low-latency edge execution' }
};

function healthBadge(ok){ return `<span class="badge ${ok?'ok':'err'}">${ok?'OK':'Issue'}</span>`; }
function esc(s){ return String(s ?? '').replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[m])); }

function renderHealth(h){
  const ok = !h?.health?.error;
  byId('healthSummary').innerHTML = `<div>OpenClaw Health: ${healthBadge(ok)}</div>`;
}

function stateBadge(state){
  const s = String(state || 'Offline');
  const cls = s.startsWith('Warm') ? 'warm' : s.startsWith('Cold') ? 'cold' : s.startsWith('Online') ? 'online' : 'offline';
  const dot = cls === 'warm' || cls === 'online' ? 'green' : 'red';
  return `<span class="dashline"><span class="dot ${dot}"></span><span class="badge state ${cls}">${esc(s)}</span></span>`;
}

function pctBar(v){
  if(v === null || v === undefined || Number.isNaN(Number(v))) return '<small class="dim">n/a</small>';
  const p = Math.max(0, Math.min(100, Number(v)));
  return `<div>${p.toFixed(1)}%</div><div class="bar"><span style="width:${p}%"></span></div>`;
}

function renderRuntime(rt){
  const models = Array.isArray(rt?.agentModels) ? rt.agentModels : [];
  byId('runtimeModels').innerHTML = models.length
    ? `<div class="runtime-list">${models.map(m=>`<div class="runtime-row"><div><strong>${esc(AGENT_META[m.agentId]?.display || m.agentId)}</strong> <small class="dim">(${esc(m.location)})</small><br/><small class="dim">${esc(m.model)}</small></div><div>${stateBadge(m.state)}</div></div>`).join('')}</div>`
    : '<div class="muted">No model runtime data.</div>';

  const jet = rt?.jetson || {};
  const spark = rt?.spark || {};
  byId('runtimeStats').innerHTML = `
    <div><strong>Jetson</strong></div>
    <div class="runtime-row"><div>CPU</div><div style="min-width:180px">${pctBar(jet.cpuPercent)}</div></div>
    <div class="runtime-row"><div>Memory</div><div style="min-width:180px">${pctBar(jet.memPercent)}</div></div>
    <div class="runtime-row"><div>GPU</div><div style="min-width:180px">${pctBar(jet.gpuPercent)}</div></div>
    <div style="margin-top:8px"><strong>Spark</strong> ${spark.online ? '<span class="badge online">Online</span>' : '<span class="badge offline">Offline</span>'}</div>
    <div class="runtime-row"><div>Warm models</div><div>${Array.isArray(spark.loadedModels)? spark.loadedModels.length : 0}</div></div>
    <div class="runtime-row"><div>CPU</div><div style="min-width:180px">${pctBar(spark.cpuPercent)}</div></div>
    <div class="runtime-row"><div>Memory</div><div style="min-width:180px">${pctBar(spark.memPercent)}</div></div>
    <div class="runtime-row"><div>GPU</div><div style="min-width:180px">${pctBar(spark.gpuPercent)}</div></div>
    <div><small class="dim">metrics: ${esc(spark.metricsSource || 'not connected')}</small></div>
  `;
}

function toMs(v){
  if(v === null || v === undefined) return 0;
  if(typeof v === 'number') return v > 1e12 ? v : v * 1000;
  const n = Date.parse(v);
  return Number.isNaN(n) ? 0 : n;
}

function taskFromSession(s){
  const candidates = [
    s?.title,
    s?.task,
    s?.summary,
    s?.lastMessage?.text,
    s?.lastMessage?.content,
    s?.last?.text,
  ].filter(Boolean);
  const t = String(candidates[0] || '').replace(/\s+/g,' ').trim();
  if (t) return t.slice(0, 90);

  const agent = s?.agentId || s?.agent;
  const cron = cronCache.find(j => (j.agentId || 'main') === agent && j.enabled);
  if (cron?.name) return `Scheduled: ${cron.name}`;

  return 'Active session';
}

function buildActivityByAgent(){
  const map = {};
  for (const s of sessionsCache){
    const id = s.agentId || s.agent;
    if(!id) continue;
    const ms = toMs(s.updatedAt || s.updated || s.lastActivityAt);
    const ageMs = typeof s.ageMs === 'number' ? s.ageMs : (ms ? (Date.now() - ms) : Number.MAX_SAFE_INTEGER);
    if(!map[id] || ms > map[id].updatedMs){
      map[id] = { updatedMs: ms, ageMs, task: taskFromSession(s) };
    }
  }
  return map;
}

function renderAgents(a){
  const arr = Array.isArray(a) ? a : (Array.isArray(a?.agents) ? a.agents : []);
  agentsCache = arr.map(x => x.id || x.agentId).filter(Boolean);
  const activity = buildActivityByAgent();
  byId('agentsCount').textContent = `${arr.length} agents detected`;
  const ordered = [...arr].sort((a,b)=>{
    const ia = (a.id || a.agentId || '') === 'main' ? 0 : 1;
    const ib = (b.id || b.agentId || '') === 'main' ? 0 : 1;
    return ia - ib;
  });

  byId('agentsCards').innerHTML = ordered.map(x=>{
    const id = x.id || x.agentId || 'unknown';
    const meta = AGENT_META[id] || {};
    const name = meta.display || x.identity?.name || id;
    const role = meta.role || 'General purpose';
    const model = x.model?.primary || x.model || 'n/a';
    const ainfo = activity[id];
    const working = !!ainfo && (ainfo.ageMs < (10 * 60 * 1000));
    const statusLine = working
      ? `<div class="agent-status"><span class="dot green"></span><span class="muted">Working: ${esc(ainfo.task)}</span></div>`
      : `<div class="agent-status"><span class="dot red"></span><span class="muted">Idle</span></div>`;
    const cardClass = id === 'main' ? 'card main-card' : 'card';
    return `<div class="${cardClass}"><div><strong>${esc(name)}</strong></div><div class="muted">${esc(id)}</div><div class="muted">${esc(role)}</div>${statusLine}<div class="muted">${esc(model)}</div></div>`;
  }).join('') || '<div class="muted">No agents returned.</div>';
}

function renderSessions(s){
  const arr = Array.isArray(s) ? s : (Array.isArray(s?.sessions) ? s.sessions : []);
  sessionsCache = arr;
  byId('sessionsCount').textContent = `${arr.length} sessions`;
  const rows = arr.slice(0,20).map(x=>`<tr><td>${esc(x.agentId||x.agent||'-')}</td><td>${esc(x.id||x.sessionId||'-')}</td><td>${esc(x.updatedAt||x.updated||'-')}</td></tr>`).join('');
  byId('sessionsTable').innerHTML = rows ? `<table><thead><tr><th>Agent</th><th>Session</th><th>Updated</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="muted">No active sessions in window.</div>';
}

function cronAgentSelect(job){
  const current = job.agentId || 'main';
  const opts = ['main', ...agentsCache.filter(a=>a!=='main')]
    .map(a => `<option value="${esc(a)}" ${a===current?'selected':''}>${esc(a)}</option>`).join('');
  return `<select data-role="agent" data-id="${esc(job.id)}">${opts}</select>`;
}

function renderCron(c){
  const jobs = Array.isArray(c?.jobs) ? c.jobs : [];
  cronCache = jobs;
  byId('cronCount').textContent = `${jobs.length} cron jobs`;
  const rows = jobs.map(j=>{
    const enabled = !!j.enabled;
    const sched = j.schedule?.expr ? `${j.schedule.expr} (${j.schedule?.tz||'UTC'})` : 'n/a';
    return `<tr>
      <td>${esc(j.name||j.id)}</td>
      <td>${enabled?'<span class="badge ok">enabled</span>':'<span class="badge warn">disabled</span>'}</td>
      <td>${esc(sched)}</td>
      <td>${cronAgentSelect(j)}</td>
      <td>
        <button data-action="switch" data-id="${esc(j.id)}">Switch</button>
        <button data-action="toggle" data-id="${esc(j.id)}" data-enabled="${enabled?1:0}">${enabled?'Disable':'Enable'}</button>
      </td>
    </tr>`;
  }).join('');
  byId('cronTable').innerHTML = rows ? `<table><thead><tr><th>Name</th><th>Status</th><th>Schedule</th><th>Agent</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="muted">No cron jobs found.</div>';
}

function renderSubagents(_s){
  const activity = buildActivityByAgent();
  const subagents = agentsCache.filter(a => a && a !== 'main');
  if (!subagents.length) {
    byId('subagents').textContent = 'No sub-agents configured.';
    return;
  }
  const lines = subagents.map(id => {
    const name = AGENT_META[id]?.display || id;
    const ainfo = activity[id];
    const working = !!ainfo && (ainfo.ageMs < (10 * 60 * 1000));
    if (working) {
      return `<div class="muted"><span class="dot green"></span><strong>${esc(name)}</strong> — Working: ${esc(ainfo.task)}</div>`;
    }
    return `<div class="muted"><span class="dot red"></span><strong>${esc(name)}</strong> — Idle</div>`;
  });
  byId('subagents').innerHTML = lines.join('');
}

async function handleCronAction(e){
  const btn = e.target.closest('button[data-action]');
  if(!btn) return;
  const id = btn.dataset.id;
  if(btn.dataset.action === 'switch'){
    const sel = document.querySelector(`select[data-role="agent"][data-id="${CSS.escape(id)}"]`);
    const agent = sel?.value || 'main';
    btn.disabled = true;
    const res = await postJSON('/api/cron/switch-agent', {id, agent});
    btn.disabled = false;
    if(res?.ok===false || res?.error) alert(`Switch failed: ${res.error||'unknown'}`);
    await refresh();
  }
  if(btn.dataset.action === 'toggle'){
    const enabledNow = btn.dataset.enabled === '1';
    btn.disabled = true;
    const res = await postJSON('/api/cron/toggle', {id, enabled: !enabledNow});
    btn.disabled = false;
    if(res?.ok===false || res?.error) alert(`Toggle failed: ${res.error||'unknown'}`);
    await refresh();
  }
}

let inFlight = false;
let lastSlowAt = 0;
let timers = [];

function clearTimers(){ timers.forEach(clearInterval); timers=[]; }

async function refreshFast(){
  const d = await getJSON('/api/fast');
  renderHealth(d.health); renderRuntime(d.runtime);
}

async function refreshSlow(){
  const d = await getJSON('/api/slow');
  renderSessions(d.sessions); renderAgents(d.agents); renderCron(d.cron); renderSubagents(d.subagents);
  lastSlowAt = Date.now();
}

async function refresh(forceSlow=false){
  if(inFlight) return;
  inFlight = true;
  byId('last').textContent = 'Loading…';
  try{
    await refreshFast();
    const sec = Number(byId('agentsInterval').value || '30');
    const due = sec > 0 ? (Date.now() - lastSlowAt) >= sec*1000 : forceSlow;
    if (due || forceSlow) await refreshSlow();
    byId('last').textContent = `Updated ${nowStr()}`;
  }catch(e){
    byId('last').textContent = `Error: ${e}`;
  } finally { inFlight = false; }
}

function applyMode(){
  clearTimers();
  const mode = byId('modeSelect').value;
  if(mode === 'live'){
    timers.push(setInterval(()=>refresh(false), 5000));
  } else {
    timers.push(setInterval(()=>refresh(false), 15000));
  }
}

byId('refresh').addEventListener('click', ()=>refresh(true));
byId('cronTable').addEventListener('click', handleCronAction);
byId('modeSelect').addEventListener('change', applyMode);
byId('agentsInterval').addEventListener('change', ()=>refresh(true));
applyMode();
refresh(true);
