const $ = (s)=>document.querySelector(s);
const $$ = (s)=>document.querySelectorAll(s);

const state = {
room: 'general',
profile: null,
sub: null,
profilesCache: new Map(),
selected: new Set(), // sélection dans l’annuaire (pour futur groupes/MP)
};

function setAuthNav(isLogged){
$('#nav-auth').classList.toggle('hidden', !!isLogged);
$('#nav-inapp').classList.toggle('hidden', !isLogged);
}
function toast(el, msg, ok=true){ el.textContent=msg; el.className='form-msg ' + (ok?'ok':'err'); }
function showApp(show){
$('#app').classList.toggle('hidden', !show);
document.querySelector('.hero')?.classList.toggle('hidden', show);
setAuthNav(show);
}

/* -------------------- PROFILES -------------------- */
async function fetchProfileByUserId(uid){
if(state.profilesCache.has(uid)) return state.profilesCache.get(uid);
const { data, error } = await supabase.from('profiles')
.select('first_name,last_name,class_label').eq('user_id', uid).single();
if(!error && data){ state.profilesCache.set(uid, data); return data; }
return { first_name:'?', last_name:'', class_label:'' };
}
async function fetchMyProfile(uid){
const { data, error } = await supabase.from('profiles').select('*').eq('user_id', uid).single();
if(error && error.code!=='PGRST116') throw error;
return data||null;
}
async function upsertMyProfile(uid, {first_name,last_name,class_label}){
const { error } = await supabase.from('profiles').upsert({ user_id:uid, first_name,last_name,class_label });
if(error) throw error;
}
function paintMeCard(){
if(!state.profile) return;
$('#me-name').textContent = `${state.profile.first_name} ${state.profile.last_name}`;
$('#me-class').textContent = state.profile.class_label;
$('#me-avatar').style.backgroundImage = state.profile.avatar_url ? `url(${state.profile.avatar_url})` : '';
}

/* -------------------- SIGNUP / LOGIN -------------------- */
async function signUpFlow(){
const modal = $('#modal-signup'); modal.showModal();
$('#su-msg').textContent = '';
$('#su-toggle').onclick = ()=>{ const i=$('#su-password'); i.type = i.type==='password'?'text':'password'; };
modal.querySelectorAll('.close-modal').forEach(b=> b.onclick = ()=> modal.close());

$('#su-submit').onclick = async (e)=>{
e.preventDefault();
if(!$('#chk-consent').checked) return toast($('#su-msg'), "Vous devez accepter les conditions.", false);

const first = $('#su-first').value.trim();
const last = $('#su-last').value.trim();
const clazz = $('#su-class').value.trim();
const email = $('#su-email').value.trim().toLowerCase();
const pwd = $('#su-password').value;
if(!first||!last||!clazz||!email||!pwd) return toast($('#su-msg'), "Champs manquants.", false);

const { error } = await supabase.auth.signUp({
email, password: pwd,
options: { emailRedirectTo: "https://lckoff.github.io/campuschat/" }
});
if(error) return toast($('#su-msg'), error.message, false);

// preuve facultative
const proof = $('#su-proof').files[0];
localStorage.setItem('pendingProfile', JSON.stringify({ first, last, clazz, hasProof: !!proof }));
localStorage.setItem('pendingProofName', proof ? proof.name : '');

toast($('#su-msg'), "Compte créé. Vérifiez votre e-mail puis connectez-vous.", true);
setTimeout(()=>modal.close(), 1500);
};
}

async function loginFlow(){
const modal = $('#modal-login'); modal.showModal();
$('#li-msg').textContent='';
$('#li-toggle').onclick = ()=>{ const i=$('#li-password'); i.type = i.type==='password'?'text':'password'; };
modal.querySelectorAll('.close-modal').forEach(b=> b.onclick = ()=> modal.close());

$('#li-submit').onclick = async (e)=>{
e.preventDefault();
const email = $('#li-email').value.trim().toLowerCase();
const pwd = $('#li-password').value;
const { error } = await supabase.auth.signInWithPassword({ email, password: pwd });
if(error) return toast($('#li-msg'), error.message, false);
modal.close();
};
}

