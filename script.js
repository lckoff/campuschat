const $ = (s)=>document.querySelector(s);
const $$ = (s)=>document.querySelectorAll(s);

const state = {
mode: 'room', // 'room' | 'conversation'
room: 'general',
conversationId: null,
profile: null,
sub: null,
profilesCache: new Map(),
selected: new Set(),
msgSub: null,
};

/* -------------------- UI helpers -------------------- */
function setAuthNav(isLogged){
$('#nav-auth').classList.toggle('hidden', !!isLogged);
$('#nav-inapp').classList.toggle('hidden', !isLogged);
}
function showApp(show){
$('#app').classList.toggle('hidden', !show);
document.querySelector('.hero')?.classList.toggle('hidden', show);
setAuthNav(show);
}
function toast(el, msg, ok=true){ el.textContent=msg; el.className='form-msg ' + (ok?'ok':'err'); }
function escapeHtml(s){ return s.replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c])); }

/* -------------------- PROFILES -------------------- */
async function fetchProfileByUserId(uid){
if(state.profilesCache.has(uid)) return state.profilesCache.get(uid);
const { data, error } = await supabase.from('profiles')
.select('first_name,last_name,class_label,avatar_url,bio').eq('user_id', uid).single();
if(!error && data){ state.profilesCache.set(uid, data); return data; }
return { first_name:'?', last_name:'', class_label:'', avatar_url:null, bio:null };
}
async function fetchMyProfile(uid){
const { data, error } = await supabase.from('profiles').select('*').eq('user_id', uid).single();
if(error && error.code!=='PGRST116') throw error;
return data||null;
}
async function upsertMyProfile(uid, {first_name,last_name,class_label,bio,avatar_url}){
const payload = { user_id:uid, first_name,last_name,class_label };
if(bio!==undefined) payload.bio = bio;
if(avatar_url!==undefined) payload.avatar_url = avatar_url;
const { error } = await supabase.from('profiles').upsert(payload);
if(error) throw error;
}
function paintMeCard(){
if(!state.profile) return;
$('#me-name').textContent = `${state.profile.first_name} ${state.profile.last_name}`;
$('#me-class').textContent = state.profile.class_label || '';
$('#me-avatar').style.backgroundImage = state.profile.avatar_url ? `url(${state.profile.avatar_url})` : '';
}

/* -------------------- AUTH -------------------- */
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

const proof = $('#su-proof').files[0];
localStorage.setItem('pendingProfile', JSON.stringify({ first, last, clazz, hasProof: !!proof }));
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

/* -------------------- SETTINGS (profil) -------------------- */
async function openSettings(){
const m = $('#modal-settings'); m.showModal(); $('#st-msg').textContent='';
m.querySelectorAll('.close-modal').forEach(b=> b.onclick = ()=> m.close());

$('#st-first').value = state.profile?.first_name || '';
$('#st-last').value = state.profile?.last_name || '';
$('#st-class').value = state.profile?.class_label || '';
$('#st-bio').value = state.profile?.bio || '';

$('#st-save').onclick = async (e)=>{
e.preventDefault();
const first = $('#st-first').value.trim();
const last = $('#st-last').value.trim();
const clazz = $('#st-class').value.trim();
const bio = $('#st-bio').value.trim();
let avatar_url = undefined;

const file = $('#st-avatar').files[0];
if(file){
const ext = (file.name.split('.').pop()||'jpg').toLowerCase();
const path = `${state.sub}.${ext}`;
const { data, error } = await supabase.storage.from('avatars').upload(path, file, { upsert:true });
if(error){ return toast($('#st-msg'), "Upload avatar: "+error.message, false); }
// URL publique
const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
avatar_url = pub.publicUrl;
}

try{
await upsertMyProfile(state.sub, { first_name:first, last_name:last, class_label:clazz, bio, avatar_url });
state.profile = await fetchMyProfile(state.sub);
state.profilesCache.set(state.sub, state.profile);
paintMeCard();
toast($('#st-msg'), "Profil mis à jour.", true);
setTimeout(()=>m.close(), 900);
}catch(err){
toast($('#st-msg'), err.message, false);
}
};
}

/* -------------------- STORAGE: avatars bucket note --------------------
- Crée un bucket 'avatars' en 'Public'.
- Optionnel: policy INSERT/UPDATE seulement pour authenticated.
-----------------------------------------------------------------------*/

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

/* -------------------- ROOMS / CONVERSATIONS -------------------- */
function setModeRoom(){
state.mode='room'; state.conversationId=null;
$('#room-title').textContent = '# général'; $('#chat-subtitle').textContent='';
$$('.room').forEach(r=>r.classList.remove('active'));
$$('.room[data-room="general"]')[0].classList.add('active');
$('#messages').innerHTML=''; subscribeMessages(); loadMessages();
}
function setModeConv(conv){
state.mode='conversation'; state.conversationId = conv.id;
$('#room-title').textContent = conv.title || (conv.type==='dm' ? 'Message privé' : 'Groupe');
$('#chat-subtitle').textContent = conv.type==='dm' ? 'DM' : 'Groupe';
$$('.room').forEach(r=>r.classList.remove('active'));
$('#messages').innerHTML=''; subscribeMessages(); loadMessages();
}

