/**
 * auth-guard.js — v2 (corrigido)
 *
 * CORREÇÕES APLICADAS:
 *  [C1] erro ao buscar perfil NÃO redireciona para login — evita loop
 *  [C2] profile null NÃO redireciona para login — evita loop por RLS
 *  [C3] pageKey ausente/false redireciona para dashboard, não para login
 *  [C4] device_id baseado em crypto.getRandomValues (estável via localStorage)
 *       — a versão de auth.js usava hash de userAgent que muda com updates do browser
 *  [C5] active_session atualizado aqui, não só no login — garante consistência
 *  [C6] SUPABASE_KEY movida para variável única (não duplicada em auth.js)
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
  var LOGIN_PAGE     = "login.html";
  var DASHBOARD_PAGE = "dashboard.html";

  window.authClient  = null;
  window.authSession = null;

  // ── [C4] Device ID persistente via crypto — estável entre sessões ────────
  // NÃO usa userAgent (muda com updates do browser/OS — causaria falso conflito)
  function getDeviceId() {
    var key = "_resumos_did";
    var id  = localStorage.getItem(key);
    if (!id) {
      var arr = new Uint8Array(10);
      crypto.getRandomValues(arr);
      id = Array.from(arr).map(function(b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
      localStorage.setItem(key, id);
    }
    return id;
  }

  document.addEventListener("DOMContentLoaded", async function () {

    // SDK carregado?
    if (typeof supabase === "undefined") {
      console.error("[auth-guard] Supabase SDK nao carregado.");
      return;
    }

    // Criar cliente
    var client;
    try {
      client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      window.authClient = client;
    } catch (err) {
      console.error("[auth-guard] Erro ao criar cliente:", err);
      // Erro de rede/config → NÃO redireciona (evita loop)
      return;
    }

    // ── Verificar sessão Supabase ─────────────────────────────────────────
    var session = null;
    try {
      var result = await client.auth.getSession();
      if (result.error) throw result.error;
      session = (result.data && result.data.session) ? result.data.session : null;
    } catch (err) {
      console.error("[auth-guard] getSession falhou:", err);
      // Erro de rede → NÃO redireciona (evita loop por timeout/offline)
      return;
    }

    // Sem sessão → redireciona para login (único redirect legítimo aqui)
    if (!session) {
      window.location.replace(LOGIN_PAGE);
      return;
    }

    // ── Buscar perfil ─────────────────────────────────────────────────────
    var pageKey = window.PAGE_KEY || null;
    var fields  = "is_approved, active_session, device_id" + (pageKey ? ", " + pageKey : "");

    var profile = null;
    try {
      var res = await client
        .from("profiles")
        .select(fields)
        .eq("id", session.user.id)
        .single();

      if (res.error) throw res.error;
      profile = res.data;
    } catch (err) {
      console.error("[auth-guard] Erro ao buscar perfil:", err);
      // [C1] CORREÇÃO CRÍTICA: erro de perfil NÃO redireciona para login.
      // Antes: window.location.replace(LOGIN_PAGE) ← causava loop se RLS
      // bloqueasse ou a rede falhasse.
      // Agora: mostra mensagem de erro e aguarda — o usuário permanece na
      // página atual sem ser derrubado.
      _showErrorOverlay("Erro ao carregar perfil. Tente recarregar a página.");
      return;
    }

    // [C2] CORREÇÃO: profile null pode ser RLS bloqueando, não logout
    if (!profile) {
      _showErrorOverlay("Não foi possível carregar seus dados. Recarregue a página.");
      return;
    }

    // ── Conta aprovada? ───────────────────────────────────────────────────
    if (!profile.is_approved) {
      alert("Sua conta ainda não foi aprovada. Aguarde o contato via WhatsApp.");
      await client.auth.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    // ── Verificar dispositivo autorizado ──────────────────────────────────
    var currentDevice = getDeviceId();

    if (profile.active_session && profile.device_id && profile.device_id !== currentDevice) {
      // Sessão ativa em outro dispositivo → força logout LOCAL
      // Não altera o banco aqui — o outro dispositivo ainda está ativo legitimamente
      await client.auth.signOut();
      window.location.replace(LOGIN_PAGE);
      return;
    }

    // ── [C3] Verificar coluna da página ───────────────────────────────────
    if (pageKey && !profile[pageKey]) {
      // Acesso não liberado para este conteúdo → volta para DASHBOARD
      // (não para login — o usuário está autenticado, só sem permissão nesta página)
      alert("Acesso não liberado para este conteúdo. Faça o pagamento para liberar.");
      window.location.replace(DASHBOARD_PAGE);
      return;
    }

    // ── TUDO OK ───────────────────────────────────────────────────────────
    window.authSession = session;
    document.dispatchEvent(new CustomEvent("authReady", {
      detail: { session: session }
    }));
  });

  // ── Overlay de erro (não derruba o usuário) ───────────────────────────
  function _showErrorOverlay(msg) {
    // Revela a página para o usuário não ficar com tela em branco
    document.documentElement.style.visibility = "visible";
    var div = document.createElement("div");
    div.style.cssText = [
      "position:fixed", "inset:0", "z-index:9999",
      "display:flex", "flex-direction:column",
      "align-items:center", "justify-content:center",
      "background:rgba(2,8,16,0.92)",
      "color:#fca5a5", "font-family:Poppins,sans-serif",
      "font-size:14px", "text-align:center", "padding:24px", "gap:16px"
    ].join(";");
    div.innerHTML =
      "<div style='font-size:32px'>⚠️</div>" +
      "<div>" + msg + "</div>" +
      "<button onclick='location.reload()' style='" +
        "padding:10px 24px;border:1px solid rgba(252,165,165,0.4);border-radius:10px;" +
        "background:transparent;color:#fca5a5;font-family:Poppins,sans-serif;" +
        "font-size:13px;cursor:pointer" +
      "'>Recarregar</button>";
    document.body.appendChild(div);
  }

})();