/* -------------------- PROOF (facultatif) -------------------- */
async function uploadProof(userId, file){
const ext = (file.name.split('.').pop()||'jpg').toLowerCase();
const path = `${userId}/${Date.now()}.${ext}`;
const { error: upErr } = await supabase.storage.from('proofs').upload(path, file, { cacheControl:'3600', upsert:false });
if(upErr) throw upErr;
const deleteAfter = new Date(Date.now()+72*3600*1000).toISOString();
const { error: dbErr } = await supabase.from('proof_uploads').insert({ user_id:userId, file_path:path, delete_after:deleteAfter });
if(dbErr) throw dbErr;
}

/* -------------------- UI BINDINGS -------------------- */
function bindUI(){
$('#btn-signup')?.addEventListener('click', signUpFlow);
$('#hero-signup')?.addEventListener('click', signUpFlow);
$('#btn-login')?.addEventListener('click', loginFlow);
$('#hero-login')?.addEventListener('click', loginFlow);
$('#btn-logout')?.addEventListener('click', async ()=>{ await supabase.auth.signOut(); });

$('#btn-upload-proof')?.addEventListener('click', ()=>{
const m=$('#modal-proof'); m.showModal(); $('#pf-msg').textContent='';
m.querySelectorAll('.close-modal').forEach(b=> b.onclick = ()=> m.close());
$('#pf-submit').onclick = async (e)=>{
e.preventDefault();
const f=$('#pf-file').files[0];
if(!f) return toast($('#pf-msg'), "Choisissez une image.", false);
const { data:{ user } } = await supabase.auth.getUser(); if(!user) return toast($('#pf-msg'), "Non connecté.", false);
try{ await uploadProof(user.id,f); toast($('#pf-msg'), "Preuve envoyée (suppression auto).", true); setTimeout(()=>m.close(),1000);}
catch(err){ toast($('#pf-msg'), "Erreur: "+err.message, false); }
};
});

// Rooms
$$('.room').forEach(el=>{
el.onclick = ()=>{
$$('.room').forEach(r=>r.classList.remove('active'));
el.classList.add('active');
state.room = el.dataset.room;
$('#room-title').textContent = '# ' + (state.room === 'general' ? 'général' : state.room);
$('#messages').innerHTML = '';
subscribeMessages();
loadRecentMessages();
};
});

// Composer
$('#composer').onsubmit = async (e)=>{
e.preventDefault();
const body = $('#msg-input').value.trim();
if(!body) return;
const { data:{ user } } = await supabase.auth.getUser();
if(!user) return;

// envoi optimiste
const optimistic = { user_id:user.id, body, created_at:new Date().toISOString() };
addMessage(optimistic, true);

$('#msg-input').value='';
const { error } = await supabase.from('messages').insert({ room: state.room, user_id: user.id, body });
if(error){ console.error(error); }
};

// Annuaire
$('#btn-directory')?.addEventListener('click', openDirectory);
}

/* -------------------- REALTIME -------------------- */
let msgSub;
function subscribeMessages(){
if(msgSub){ supabase.removeChannel(msgSub); msgSub=null; }
msgSub = supabase
.channel('room_'+state.room)
.on('postgres_changes', { event:'INSERT', schema:'public', table:'messages', filter:`room=eq.${state.room}` },
async (payload)=> addMessage(payload.new, true)
)
.subscribe();
}

async function loadRecentMessages(){
const { data, error } = await supabase
.from('messages').select('*')
.eq('room', state.room)
.order('created_at',{ ascending:true })
.limit(200);
if(error) return;
$('#messages').innerHTML='';
for(const m of data){ addMessage(m,false); }
const list=$('#messages'); list.scrollTop = list.scrollHeight;
}

