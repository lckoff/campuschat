const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = { room: 'general', profile: null, sub: null };

function toast(elem, msg, ok=true){
  elem.textContent = msg;
  elem.className = 'form-msg ' + (ok ? 'ok' : 'err');
}

function showApp(show){
  $('#app').classList.toggle('hidden', !show);
  document.body.classList.toggle('in-app', show);
}

async function fetchProfile(user) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .single();
  if (error && error.code !== 'PGRST116') throw error; // ignore "no rows"
  return data || null;
}

async function upsertProfile(user, {first_name, last_name, class_label}) {
  const { error } = await supabase.from('profiles').upsert({
    user_id: user.id,
    first_name, last_name, class_label
  });
  if (error) throw error;
}

function paintMeCard(){
  if(!state.profile) return;
  $('#me-name').textContent = `${state.profile.first_name} ${state.profile.last_name}`;
  $('#me-class').textContent = state.profile.class_label;
  $('#me-avatar').style.backgroundImage = state.profile.avatar_url ? `url(${state.profile.avatar_url})` : '';
}

/** -------- SIGN UP (sans insert profile, on attend la connexion) -------- */
async function signUpFlow(){
  const modal = $('#modal-signup'); modal.showModal();
  $('#su-msg').textContent = '';

  $('#su-submit').onclick = async (e)=>{
    e.preventDefault();
    if(!$('#chk-consent').checked) return toast($('#su-msg'), "Vous devez accepter les conditions.", false);

    const first = $('#su-first').value.trim();
    const last  = $('#su-last').value.trim();
    const clazz = $('#su-class').value.trim();
    const email = $('#su-email').value.trim().toLowerCase();
    const pwd   = $('#su-password').value;

    if(!first || !last || !clazz || !email || !pwd) return toast($('#su-msg'), "Champs manquants.", false);

    // 1) Création du compte -> envoie e-mail de vérification
    const { error } = await supabase.auth.signUp({
      email, password: pwd,
      options: {
        emailRedirectTo: "https://lckoff.github.io/campuschat/"
      }
    });
    if(error) return toast($('#su-msg'), error.message, false);

    // 2) On garde les infos pour créer le profil APRÈS connexion
    localStorage.setItem("pendingProfile", JSON.stringify({first, last, clazz}));

    toast($('#su-msg'), "Compte créé. Vérifiez votre e-mail, cliquez sur le lien, puis revenez vous connecter.", true);
    setTimeout(()=>modal.close(), 2000);
  };
}

/** -------- LOGIN -------- */
async function loginFlow(){
  const modal = $('#modal-login'); modal.showModal();
  $('#li-msg').textContent = '';
  $('#li-submit').onclick = async (e)=>{
    e.preventDefault();
    const email = $('#li-email').value.trim().toLowerCase();
    const pwd = $('#li-password').value;
    const { error } = await supabase.auth.signInWithPassword({ email, password: pwd });
    if(error) return toast($('#li-msg'), error.message, false);
    modal.close();
  };
}

/** -------- UPLOAD PROOF (facultatif) -------- */
async function uploadProof(userId, file){
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${userId}/${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage.from('proofs').upload(path, file, {
    cacheControl: '3600', upsert: false
  });
  if(upErr) throw upErr;

  const deleteAfter = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
  const { error: dbErr } = await supabase.from('proof_uploads').insert({
    user_id: userId, file_path: path, delete_after: deleteAfter
  });
  if(dbErr) throw dbErr;
}

/** -------- UI BINDINGS -------- */
function bindUI(){
  $('#btn-signup').onclick = signUpFlow;
  $('#hero-signup').onclick = signUpFlow;

  $('#btn-login').onclick = loginFlow;
  $('#hero-login').onclick = loginFlow;

  $('#btn-logout').onclick = async ()=>{ await supabase.auth.signOut(); };

  // Upload preuve depuis la sidebar
  $('#btn-upload-proof').onclick = ()=>{
    const m = $('#modal-proof'); m.showModal();
    $('#pf-msg').textContent='';
    $('#pf-submit').onclick = async (e)=>{
      e.preventDefault();
      const file = $('#pf-file').files[0];
      if(!file) return toast($('#pf-msg'), "Choisissez une image.", false);
      const { data: { user } } = await supabase.auth.getUser();
      if(!user) return toast($('#pf-msg'), "Non connecté.", false);
      try{
        await uploadProof(user.id, file);
        toast($('#pf-msg'), "Preuve envoyée. Elle sera automatiquement supprimée.", true);
        setTimeout(()=>$('#modal-proof').close(), 1200);
      }catch(err){
        toast($('#pf-msg'), "Erreur: " + err.message, false);
      }
    };
  };

  // Changement de salon
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
    const { data: { user } } = await supabase.auth.getUser();
    if(!user) return;
    const { error } = await supabase.from('messages').insert({
      room: state.room, user_id: user.id, body
    });
    if(!error){
      $('#msg-input').value = '';
      $('#btn-send').style.transform='scale(0.96)'; setTimeout(()=>$('#btn-send').style.transform='',90);
    }
  };
}

/** -------- REALTIME -------- */
let msgSub;
function subscribeMessages(){
  if(msgSub) { supabase.removeChannel(msgSub); msgSub = null; }
  msgSub = supabase
    .channel('room_' + state.room)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room=eq.${state.room}` },
      (payload)=> addMessage(payload.new, true)
    )
    .subscribe();
}

async function loadRecentMessages(){
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('room', state.room)
    .order('created_at',{ ascending: true })
    .limit(100);
  if(error) return;
  $('#messages').innerHTML = '';
  data.forEach(m=>addMessage(m,false));
  const list = $('#messages'); list.scrollTop = list.scrollHeight;
}

function addMessage(m, realtime){
  const li = document.createElement('li');
  li.dataset.uid = m.user_id;
  li.title = new Date(m.created_at).toLocaleString();
  li.textContent = m.body;
  if(state.sub && m.user_id === state.sub) li.classList.add('me');
  $('#messages').appendChild(li);
  if(realtime){
    li.style.animation='fadeIn .25s ease';
    const list = $('#messages'); list.scrollTop = list.scrollHeight;
  }
}

/** -------- FINALISATION PROFIL APRÈS CONNEXION -------- */
async function finalizeProfileIfNeeded(user){
  const pending = localStorage.getItem("pendingProfile");
  if(!pending) return;
  const exists = await fetchProfile(user);
  if(exists) { localStorage.removeItem("pendingProfile"); return; }
  const { first, last, clazz } = JSON.parse(pending);
  try {
    await upsertProfile(user, { first_name:first, last_name:last, class_label:clazz });
  } finally {
    localStorage.removeItem("pendingProfile");
  }
}

/** -------- AUTH STATE -------- */
async function onAuthChange(){
  supabase.auth.onAuthStateChange(async (_evt, session)=>{
    const user = session?.user || null;
    if(!user){ showApp(false); return; }
    state.sub = user.id;

    await finalizeProfileIfNeeded(user);

    let profile = await fetchProfile(user);
    state.profile = profile;
    paintMeCard();
    showApp(true);
    subscribeMessages();
    loadRecentMessages();
  });
}

/** -------- INIT -------- */
document.addEventListener('DOMContentLoaded', ()=>{
  bindUI();
  onAuthChange();
});
