// REMPLACE ICI PAR TON URL PROJET (ex: "https://xxxx.supabase.co")
const SUPABASE_URL = "https://TON_PROJECT_URL.supabase.co";

// Clé anon publique (OK côté navigateur) — fournie par toi
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpwemFzam9tZWNucmd3c2JtYW16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5NjQ2NDEsImV4cCI6MjA3MzU0MDY0MX0.qwUpaOX2SsPTGm5EjpD1w5M_mNZ9NFPQPHyaDAdYb_c";

window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