async function addMessage(m, realtime){
const li=document.createElement('li');
li.dataset.uid = m.user_id;
li.title = new Date(m.created_at).toLocaleString();

const p = await fetchProfileByUserId(m.user_id);
const who = `${p.first_name} ${p.last_name}`.trim();

if(state.sub && m.user_id===state.sub) li.classList.add('me');
li.innerHTML = `<strong style="display:block;font-size:.85rem;opacity:.85">${who} <span style="opacity:.6;font-weight:400">(${p.class_label||''})</span></strong>${escapeHtml(m.body)}`;
$('#messages').appendChild(li);
if(realtime){
li.style.animation='fadeIn .25s ease';
const list=$('#messages'); list.scrollTop=list.scrollHeight;
}
}
function escapeHtml(s){ return s.replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c])); }

/* -------------------- FINALISATION PROFIL -------------------- */
async function finalizeProfileIfNeeded(user){
const pending = localStorage.getItem('pendingProfile');
if(!pending) return;
const exists = await fetchMyProfile(user.id);
if(exists){ localStorage.removeItem('pendingProfile'); localStorage.removeItem('pendingProofName'); return; }
const { first, last, clazz, hasProof } = JSON.parse(pending);
try{
await upsertMyProfile(user.id, { first_name:first, last_name:last, class_label:clazz });
// si une preuve avait été choisie au sign-up, on demande le fichier à nouveau (sécurité navigateur)
if(hasProof){
const m=$('#modal-proof'); m.showModal(); $('#pf-msg').textContent='';
$('#pf-file').value = ''; // reset
}
} finally {
localStorage.removeItem('pendingProfile');
localStorage.removeItem('pendingProofName');
}
}

/* -------------------- ANNULAIRE -------------------- */
let dirAbort;
async function openDirectory(){
const d = $('#modal-directory'); d.showModal();
d.querySelectorAll('.close-modal').forEach(b=> b.onclick = ()=> d.close());
state.selected.clear();
$('#dir-create').disabled = true;

async function queryDirectory(q){
if(dirAbort) dirAbort.abort();
dirAbort = new AbortController();
const like = q ? `%${q}%` : null;

let req = supabase.from('profiles')
.select('user_id, first_name, last_name, class_label')
.order('last_name', { ascending:true })
.limit(400);

if(like){
req = req.or(`first_name.ilike.${like},last_name.ilike.${like},class_label.ilike.${like}`);
}
const { data, error } = await req;
if(error) { console.error(error); return []; }
return data || [];
}

function renderDirectory(rows){
const ul = $('#dir-list'); ul.innerHTML='';
rows.forEach(r=>{
const li = document.createElement('li');
li.innerHTML = `
<input type="checkbox" class="dir-check">
<div class="dir-avatar"></div>
<div class="dir-meta">
<div class="dir-name">${escapeHtml(r.first_name)} ${escapeHtml(r.last_name)}</div>
<div class="dir-class">${escapeHtml(r.class_label||'')}</div>
</div>`;
const chk = li.querySelector('.dir-check');
chk.onchange = ()=>{
if(chk.checked) state.selected.add(r.user_id); else state.selected.delete(r.user_id);
$('#dir-create').disabled = state.selected.size===0;
};
ul.appendChild(li);
});
}

// première charge
renderDirectory(await queryDirectory(''));

// recherche
const input = $('#dir-q');
let t;
input.oninput = ()=>{
clearTimeout(t);
t = setTimeout(async ()=>{ renderDirectory(await queryDirectory(input.value.trim())); }, 200);
};
}

/* -------------------- SESSION PERSISTANTE -------------------- */
async function bootstrapSession(){
const { data:{ session } } = await supabase.auth.getSession();
if(session?.user){
state.sub = session.user.id;
await finalizeProfileIfNeeded(session.user);
state.profile = await fetchMyProfile(session.user.id);
paintMeCard(); showApp(true); subscribeMessages(); loadRecentMessages();
} else {
showApp(false);
}

supabase.auth.onAuthStateChange(async (_evt, session2)=>{
const user = session2?.user || null;
if(!user){ showApp(false); return; }
state.sub = user.id;
await finalizeProfileIfNeeded(user);
state.profile = await fetchMyProfile(user.id);
paintMeCard(); showApp(true); subscribeMessages(); loadRecentMessages();
});
}

/* -------------------- INIT -------------------- */
document.addEventListener('DOMContentLoaded', ()=>{
bindUI();
bootstrapSession();
});
