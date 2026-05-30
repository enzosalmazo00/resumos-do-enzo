/**
 * auth-guard.js  — proteção compartilhada para todas as páginas
 *
 * Como usar em cada página protegida:
 *   <script>window.PAGE_KEY = "biofisica";</script>   ← coluna da página (ou null para dashboard)
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="auth-guard.js"></script>
 *
 * Após auth OK dispara: document.dispatchEvent(new CustomEvent("authReady"))
 * window.authClient  → cliente Supabase
 * window.authSession → sessão do usuário
 */

(function () {
  "use strict";

  var SUPABASE_URL = "https://dmuwtmovrtlhvokdnmis.supabase.co";
  var SUPABASE_KEY = "sb_publishable_TA6bGrJ_gMQ9A4l6G3XYTQ_2rEuNNAj";
  var LOGIN_PAGE   = "login.html";

  window.authClient  = null;
  window.authSession = null;

  // ── Device ID persistente via localStorage ───────────────────────────────
  function getDeviceId() {
    var key = "_resumos_did";
    var id  = localStorage.getItem(key);
    if (!id) {
      var arr = new Uint8Array(10);
      crypto.getRandomValues(arr);
      id = Array.from(arr).map(function(b){ return b.toString(16).padStart(2,"0"); }).join("");
      localStorage.setItem(key, id);
    }
    return id;
  }

  document.addEventListener("DOMContentLoaded", async function () {

    // 1. SDK carregado?
    if (typeof supabase === "undefined") {
      console.error("[auth-guard] Supabase SDK nao carregado.");
      return;
    }

    // 2. Criar cliente
    var client;
    try {
      client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      window.authClient = client;
    } catch (err) {
      console.error("[auth-guard] Erro ao criar cliente:", err);
      return;
    }

    // 3. Verificar sessão Supabase
    var session = null;
    try {
      var result = await client.auth.getSession();
      if (result.error) throw result.error;
      session = (result.data && result.data.session) ? result.data.session : null;
    } catch (err) {
      console.error("[auth-guard] getSession falhou:", err);
      return; // erro de rede → não redireciona (evita loop)
    }

    if (!session) {
      window.location.replace(LOGIN_PAGE);
      return;
    }

    // 4. Buscar perfil — is_approved + device_id + active_session + coluna da página
    var pageKey = window.PAGE_KEY || null;
    var fields  = "is_approved, active_session, device_id" + (pageKey ? ", " + pageKey : "");

    var profile = null;
    try {
      var res = await client.from("profiles").select(fields).eq("id", session.user.id).single();
      if (res.error) throw res.error;
      profile = res.data;
    } catch (err) {
      console.error("[auth-guard] Erro ao buscar perfil:", err);
      window.location.replace(LOGIN_PAGE);
      return;
    }

    if (!profile) { window.location.replace(LOGIN_PAGE); return; }

    // 5. Conta aprovada?
    if (!profile.is_approved) {
      alert("Sua conta ainda nao foi aprovada.");
      await client.auth.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    // 6. Verificar dispositivo autorizado
    var currentDevice = getDeviceId();

    if (profile.active_session && profile.device_id && profile.device_id !== currentDevice) {
      // Sessão ativa em outro dispositivo — força logout deste
      await client.auth.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    // 7. Verificar coluna da página (se definida)
    if (pageKey && !profile[pageKey]) {
      alert("Acesso nao liberado para este conteudo.");
      window.location.replace(LOGIN_PAGE);
      return;
    }

    // 8. TUDO OK
    window.authSession = session;
    document.dispatchEvent(new CustomEvent("authReady", { detail: { session: session } }));
  });

})();
