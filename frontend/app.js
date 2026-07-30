const API = '/api/tasks';
const ICO_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const ICO_TRASH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;

let tasks = [];
let filterText = '';

const $list = document.getElementById('list');
const $addForm = document.getElementById('addForm');
const $titleInput = document.getElementById('titleInput');
const $filterInput = document.getElementById('filterInput');
const $filterCount = document.getElementById('filterCount');
const $statQueued = document.getElementById('statQueued');
const $statDone = document.getElementById('statDone');
const $statTotal = document.getElementById('statTotal');
const $apiEyebrow = document.getElementById('apiEyebrow');
const $apiStatus = document.getElementById('apiStatus');
const $lastSync = document.getElementById('lastSync');

function fmtTime(iso){
  const d = new Date(iso);
  return d.toLocaleString('es-EC', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}
function taskCode(id){ return 'TSK-' + String(id).padStart(4, '0'); }

function toast(msg, isErr=false){
  const wrap = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  // Se construye con nodos y textContent (nunca innerHTML) para que ningún
  // mensaje pueda inyectar HTML en el DOM.
  const icon = document.createElement('i');
  const text = document.createElement('span');
  text.textContent = msg;
  el.append(icon, text);
  wrap.appendChild(el);
  setTimeout(() => { el.classList.add('fade-out'); setTimeout(() => el.remove(), 200); }, 2800);
}

function render(){
  const q = filterText.trim().toLowerCase();
  const visible = q ? tasks.filter(t => t.title.toLowerCase().includes(q)) : tasks;

  $statQueued.textContent = tasks.filter(t => !t.completed).length;
  $statDone.textContent = tasks.filter(t => t.completed).length;
  $statTotal.textContent = tasks.length;
  $filterCount.textContent = q ? `${visible.length} / ${tasks.length}` : '';

  if (!visible.length){
    // El texto del filtro es entrada del usuario: se escapa siempre antes de
    // insertarlo en el DOM (evita XSS reflejado del tipo <img src=x onerror=…>).
    $list.innerHTML = `<div class="empty">
      <b>${q ? 'Sin coincidencias' : 'No hay tareas todavía'}</b>
      <span>${q ? 'Nada coincide con "' + escapeHtml(q) + '".' : 'Agrega una tarea con el campo de arriba.'}</span>
    </div>`;
    return;
  }

  // Los identificadores se fuerzan a número y los títulos se escapan.
  // Los eventos se enlazan por delegación (ver más abajo), sin atributos
  // onclick en el HTML, para poder aplicar una CSP sin 'unsafe-inline'.
  $list.innerHTML = visible.map(t => {
    const id = Number(t.id);
    return `
    <div class="row ${t.completed ? 'done' : ''}" data-id="${id}">
      <div class="toggle" data-action="toggle" role="button" tabindex="0" aria-label="Cambiar estado">${ICO_CHECK}</div>
      <div class="row-main">
        <div class="title">${escapeHtml(t.title)}</div>
        <div class="meta"><span>${taskCode(id)}</span><span>${fmtTime(t.created_at)}</span></div>
      </div>
      <div class="del" data-action="delete" role="button" tabindex="0" aria-label="Eliminar tarea">${ICO_TRASH}</div>
    </div>
  `;
  }).join('');
}

function escapeHtml(s){
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function loadTasks(){
  try {
    const res = await fetch(API);
    if (!res.ok) throw new Error('respuesta no ok');
    tasks = await res.json();
    setApiStatus(true);
    $lastSync.textContent = 'última sync: ' + new Date().toLocaleTimeString('es-EC');
    render();
  } catch (err) {
    setApiStatus(false);
    console.error(err);
  }
}

function setApiStatus(ok){
  $apiEyebrow.classList.toggle('off', !ok);
  $apiStatus.textContent = ok ? 'API conectada · PostgreSQL' : 'sin conexión con la API';
}

async function addTask(title){
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    if (!res.ok) throw new Error();
    const created = await res.json();
    tasks.unshift(created);
    render();
    toast('Tarea agregada');
  } catch (err) {
    toast('No se pudo crear la tarea', true);
  }
}

async function toggleTask(id){
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  const next = !t.completed;
  t.completed = next; // optimista
  render();
  try {
    const res = await fetch(`${API}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: next })
    });
    if (!res.ok) throw new Error();
  } catch (err) {
    t.completed = !next; // revertir
    render();
    toast('No se pudo actualizar la tarea', true);
  }
}

async function deleteTask(id){
  const prev = tasks;
  tasks = tasks.filter(x => x.id !== id);
  render();
  try {
    const res = await fetch(`${API}/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error();
    toast('Tarea eliminada');
  } catch (err) {
    tasks = prev;
    render();
    toast('No se pudo eliminar la tarea', true);
  }
}

// Delegación de eventos: un único listener en la lista, en lugar de atributos
// onclick inline (que la Content-Security-Policy bloquea).
$list.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = Number(btn.closest('.row')?.dataset.id);
  if (!Number.isInteger(id)) return;
  if (btn.dataset.action === 'toggle') toggleTask(id);
  if (btn.dataset.action === 'delete') deleteTask(id);
});

$list.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  e.preventDefault();
  btn.click();
});

$addForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const title = $titleInput.value.trim();
  if (!title) return;
  addTask(title);
  $titleInput.value = '';
});

$filterInput.addEventListener('input', (e) => {
  filterText = e.target.value;
  render();
});

loadTasks();
setInterval(loadTasks, 15000);