/* -------------------- FETCH LIST CONVERSATIONS -------------------- */
async function refreshConversationsList(){
const { data, error } = await supabase
.from('conversations')
.select('id,type,title,created_at,conversation_members(user_id)')
.order('created_at',{ ascending:false });
if(error) return;

const me = state.sub;
const ul = $('#conv-list'); ul.innerHTML='';
for(const c of data){
// titre auto pour DM si pas de title
let title = c.title;
if(!title && c.type==='dm'){
const other = c.conversation_members.map(m=>m.user_id).find(id=>id!==me);
const p = await fetchProfileByUserId(other);
title = `${p.first_name} ${p.last_name}`.trim() || 'Message privé';
}
const li = document.createElement('li');
li.innerHTML = `<span class="conv-title">${escapeHtml(title||'Conversation')}</span><span class="conv-sub">${c.type==='dm'?'DM':'Groupe'}</span>`;
li.onclick = ()=> setModeConv({ id:c.id, type:c.type, title });
ul.appendChild(li);
}
}

/* -------------------- MESSAGES (room vs conversation) -------------------- */
async function loadMessages(){
if(state.mode==='room'){
const { data } = await supabase.from('messages').select('*').eq('room','general').order('created_at',{ascending:true}).limit(200);
(data||[]).forEach(m=>addMessage(m,false,true));
const list=$('#messages'); list.scrollTop=list.scrollHeight;
}else{
const { data } = await supabase.from('conversation_messages').select('*').eq('conversation_id',state.conversationId).order('created_at',{ascending:true}).limit(200);
(data||[]).forEach(m=>addMessage(m,false,false));
const list=$('#messages'); list.scrollTop=list.scrollHeight;
}
}

function subscribeMessages(){
if(state.msgSub){ supabase.removeChannel(state.msgSub); state.msgSub=null; }
if(state.mode==='room'){
state.msgSub = supabase.channel('room_general')
.on('postgres_changes',{event:'INSERT',schema:'public',table:'messages', filter:'room=eq.general'}, (payload)=> addMessage(payload.new,true,true))
.subscribe();
}else{
state.msgSub = supabase.channel('conv_'+state.conversationId)
.on('postgres_changes',{event:'INSERT',schema:'public',table:'conversation_messages', filter:`conversation_id=eq.${state.conversationId}`}, (p)=> addMessage(p.new,true,false))
.subscribe();
}
}

async function addMessage(m, realtime, isRoom){
const li=document.createElement('li');
li.dataset.uid=m.user_id;
li.title=new Date(m.created_at).toLocaleString();
const p = await fetchProfileByUserId(m.user_id);
const who = `${p.first_name} ${p.last_name}`.trim();
if(state.sub===m.user_id) li.classList.add('me');
li.innerHTML = `<strong style="display:block;font-size:.85rem;opacity:.85">${who} <span style="opacity:.6;font-weight:400">${p.class_label||''}</span></strong>${escapeHtml(m.body)}`;
$('#messages').appendChild(li);
if(realtime){ const list=$('#messages'); list.scrollTop=list.scrollHeight; }
}

/* composer */
async function handleSend(e){
e.preventDefault();
const body = $('#msg-input').value.trim();
if(!body) return;
const { data:{ user } } = await supabase.auth.getUser(); if(!user) return;
// envoi optimiste
addMessage({ user_id:user.id, body, created_at:new Date().toISOString() }, true, state.mode==='room');
$('#msg-input').value='';

if(state.mode==='room'){
await supabase.from('messages').insert({ room:'general', user_id:user.id, body });
}else{
await supabase.from('conversation_messages').insert({ conversation_id: state.conversationId, user_id:user.id, body });
}
}

