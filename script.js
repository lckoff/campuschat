const $ = (s)=>document.querySelector(s);
const $$ = (s)=>document.querySelectorAll(s);

const state = {
sub: null, // user id connecté
profile: null, // mon profil
profilesCache: new Map()
};

/* ======== helpers ======== */
function setAuthNav(connected){
$('#nav-auth').classList.toggle('hidden', connected);
$('#nav-inapp').classList.toggle('hidden', !connected);
}
function showApp(show){
$('#app').classList.toggle('hidden', !show);
document.querySelector('.hero')?.classList.toggle('hidden', show);
setAuthNav(show);
}
function toast(el, msg, ok=true){ el.textContent = msg; el.style.color = ok ? '#7af0b2' : '#ff8080'; }
function escapeHtml(s){ return s.replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c])); }

/* ======== profils ======== */
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
async function upsertMyProfile(uid, { first_name,last_name,class_label }){
const { error } = await supabase.from('profiles').upsert({ user_id:uid, first_name,last_name,class_label });
if(error) throw error;
}

/* ======== auth ======== */
async function signUpFlow(){
const dlg = $('#modal-signup'); dlg.showModal();
$('#su-msg').textContent='';
$('#su-toggle').onclick = ()=>{ const i=$('#su-password'); i.type = i.type==='password'?'text':'password'; };
dlg.querySelectorAll('.close-modal').forEach(b=> b.onclick = ()=> dlg.close());
$('#su-submit').onclick = async (e)=>{
e.preventDefault();
if(!$('#chk-consent').checked) return toast($('#su-msg'), "Vous devez accepter les conditions.", false);
const first=$('#su-first').value.trim(), last=$('#su-last').value.trim(),
clazz=$('#su-class').value.trim(), email=$('#su-email').value.trim().toLowerCase(),
pwd=$('#su-password').value;
if(!first||!last||!clazz||!email||!pwd) return toast($('#su-msg'), "Champs manquants.", false);

const { error } = await supabase.auth.signUp({
email, password: pwd,
options: { emailRedirectTo: "https://lckoff.github.io/campuschat/" }
});
if(error) return toast($('#su-msg'), error.message, false);

// on stocke pour créer le profil juste après la première connexion
localStorage.setItem('pendingProfile', JSON.stringify({ first,last,clazz }));
toast($('#su-msg'), "Compte créé. Vérifiez votre e-mail puis connectez-vous.", true);
setTimeout(()=>dlg.close(), 1200);
};
}
async function loginFlow(){
const dlg = $('#modal-login'); dlg.showModal();
$('#li-msg').textContent='';
$('#li-toggle').onclick = ()=>{ const i=$('#li-password'); i.type = i.type==='password'?'text':'password'; };
dlg.querySelectorAll('.close-modal').forEach(b=> b.onclick = ()=> dlg.close());
$('#li-submit').onclick = async (e)=>{
e.preventDefault();
const email=$('#li-email').value.trim().toLowerCase(), pwd=$('#li-password').value;
const { error } = await supabase.auth.signInWithPassword({ email, password: pwd });
if(error) return toast($('#li-msg'), error.message, false);
dlg.close();
};
}

/* ======== chat ======== */
let msgSub;
function subscribeMessages(){
if(msgSub){ supabase.removeChannel(msgSub); msgSub=null; }
msgSub = supabase
.channel('room_general')
.on('postgres_changes',{ event:'INSERT', schema:'public', table:'messages', filter:'room=eq.general' },
(p)=> addMessage(p.new, true)
).subscribe();
}
async function loadRecentMessages(){
const { data } = await supabase.from('messages')
.select('*').eq('room','general').order('created_at',{ascending:true}).limit(200);
$('#messages').innerHTML='';
(data||[]).forEach(m=>addMessage(m,false));
const list=$('#messages'); list.scrollTop=list.scrollHeight;
}
async function addMessage(m, realtime){
const li = document.createElement('li');
const p = await fetchProfileByUserId(m.user_id);
const who = `${p.first_name} ${p.last_name}`.trim();
if(m.user_id===state.sub) li.classList.add('me');
li.innerHTML = `<span class="msg-author" data-uid="${m.user_id}">${escapeHtml(who)}</span>
<div class="msg-body">${escapeHtml(m.body)}</div>`;
li.title = (p.class_label||'') + ' • ' + new Date(m.created_at).toLocaleString();
$('#messages').appendChild(li);
if(realtime){ const list=$('#messages'); list.scrollTop=list.scrollHeight; }
}

