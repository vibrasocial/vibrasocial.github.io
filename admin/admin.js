// Painel admin da Vibra (D112). Tudo que mexe em dados passa por funções
// `admin_*` do banco, que recusam quem não está em `app_admins`. Conteúdo
// vindo de usuários (denúncias, nomes) entra sempre como texto — nunca HTML.
(() => {
  const db = window.supabase.createClient(VIBRA.supabaseUrl, VIBRA.supabaseKey);
  const $ = (id) => document.getElementById(id);

  const FLAGS = [
    ["app", "App inteiro", "Desligado = modo manutenção pra todo mundo que não é admin. A mensagem aparece na tela de manutenção."],
    ["banner", "Aviso no topo do feed", "Ligado = mostra a mensagem abaixo no topo do feed de todo mundo."],
    ["signups", "Novos cadastros", "Desligado = ninguém consegue criar conta."],
    ["posts", "Publicações", "Criar publicações no feed."],
    ["momentos", "Momentos", "Publicações temporárias."],
    ["comments", "Comentários", ""],
    ["likes", "Curtidas", ""],
    ["reposts", "Reposts", ""],
    ["messages", "Mensagens", "Conversas diretas e em grupo (inclui grupos de eventos)."],
    ["vibe_chat", "Chat das vibes", ""],
    ["vibes", "Criar vibes", ""],
    ["events", "Criar eventos", ""],
    ["event_registrations", "Inscrições em eventos", ""],
    ["vibrar", "Vibrar (balançar o celular)", ""],
    ["matching", "Matching por interesse", ""],
  ];

  const STATS = [
    ["users", "Contas"],
    ["users_7d", "Novas contas (7 dias)"],
    ["users_banned", "Suspensas agora"],
    ["posts_total", "Publicações"],
    ["posts_24h", "Publicações (24h)"],
    ["comments_24h", "Comentários (24h)"],
    ["messages_24h", "Mensagens (24h)"],
    ["vibes", "Vibes"],
    ["events_upcoming", "Eventos por vir"],
    ["reports_open", "Itens denunciados"],
  ];

  const KIND = { post: "Publicação", comment: "Comentário", message: "Mensagem", user: "Usuário", vibe: "Vibe", event: "Evento" };
  const TYPES = { pessoal: "Pessoal", criador: "Criador", empresa: "Empresa", ong: "ONG" };

  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "on") for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
      else if (v === true) n.setAttribute(k, "");
      else if (v !== false && v != null) n.setAttribute(k, v);
    }
    for (const c of children) if (c != null) n.append(c);
    return n;
  }

  let toastTimer;
  function toast(text) {
    const t = $("toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
  }

  async function rpc(name, args) {
    const { data, error } = await db.rpc(name, args || {});
    if (error) {
      toast("Erro: " + error.message);
      throw error;
    }
    return data;
  }

  const fmtDate = (s) => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

  // ---------- Login ----------
  async function boot() {
    const { data } = await db.auth.getSession();
    if (!data.session) return showLogin();
    // Confere se é admin de verdade; conta comum é desconectada.
    const { error } = await db.rpc("admin_stats");
    if (error) {
      await db.auth.signOut();
      return showLogin("Esta conta não tem acesso ao painel.");
    }
    $("meEmail").textContent = data.session.user.email || "";
    $("login").hidden = true;
    $("app").hidden = false;
    load("overview");
  }

  function showLogin(msg) {
    $("app").hidden = true;
    $("login").hidden = false;
    $("loginErr").textContent = msg || "";
  }

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("loginBtn").disabled = true;
    $("loginErr").textContent = "";
    const { error } = await db.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
    $("loginBtn").disabled = false;
    if (error) return ($("loginErr").textContent = "E-mail ou senha incorretos.");
    $("password").value = "";
    boot();
  });

  $("logout").addEventListener("click", async () => {
    await db.auth.signOut();
    showLogin();
  });

  // ---------- Abas ----------
  document.querySelectorAll("#tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
      document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.tab));
      load(b.dataset.tab);
    })
  );
  document.querySelectorAll("[data-reload]").forEach((b) => b.addEventListener("click", () => load(b.dataset.reload)));

  function load(tab) {
    if (tab === "overview") return loadStats();
    if (tab === "reports") return loadReports();
    if (tab === "users") return loadUsers($("userQuery").value.trim());
    if (tab === "flags") return loadFlags();
    if (tab === "security") return loadAudit();
  }

  // ---------- Visão geral ----------
  async function loadStats() {
    const s = await rpc("admin_stats");
    $("stats").replaceChildren(
      ...STATS.map(([k, label]) =>
        el("div", { class: "card stat" + (k === "reports_open" && s[k] > 0 ? " alert" : "") },
          el("div", { class: "n" }, String(s[k] ?? 0)),
          el("div", { class: "l" }, label))
      )
    );
  }

  // ---------- Denúncias ----------
  async function loadReports() {
    const rows = await rpc("admin_reports");
    const list = $("reportList");
    if (!rows.length) return list.replaceChildren(el("div", { class: "empty" }, "Nenhuma denúncia aberta. 🎉"));
    list.replaceChildren(
      ...rows.map((r) => {
        const act = (action) => async () => {
          const msg = action === "remove"
            ? (r.kind === "user" ? "Suspender este usuário por 30 dias?" : "Apagar este conteúdo de vez?")
            : "Manter e limpar as denúncias?";
          if (!confirm(msg)) return;
          await rpc("admin_resolve_report", { p_kind: r.kind, p_target: r.target_id, p_action: action });
          toast(action === "remove" ? "Removido." : "Denúncias limpas.");
          loadReports();
        };
        return el("div", { class: "card item" },
          el("div", { class: "info" },
            el("div", {},
              el("span", { class: "tag" }, KIND[r.kind] || r.kind),
              el("span", { class: "tag bad" }, `${r.reports} denúncia${r.reports == 1 ? "" : "s"}`)),
            el("div", { class: "preview" }, r.preview || "(conteúdo já apagado)"),
            el("div", { class: "sub" }, `${r.owner_name || "—"} · última em ${fmtDate(r.last_report)}`)),
          el("div", { class: "actions" },
            el("button", { class: "btn ghost sm", on: { click: act("dismiss") } }, "Manter"),
            el("button", { class: "btn danger sm", on: { click: act("remove") } }, r.kind === "user" ? "Suspender 30d" : "Remover")));
      })
    );
  }

  // ---------- Usuários ----------
  $("userSearch").addEventListener("submit", (e) => {
    e.preventDefault();
    loadUsers($("userQuery").value.trim());
  });

  async function loadUsers(q) {
    const rows = await rpc("admin_search_users", { p_query: q || "" });
    const list = $("userList");
    if (!rows.length) return list.replaceChildren(el("div", { class: "empty" }, "Ninguém encontrado."));
    const now = Date.now();
    list.replaceChildren(
      ...rows.map((u) => {
        const banned = u.banned_until && new Date(u.banned_until).getTime() > now;
        const typeSel = el("select", { "aria-label": "Tipo de conta" },
          ...Object.entries(TYPES).map(([v, l]) => el("option", { value: v, selected: v === u.account_type }, l)));
        typeSel.addEventListener("change", async () => {
          await rpc("admin_set_account_type", { p_user: u.id, p_type: typeSel.value });
          toast(`Tipo de conta: ${TYPES[typeSel.value]}.`);
        });
        const banSel = el("select", { "aria-label": "Suspender" },
          el("option", { value: "" }, banned ? "Suspensa…" : "Suspender…"),
          el("option", { value: "1" }, "1 dia"),
          el("option", { value: "7" }, "7 dias"),
          el("option", { value: "30" }, "30 dias"),
          el("option", { value: "36500" }, "Para sempre"),
          banned ? el("option", { value: "0" }, "Tirar suspensão") : null);
        banSel.addEventListener("change", async () => {
          if (!banSel.value) return;
          const days = Number(banSel.value);
          await rpc("admin_set_ban", { p_user: u.id, p_days: days || null });
          toast(days ? "Conta suspensa." : "Suspensão retirada.");
          loadUsers(q);
        });
        const del = el("button", { class: "btn danger sm", on: { click: async () => {
          const typed = prompt(`Apagar a conta de ${u.name} (@${u.handle}) e TUDO dela, sem volta?\nDigite o @ da pessoa pra confirmar:`);
          if (!typed || typed.replace(/^@/, "") !== u.handle) return toast("Cancelado.");
          await rpc("admin_delete_user", { p_user: u.id });
          toast("Conta apagada.");
          loadUsers(q);
        } } }, "Apagar");
        return el("div", { class: "card item" },
          el("div", { class: "info" },
            el("div", { class: "title" }, `${u.name} `, el("span", { class: "muted" }, "@" + u.handle)),
            el("div", { class: "sub" }, `${u.email || ""} · desde ${fmtDate(u.created_at)} · ${u.posts} publicações`),
            el("div", {},
              u.is_admin ? el("span", { class: "tag lime" }, "admin") : null,
              banned ? el("span", { class: "tag bad" }, "suspensa até " + fmtDate(u.banned_until)) : null)),
          u.is_admin ? el("div", { class: "actions" }, typeSel) : el("div", { class: "actions" }, typeSel, banSel, del));
      })
    );
  }

  // ---------- Funções ----------
  async function loadFlags() {
    const { data, error } = await db.from("app_flags").select("key, enabled, message, updated_at");
    if (error) return toast("Erro: " + error.message);
    const byKey = Object.fromEntries((data || []).map((f) => [f.key, f]));
    $("flagList").replaceChildren(
      ...FLAGS.map(([key, label, help]) => {
        const f = byKey[key] || { enabled: key !== "banner", message: "" };
        const box = el("input", { type: "checkbox", checked: !!f.enabled, "aria-label": label });
        const msg = el("input", { value: f.message || "", placeholder: key === "banner" ? "Texto do aviso" : "Mensagem pra quem tentar usar (opcional)" });
        const card = el("div", { class: "card flag" + (!f.enabled && key !== "banner" ? " off" : "") },
          el("div", {},
            el("div", { class: "title" }, label, " ", el("code", { class: "muted" }, key)),
            help ? el("div", { class: "sub" }, help) : null,
            f.updated_at ? el("div", { class: "sub" }, "Alterado em " + fmtDate(f.updated_at)) : null),
          el("label", { class: "switch" }, box, el("span")),
          el("div", { class: "msg" }, msg, el("button", { class: "btn ghost sm", on: { click: async () => {
            await rpc("admin_set_flag", { p_key: key, p_enabled: box.checked, p_message: msg.value.trim() });
            toast("Mensagem salva.");
          } } }, "Salvar texto")));
        box.addEventListener("change", async () => {
          if (key === "app" && !box.checked && !confirm("Colocar o app inteiro em manutenção?")) return (box.checked = true);
          try {
            await rpc("admin_set_flag", { p_key: key, p_enabled: box.checked, p_message: msg.value.trim() });
            toast(`${label}: ${box.checked ? "ligado" : "desligado"}.`);
            card.classList.toggle("off", !box.checked && key !== "banner");
          } catch {
            box.checked = !box.checked;
          }
        });
        return card;
      })
    );
  }

  // ---------- Segurança ----------
  async function loadAudit() {
    const rows = await rpc("admin_security_audit");
    const list = $("auditList");
    if (!rows.length) return list.replaceChildren(el("div", { class: "empty" }, "Nada encontrado — tudo certo. ✅"));
    list.replaceChildren(
      ...rows.map((r) =>
        el("div", { class: "card item" },
          el("div", { class: "info" },
            el("div", {}, el("span", { class: "tag " + (r.severity === "alta" || r.severity === "high" ? "bad" : "") }, r.severity), el("b", {}, r.item)),
            el("div", { class: "sub" }, r.detail))))
    );
  }

  db.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") showLogin();
  });
  boot();
})();