/* -------------------- DIRECTORY -------------------- */
let dirAbort;
async function openDirectory(){
const d = $('#modal-directory'); d.showModal();
d.querySelectorAll('.close-modal').forEach(b=> b.onclick = ()=> d.close());
state.selected.clear(); $('#dir-dm').disabled=true; $('#dir-group').disabled=true;

async function queryDirectory(q){
if(dirAbort) dirAbort.abort();
dirAbort = new AbortController();
const like = q ? `%${q}%` : null;
let req = supabase.from('profiles').select('user_id,first_name,last_name,class_label').order('last_name',{ascending:true}).limit(500);
if(like){ req = req.or(`first_name.ilike.${like},last_name.ilike.${like},class_label.ilike.${like}`); }
const { data } = await req;
return data||[];
}
function renderDirectory(rows){
const ul = $('#dir-list'); ul.innerHTML='';
rows.forEach(r=>{
if(r.user_id===state.sub) return; // pas soi-même dans la liste
const li=document.createElement('li');
li.innerHTML=`
<input type="checkbox" class="dir-check">
<div class="dir-avatar"></div>
<div class="dir-meta">
<div class="dir-name">${escapeHtml(r.first_name)} ${escapeHtml(r.last_name)}</div>
<div class="dir-class">${escapeHtml(r.class_label||'')}</div>
</div>`;
const chk = li.querySelector('.dir-check');
chk.onchange=()=>{
if(chk.checked) state.selected.add(r.user_id); else state.selected.delete(r.user_id);
$('#dir-dm').disabled = !(state.selected.size===1);
$('#dir-group').disabled = !(state.selected.size>=2);
};
ul.appendChild(li);
});
}
renderDirectory(await queryDirectory(''));
$('#dir-q').oninput = (e)=>{ clearTimeout(openDirectory._t); openDirectory._t=setTimeout(async()=>{ renderDirectory(await queryDirectory(e.target.value.trim())); },200); };

$('#dir-dm').onclick = async ()=>{
const [otherId] = Array.from(state.selected);
const title = null; // auto
// crée la conversation
const { data: conv, error } = await supabase.from('conversations').insert({ type:'dm', title, created_by: state.sub }).select().single();
if(error) return;
await supabase.from('conversation_members').insert([
{ conversation_id: conv.id, user_id: state.sub },
{ conversation_id: conv.id, user_id: otherId }
]);
await refreshConversationsList();
setModeConv({ id: conv.id, type:'dm', title });
d.close();
};

$('#dir-group').onclick = async ()=>{
const title = prompt("Nom du groupe ?");
if(!title) return;
const { data: conv, error } = await supabase.from('conversations').insert({ type:'group', title, created_by: state.sub }).select().single();
if(error) return;
const members = Array.from(state.selected).map(uid=>({ conversation_id: conv.id, user_id: uid }));
members.push({ conversation_id: conv.id, user_id: state.sub });
await supabase.from('conversation_members').insert(members);
await refreshConversationsList();
setModeConv({ id: conv.id, type:'group', title });
d.close();
};
}

/* -------------------- SETTINGS: avatar upload helper -------------------- */
async function ensureAvatarsBucketNote(){ /* bucket à créer manuellement côté dashboard */ }

/* -------------------- FINALIZE PROFILE AFTER LOGIN -------------------- */
async function finalizeProfileIfNeeded(user){
const pending = localStorage.getItem('pendingProfile');
if(!pending) return;
const exists = await fetchMyProfile(user.id);
if(exists){ localStorage.removeItem('pendingProfile'); return; }
const { first, last, clazz } = JSON.parse(pending);
try{ await upsertMyProfile(user.id, { first_name:first, last_name:last, class_label:clazz }); }
finally{ localStorage.removeItem('pendingProfile'); }
}

/* -------------------- INIT / AUTH STATE -------------------- */
function bindUI(){
$('#btn-signup')?.addEventListener('click', signUpFlow);
$('#hero-signup')?.addEventListener('click', signUpFlow);
$('#btn-login')?.addEventListener('click', loginFlow);
$('#hero-login')?.addEventListener('click', loginFlow);
$('#btn-logout')?.addEventListener('click', async ()=>{ await supabase.auth.signOut(); setModeRoom(); });

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

// switch room général
$$('.room[data-kind="room"]').forEach(el=>{
el.onclick = ()=> setModeRoom();
});

$('#composer').addEventListener('submit', handleSend);

$('#btn-directory')?.addEventListener('click', openDirectory);
$('#btn-new-group')?.addEventListener('click', ()=>openDirectory()); // raccourci
$('#btn-settings')?.addEventListener('click', openSettings);
}

async function bootstrapSession(){
const { data:{ session } } = await supabase.auth.getSession();
if(session?.user){
state.sub = session.user.id;
await finalizeProfileIfNeeded(session.user);
state.profile = await fetchMyProfile(state.sub);
(state.profile)&& (state.profilesCache.set(state.sub, state.profile));
paintMeCard();
showApp(true);
await refreshConversationsList();
setModeRoom();
} else {
showApp(false);
}
supabase.auth.onAuthStateChange(async (_evt, s)=>{
const user = s?.user || null;
if(!user){ showApp(false); return; }
state.sub = user.id;
await finalizeProfileIfNeeded(user);
state.profile = await fetchMyProfile(state.sub);
(state.profile)&& (state.profilesCache.set(state.sub, state.profile));
paintMeCard();
showApp(true);
await refreshConversationsList();
setModeRoom();
});
}

/* -------------------- START -------------------- */
document.addEventListener('DOMContentLoaded', ()=>{
bindUI();
bootstrapSession();
});