/* clic sur le nom → fiche profil */
$('#messages').addEventListener('click', async (e)=>{
const a = e.target.closest('.msg-author'); if(!a) return;
const uid = a.dataset.uid; const p = await fetchProfileByUserId(uid);
$('#pf-name').textContent = `${p.first_name} ${p.last_name}`.trim();
$('#pf-class').textContent = p.class_label || '';
$('#modal-profile').showModal();
});

/* envoi */
$('#composer').addEventListener('submit', async (e)=>{
e.preventDefault();
const body = $('#msg-input').value.trim(); if(!body) return;
const { data:{ user } } = await supabase.auth.getUser(); if(!user) return;
addMessage({ user_id:user.id, body, created_at:new Date().toISOString() }, true);
$('#msg-input').value='';
await supabase.from('messages').insert({ room:'general', user_id:user.id, body });
});

/* ======== annuaire ======== */
let dirTimer;
async function openDirectory(){
const dlg = $('#modal-directory'); dlg.showModal();
dlg.querySelectorAll('.close-modal').forEach(b=> b.onclick = ()=> dlg.close());

async function query(q){
const like = q ? `%${q}%` : null;
let req = supabase.from('profiles')
.select('first_name,last_name,class_label')
.order('last_name',{ascending:true})
.limit(500);
if(like) req = req.or(`first_name.ilike.${like},last_name.ilike.${like},class_label.ilike.${like}`);
const { data, error } = await req;
if(error){ console.error(error); return []; }
return data||[];
}
function render(rows){
const ul=$('#dir-list'); ul.innerHTML='';
if(rows.length===0){ ul.innerHTML = `<li style="opacity:.8;padding:.8rem">Aucun résultat</li>`; return; }
rows.forEach(r=>{
const li=document.createElement('li');
li.innerHTML = `
<div class="avatar" style="width:32px;height:32px"></div>
<div>
<div class="prof-name">${escapeHtml(r.first_name)} ${escapeHtml(r.last_name)}</div>
<div class="prof-class">${escapeHtml(r.class_label||'')}</div>
</div>`;
ul.appendChild(li);
});
}
render(await query(''));
$('#dir-q').oninput = (e)=>{
clearTimeout(dirTimer);
dirTimer = setTimeout(async ()=> render(await query(e.target.value.trim())), 180);
};
}

/* ======== bootstrap session ======== */
async function finalizeProfileIfNeeded(user){
const pending = localStorage.getItem('pendingProfile');
if(!pending) return;
const exists = await fetchMyProfile(user.id);
if(!exists){
const { first,last,clazz } = JSON.parse(pending);
await upsertMyProfile(user.id, { first_name:first, last_name:last, class_label:clazz });
}
localStorage.removeItem('pendingProfile');
}

function bindUI(){
$('#btn-signup')?.addEventListener('click', signUpFlow);
$('#hero-signup')?.addEventListener('click', signUpFlow);
$('#btn-login')?.addEventListener('click', loginFlow);
$('#hero-login')?.addEventListener('click', loginFlow);
$('#btn-logout')?.addEventListener('click', async ()=>{ await supabase.auth.signOut(); });

$('#btn-directory')?.addEventListener('click', openDirectory);
}

async function bootstrap(){
bindUI();
const { data:{ session } } = await supabase.auth.getSession();
if(session?.user){
state.sub = session.user.id;
await finalizeProfileIfNeeded(session.user);
state.profile = await fetchMyProfile(state.sub);
$('#me-name').textContent = `${state.profile?.first_name||''} ${state.profile?.last_name||''}`.trim();
$('#me-class').textContent = state.profile?.class_label || '';
showApp(true); subscribeMessages(); loadRecentMessages();
} else {
showApp(false);
}
supabase.auth.onAuthStateChange(async (_evt, s)=>{
const user = s?.user || null;
if(!user){ showApp(false); return; }
state.sub = user.id;
await finalizeProfileIfNeeded(user);
state.profile = await fetchMyProfile(state.sub);
$('#me-name').textContent = `${state.profile?.first_name||''} ${state.profile?.last_name||''}`.trim();
$('#me-class').textContent = state.profile?.class_label || '';
showApp(true); subscribeMessages(); loadRecentMessages();
});
}
document.addEventListener('DOMContentLoaded', bootstrap);
