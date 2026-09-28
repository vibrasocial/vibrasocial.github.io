// Painel admin da Vibra (D112, v2 em D114). Tudo que mexe em dados passa por
// funções `admin_*` do banco, que recusam quem não está em `app_admins` e
// registram no histórico. Conteúdo vindo de usuários (denúncias, nomes,
// legendas) entra sempre como texto — nunca HTML.
(() => {
  const db = window.supabase.createClient(VIBRA.supabaseUrl, VIBRA.supabaseKey);
  const $ = (id) => document.getElementById(id);
  const SVG = "http://www.w3.org/2000/svg";

  const FLAGS = [
    ["app", "App inteiro", "Desligado = modo manutenção pra todo mundo que não é admin. A mensagem aparece na tela de manutenção."],
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

  const SERIES = [
    ["signups", "Cadastros por dia"],
    ["posts", "Publicações por dia"],
    ["comments", "Comentários por dia"],
    ["messages", "Mensagens por dia"],
  ];

  const KIND = { post: "Publicação", comment: "Comentário", message: "Mensagem", user: "Usuário", vibe: "Vibe", event: "Evento" };
  const TYPES = { pessoal: "Pessoal", criador: "Criador", empresa: "Empresa", ong: "ONG" };
  const POST_TYPES = { photo: "Foto", video: "Vídeo", text: "Texto", poll: "Enquete", audio: "Áudio", carousel: "Carrossel" };
  const ACTIONS = {
    flag: "Função alterada",
    ban: "Suspensão",
    unban: "Suspensão retirada",
    account_type: "Tipo de conta",
    delete_user: "Conta apagada",
    broadcast: "Aviso enviado",
  };

  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "on") for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
      else if (v === true) n.setAttribute(k, "");
      else if (v !== false && v != null) n.setAttribute(k, v);
    }
    for (const c of children) if (c != null && c !== false) n.append(c);
    return n;
  }
  function svg(tag, attrs) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
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
  const fmtDay = (s) => new Date(s + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const fmtNum = (n) => Number(n || 0).toLocaleString("pt-BR");
  const empty = (text) => el("div", { class: "empty" }, text);

  // ---------- Login ----------
  async function boot() {
    const { data } = await db.auth.getSession();
    if (!data.session) return showLogin();
    const { error } = await db.rpc("admin_stats");
    if (error) {
      await db.auth.signOut();
      return showLogin("Esta conta não tem acesso ao painel.");
    }
    $("meEmail").textContent = data.session.user.email || "";
    $("login").hidden = true;
    $("app").hidden = false;
    load(currentTab);
    startLiveReports();
    if (currentTab !== "reports") loadOverviewBadge();
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

  // ---------- Abas (lembra a última) ----------
  let currentTab = "overview";
  try {
    const saved = localStorage.getItem("vibra-admin-tab");
    if (saved && document.querySelector(`[data-panel="${saved}"]`)) currentTab = saved;
  } catch {}
  function selectTab(tab) {
    currentTab = tab;
    document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x.dataset.tab === tab));
    document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab));
    try { localStorage.setItem("vibra-admin-tab", tab); } catch {}
  }
  selectTab(currentTab);
  document.querySelectorAll("#tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      selectTab(b.dataset.tab);
      load(b.dataset.tab);
    })
  );
  document.querySelectorAll("[data-reload]").forEach((b) => b.addEventListener("click", () => load(b.dataset.reload)));

  function load(tab) {
    if (tab === "overview") return loadOverview();
    if (tab === "reports") return loadReports();
    if (tab === "content") return loadContent($("contentQuery").value.trim());
    if (tab === "users") return loadUsers($("userQuery").value.trim());
    if (tab === "notices") return loadNotices();
    if (tab === "flags") return loadFlags();
    if (tab === "security") return loadAudit();
    if (tab === "history") return loadHistory();
  }

  // ---------- Visão geral ----------
  let lastSeries = [];
  $("rangeSel").addEventListener("change", loadOverview);

  async function loadOverview() {
    const s = await rpc("admin_stats");
    // Gráficos dependem da migração 0068 — sem ela, a Visão geral continua funcionando.
    const { data: series, error: seriesErr } = await db.rpc("admin_timeseries", { p_days: Number($("rangeSel").value) });
    if (seriesErr) {
      $("charts").replaceChildren(el("div", { class: "card muted small" }, "Gráficos indisponíveis — rode a migração 0068 no Supabase."));
    }
    $("stats").replaceChildren(
      ...STATS.map(([k, label]) =>
        el("div", { class: "card stat" + (k === "reports_open" && s[k] > 0 ? " alert" : "") },
          el("div", { class: "n" }, fmtNum(s[k])),
          el("div", { class: "l" }, label))
      )
    );

    if (seriesErr) return;
    lastSeries = series || [];
    renderCharts();
    renderSeriesTable();
  }

  function renderCharts() {
    $("charts").replaceChildren(
      ...SERIES.map(([key, title]) => {
        const box = el("div", { class: "card chart" });
        const total = lastSeries.reduce((a, r) => a + Number(r[key] || 0), 0);
        box.append(el("h4", {}, title), el("div", { class: "total" }, `${fmtNum(total)} no período`));
        const holder = el("div");
        box.append(holder);
        requestAnimationFrame(() => barChart(holder, lastSeries.map((r) => ({ day: r.day, v: Number(r[key] || 0) })), title));
        return box;
      })
    );
  }

  function niceMax(v) {
    if (v <= 4) return 4;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  // Barras de uma série só (sem legenda — o título diz o que é), base plana,
  // topo arredondado, 2px de respiro entre barras, grade discreta e dica ao
  // passar o mouse/dedo.
  function barChart(holder, data, title) {
    const W = Math.max(260, holder.clientWidth || 300);
    const H = 150, L = 30, B = 20, T = 8, R = 4;
    const pw = W - L - R, ph = H - B - T;
    const max = niceMax(Math.max(0, ...data.map((d) => d.v)));
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": title });
    for (const f of [0, 0.5, 1]) {
      const y = T + ph - f * ph;
      s.append(svg("line", { class: "gridline", x1: L, x2: W - R, y1: y, y2: y }));
      const lab = svg("text", { class: "axis", x: L - 6, y: y + 3, "text-anchor": "end" });
      lab.textContent = fmtNum(Math.round(max * f));
      s.append(lab);
    }
    const n = data.length || 1;
    const slot = pw / n;
    const bw = Math.max(1, slot - 2);
    data.forEach((d, i) => {
      const x = L + i * slot + (slot - bw) / 2;
      const h = max ? (d.v / max) * ph : 0;
      const y = T + ph - h;
      const hit = svg("rect", { class: "hit", x: L + i * slot, y: T, width: slot, height: ph });
      s.append(hit);
      let bar = null;
      if (h > 0) {
        const r = Math.min(4, bw / 2, h);
        bar = svg("path", {
          class: "bar",
          d: `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${y + h}Z`,
        });
        bar.style.pointerEvents = "none";
        s.append(bar);
      }
      const show = (ev) => {
        if (bar) bar.classList.add("on");
        const tip = $("tip");
        tip.replaceChildren(document.createTextNode(fmtDay(d.day) + ": "), el("b", {}, fmtNum(d.v)));
        tip.hidden = false;
        const px = ev.touches ? ev.touches[0].clientX : ev.clientX;
        const py = ev.touches ? ev.touches[0].clientY : ev.clientY;
        tip.style.left = Math.min(window.innerWidth - 120, px + 12) + "px";
        tip.style.top = py - 36 + "px";
      };
      const hide = () => {
        if (bar) bar.classList.remove("on");
        $("tip").hidden = true;
      };
      hit.addEventListener("mousemove", show);
      hit.addEventListener("touchstart", show, { passive: true });
      hit.addEventListener("mouseleave", hide);
      hit.addEventListener("touchend", hide);
    });
    const idx = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
    for (const i of idx) {
      if (!data[i]) continue;
      const lab = svg("text", {
        class: "axis",
        x: L + i * slot + slot / 2,
        y: H - 5,
        "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle",
      });
      lab.textContent = fmtDay(data[i].day);
      s.append(lab);
    }
    holder.replaceChildren(s);
  }

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => currentTab === "overview" && lastSeries.length && renderCharts(), 200);
  });

  function renderSeriesTable() {
    const head = el("tr", {}, el("th", {}, "Dia"), ...SERIES.map(([, t]) => el("th", {}, t.replace(" por dia", ""))));
    const rows = [...lastSeries].reverse().map((r) =>
      el("tr", {}, el("td", {}, fmtDay(r.day)), ...SERIES.map(([k]) => el("td", {}, fmtNum(r[k]))))
    );
    $("seriesTable").replaceChildren(el("table", {}, el("thead", {}, head), el("tbody", {}, ...rows)));
  }

  // ---------- Denúncias (D116: categoria, ficha na íntegra, aviso ao vivo) ----------
  const REASONS = {
    spam: "Spam ou propaganda",
    assedio: "Assédio ou bullying",
    odio: "Discurso de ódio",
    violencia: "Violência ou ameaça",
    sexual: "Nudez ou conteúdo sexual",
    menor: "Segurança de menores",
    autolesao: "Suicídio ou automutilação",
    golpe: "Golpe ou fraude",
    falso: "Informação falsa",
    direitos: "Direitos autorais",
    perfil_falso: "Perfil falso",
    outro: "Outro motivo",
    sem_categoria: "Sem categoria",
  };
  const reasonLabel = (k) => REASONS[k || "sem_categoria"] || k;
  const freshTargets = new Set();

  function reasonTags(reasons) {
    const entries = Object.entries(reasons || {}).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return null;
    return el("div", { class: "reason-tags" },
      ...entries.map(([k, n]) => el("span", { class: "tag reason" }, reasonLabel(k), n > 1 ? el("b", {}, "×" + n) : null)));
  }

  async function resolveReport(kind, target, action) {
    const msg = action === "remove"
      ? (kind === "user" ? "Suspender esta pessoa por 30 dias?" : "Apagar este conteúdo de vez?")
      : "Manter o conteúdo e limpar as denúncias?";
    if (!confirm(msg)) return false;
    await rpc("admin_resolve_report", { p_kind: kind, p_target: target, p_action: action });
    toast(action === "remove" ? "Removido." : "Denúncias limpas.");
    loadReports();
    loadOverviewBadge();
    return true;
  }

  async function loadReports() {
    const rows = await rpc("admin_reports");
    const list = $("reportList");
    setReportsBadge(rows.length);
    if (!rows.length) return list.replaceChildren(empty("Nenhuma denúncia aberta. 🎉"));
    list.replaceChildren(
      ...rows.map((r) => {
        const fresh = freshTargets.has(r.kind + ":" + r.target_id);
        return el("div", { class: "card item" + (fresh ? " fresh" : "") },
          el("div", { class: "info" },
            el("div", {},
              el("span", { class: "tag" }, KIND[r.kind] || r.kind),
              el("span", { class: "tag bad" }, `${r.reports} denúncia${r.reports == 1 ? "" : "s"}`),
              fresh ? el("span", { class: "tag lime" }, "nova") : null),
            el("div", { class: "preview" }, r.preview || "(conteúdo já apagado)"),
            reasonTags(r.reasons),
            el("div", { class: "sub" }, `${r.owner_name || "—"} · última em ${fmtDate(r.last_report)}`)),
          el("div", { class: "actions" },
            el("button", { class: "btn sm", on: { click: () => openReport(r.kind, r.target_id) } }, "Ver na íntegra"),
            el("button", { class: "btn ghost sm", on: { click: () => resolveReport(r.kind, r.target_id, "dismiss") } }, "Manter"),
            el("button", { class: "btn danger sm", on: { click: () => resolveReport(r.kind, r.target_id, "remove") } }, r.kind === "user" ? "Suspender 30d" : "Remover")));
      })
    );
  }

  function setReportsBadge(n) {
    const badge = $("reportsBadge");
    badge.hidden = !(n > 0);
    badge.textContent = String(n || "");
  }
  async function loadOverviewBadge() {
    const { data } = await db.rpc("admin_reports");
    if (data) setReportsBadge(data.length);
  }

  // Ficha da denúncia (diálogo): conteúdo NA ÍNTEGRA + cada denúncia.
  const rdlg = $("reportDialog");
  $("rdClose").addEventListener("click", () => rdlg.close());
  rdlg.addEventListener("click", (e) => e.target === rdlg && rdlg.close());

  function mediaGrid(urls) {
    const list = (urls || []).filter(Boolean);
    if (!list.length) return null;
    return el("div", { class: "media" },
      ...list.map((u) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u)
        ? el("video", { src: u, controls: true, preload: "metadata" })
        : el("a", { href: u, target: "_blank", rel: "noopener" }, el("img", { src: u, alt: "Imagem denunciada", loading: "lazy" }))));
  }
  function authorRow(a, label) {
    if (!a) return null;
    return el("div", { class: "author-row" },
      a.avatar_url ? el("img", { src: a.avatar_url, alt: "" }) : el("div", { class: "thumb ph", style: "width:36px;height:36px;border-radius:50%" }, "?"),
      el("div", {},
        el("div", { class: "title" }, a.name || "—", " ", el("span", { class: "muted" }, "@" + String(a.handle || "").replace(/^@/, ""))),
        label ? el("div", { class: "sub" }, label) : null),
      a.id ? el("button", { class: "btn ghost sm", style: "margin-left:auto", on: { click: () => { rdlg.close(); openUser(a.id); } } }, "Ficha") : null);
  }
  const block = (title, ...children) => el("div", { class: "evidence" }, el("h3", {}, title), ...children);
  const fullText = (t) => el("div", { class: "fulltext" }, t || "(sem texto)");

  function renderContent(kind, c) {
    if (!c) return [el("p", { class: "muted" }, "O conteúdo já foi apagado — só restaram as denúncias.")];
    if (kind === "post") {
      const media = c.type === "carousel" ? c.carousel_urls : [c.media_url, c.cover_url];
      return [
        authorRow(c.author, `Publicação · ${POST_TYPES[c.type] || c.type} · ${fmtDate(c.created_at)} · público: ${c.audience}${c.location_name ? " · 📍 " + c.location_name : ""}`),
        block("Legenda completa", fullText(c.caption)),
        c.type === "audio" && c.media_url ? block("Áudio", el("audio", { src: c.media_url, controls: true })) : null,
        mediaGrid(c.type === "audio" ? [c.cover_url] : media),
        c.poll && c.poll.options ? block("Enquete", el("ul", {}, ...c.poll.options.map((o) => el("li", {}, o.label)))) : null,
        el("p", { class: "muted small" }, `${fmtNum(c.likes)} curtidas · ${fmtNum(c.comments)} comentários`),
      ];
    }
    if (kind === "comment") {
      return [
        authorRow(c.author, `Comentário · ${fmtDate(c.created_at)}${c.edited_at ? " · editado" : ""}`),
        block("Comentário completo", fullText(c.text)),
        c.parent_text ? block("Em resposta a", fullText(c.parent_text)) : null,
        c.post ? block(`Na publicação de @${String(c.post.author_handle || "").replace(/^@/, "")}`, fullText(c.post.caption), mediaGrid([c.post.media_url])) : null,
      ];
    }
    if (kind === "message") {
      return [
        authorRow(c.author, `${c.where}${c.recipient ? " com @" + String(c.recipient.handle).replace(/^@/, "") : ""} · ${fmtDate(c.created_at)}${c.deleted_at ? " · já apagada" : ""}`),
        block("Mensagem completa", fullText(c.text)),
        c.audio_url ? block("Áudio da mensagem", el("audio", { src: c.audio_url, controls: true })) : null,
        c.shared_post ? block("Publicação compartilhada", fullText(c.shared_post.caption || JSON.stringify(c.shared_post))) : null,
        c.context && c.context.length
          ? block("Conversa em volta (a denunciada em vermelho)", el("div", { class: "ctx" },
              ...c.context.map((m) => el("div", { class: "msg" + (m.reported ? " hit" : "") },
                el("small", {}, `@${String(m.sender || "").replace(/^@/, "")} · ${fmtDate(m.created_at)}`),
                m.audio ? "🎤 (áudio) " : "", m.text || ""))))
          : null,
      ];
    }
    if (kind === "user") {
      return [
        authorRow({ id: c.id, name: c.name, handle: c.handle, avatar_url: c.avatar_url }, `Perfil · ${TYPES[c.account_type] || c.account_type} · desde ${fmtDate(c.created_at)}`),
        c.cover_url ? mediaGrid([c.cover_url]) : null,
        block("Bio", fullText(c.bio)),
        c.status ? block("Status", fullText(c.status)) : null,
        c.links && c.links.length ? block("Links", el("ul", {}, ...c.links.map((l) => el("li", {}, `${l.label || "Link"}: `, el("a", { href: l.url, target: "_blank", rel: "noopener noreferrer" }, l.url))))) : null,
        c.recent_posts && c.recent_posts.length
          ? block("Publicações recentes", mediaGrid(c.recent_posts.map((p) => p.media_url)),
              el("div", {}, ...c.recent_posts.map((p) => el("div", { class: "log-line" }, el("span", { class: "when" }, fmtDate(p.created_at)), p.caption || "(sem legenda)"))))
          : null,
      ];
    }
    if (kind === "vibe") {
      return [
        authorRow(c.author, `Vibe criada em ${fmtDate(c.created_at)} · ${fmtNum(c.members)} membros${c.is_private ? " · privada" : ""}`),
        c.cover_url ? mediaGrid([c.cover_url]) : null,
        block(c.name, fullText(c.description)),
        c.recent_posts && c.recent_posts.length
          ? block("Publicações recentes na Vibe", mediaGrid(c.recent_posts.map((p) => p.media_url)),
              el("div", {}, ...c.recent_posts.map((p) => el("div", { class: "log-line" }, el("span", { class: "when" }, fmtDate(p.created_at)), p.caption || "(sem legenda)"))))
          : null,
      ];
    }
    if (kind === "event") {
      return [
        authorRow(c.author, `Evento · ${fmtDate(c.starts_at)}${c.location ? " · " + c.location : ""}${c.cancelled_at ? " · cancelado" : ""}`),
        c.cover_url ? mediaGrid([c.cover_url]) : null,
        block(c.title, fullText(c.description)),
      ];
    }
    return [el("pre", {}, JSON.stringify(c, null, 2))];
  }

  async function openReport(kind, target) {
    const d = await rpc("admin_report_detail", { p_kind: kind, p_target: target });
    $("rdTitle").textContent = `${KIND[kind] || kind} denunciad${kind === "user" || kind === "event" || kind === "comment" ? "o" : "a"}`;
    $("rdSub").textContent = `${d.reports.length} denúncia${d.reports.length === 1 ? "" : "s"}`;
    const counts = {};
    d.reports.forEach((r) => (counts[r.reason || "sem_categoria"] = (counts[r.reason || "sem_categoria"] || 0) + 1));
    const ownerId = d.content && d.content.author ? d.content.author.id : kind === "user" ? target : null;
    $("rdBody").replaceChildren(
      block("Motivos", reasonTags(counts) || el("span", { class: "muted small" }, "—")),
      ...renderContent(kind, d.content).filter(Boolean),
      block("Cada denúncia",
        ...d.reports.map((r) => el("div", { class: "report-line" },
          el("span", { class: "tag reason" }, reasonLabel(r.reason)),
          el("span", { class: "who" }, ` por ${r.reporter_name || "—"} @${String(r.reporter_handle || "").replace(/^@/, "")} · ${fmtDate(r.created_at)}`),
          r.details ? el("div", { class: "details" }, r.details) : null))),
      el("div", { class: "dlg-actions" },
        ownerId ? el("button", { class: "btn ghost sm", on: { click: () => { rdlg.close(); openUser(ownerId); } } }, kind === "user" ? "Abrir ficha" : "Ficha do autor") : null,
        el("button", { class: "btn ghost sm", on: { click: async () => { if (await resolveReport(kind, target, "dismiss")) rdlg.close(); } } }, "Manter (limpar denúncias)"),
        el("button", { class: "btn danger sm", on: { click: async () => { if (await resolveReport(kind, target, "remove")) rdlg.close(); } } }, kind === "user" ? "Suspender 30 dias" : "Remover conteúdo"))
    );
    freshTargets.delete(kind + ":" + target);
    if (!rdlg.open) rdlg.showModal();
  }

  // Aviso ao vivo: a fila `report_feed` só o admin lê (0070).
  let feedChannel = null;
  let titleTimer = null;
  const baseTitle = document.title;
  function beep() {
    if (!$("soundOn").checked) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18].forEach((t0) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine"; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + t0);
        g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t0 + 0.15);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t0); o.stop(ctx.currentTime + t0 + 0.16);
      });
    } catch {}
  }
  function alarm(row) {
    const label = `Nova denúncia: ${reasonLabel(row.reason)} (${(KIND[row.kind] || row.kind).toLowerCase()})`;
    freshTargets.add(row.kind + ":" + row.target_id);
    const tab = document.querySelector('#tabs button[data-tab="reports"]');
    tab.classList.remove("alarm"); void tab.offsetWidth; tab.classList.add("alarm");
    toast(label);
    beep();
    let on = false, n = 0;
    clearInterval(titleTimer);
    titleTimer = setInterval(() => {
      document.title = (on = !on) ? "🔴 " + label : baseTitle;
      if (++n > 12) { clearInterval(titleTimer); document.title = baseTitle; }
    }, 700);
    if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
      try { new Notification("Vibra Admin", { body: label, icon: "/icon.png" }); } catch {}
    }
    if (currentTab === "reports") loadReports();
    else loadOverviewBadge();
  }
  function startLiveReports() {
    if (feedChannel) return;
    feedChannel = db.channel("report-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "report_feed" }, (p) => alarm(p.new))
      .subscribe();
    if ("Notification" in window && Notification.permission === "default") {
      const b = $("notifyPerm");
      b.hidden = false;
      b.addEventListener("click", async () => {
        await Notification.requestPermission();
        b.hidden = true;
      });
    }
  }

  // ---------- Conteúdo ----------
  $("contentSearch").addEventListener("submit", (e) => {
    e.preventDefault();
    loadContent($("contentQuery").value.trim());
  });

  function thumbFor(p) {
    const src = p.type === "photo" || p.type === "carousel" ? p.media_url : p.cover_url;
    if (src) return el("img", { class: "thumb", src, alt: "", loading: "lazy" });
    return el("div", { class: "thumb ph" }, POST_TYPES[p.type] || p.type);
  }

  async function loadContent(q) {
    const rows = await rpc("admin_recent_posts", { p_query: q || "", p_limit: 60 });
    const list = $("contentList");
    if (!rows.length) return list.replaceChildren(empty("Nada encontrado."));
    list.replaceChildren(
      ...rows.map((p) =>
        el("div", { class: "card item" },
          thumbFor(p),
          el("div", { class: "info" },
            el("div", {},
              el("span", { class: "tag" }, POST_TYPES[p.type] || p.type),
              p.audience && p.audience !== "todos" ? el("span", { class: "tag" }, p.audience) : null,
              p.reports > 0 ? el("span", { class: "tag bad" }, `${p.reports} denúncia${p.reports == 1 ? "" : "s"}`) : null),
            el("div", { class: "preview" }, p.caption || "(sem legenda)"),
            el("div", { class: "sub" }, `${p.author_name || "—"} @${(p.author_handle || "").replace(/^@/, "")} · ${fmtDate(p.created_at)} · ${fmtNum(p.likes)} curtidas · ${fmtNum(p.comments)} comentários`)),
          el("div", { class: "actions" },
            el("button", { class: "btn ghost sm", on: { click: () => openUser(p.author_id) } }, "Autor"),
            el("button", { class: "btn danger sm", on: { click: async () => {
              if (!confirm("Apagar esta publicação de vez?")) return;
              await rpc("admin_resolve_report", { p_kind: "post", p_target: p.id, p_action: "remove" });
              toast("Publicação removida.");
              loadContent(q);
            } } }, "Remover")))
      )
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
    if (!rows.length) return list.replaceChildren(empty("Ninguém encontrado."));
    const now = Date.now();
    list.replaceChildren(
      ...rows.map((u) => {
        const banned = u.banned_until && new Date(u.banned_until).getTime() > now;
        return el("div", { class: "card item clickable", tabindex: "0", role: "button", on: {
          click: () => openUser(u.id),
          keydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openUser(u.id)),
        } },
          el("div", { class: "info" },
            el("div", { class: "title" }, `${u.name} `, el("span", { class: "muted" }, "@" + String(u.handle).replace(/^@/, ""))),
            el("div", { class: "sub" }, `${u.email || ""} · desde ${fmtDate(u.created_at)} · ${u.posts} publicações`)),
          el("div", { class: "actions" },
            el("span", { class: "tag" }, TYPES[u.account_type] || u.account_type),
            u.is_admin ? el("span", { class: "tag lime" }, "admin") : null,
            banned ? el("span", { class: "tag bad" }, "suspensa") : null));
      })
    );
  }

  // Ficha do usuário (diálogo).
  const dlg = $("userDialog");
  $("udClose").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => e.target === dlg && dlg.close());

  async function openUser(id) {
    const u = await rpc("admin_user_detail", { p_user: id });
    if (!u) return toast("Conta não encontrada.");
    const banned = u.banned_until && new Date(u.banned_until).getTime() > Date.now();
    $("udName").textContent = u.name;
    $("udSub").textContent = "@" + String(u.handle).replace(/^@/, "") + (u.is_admin ? " · admin" : "");

    const refresh = () => {
      openUser(id);
      if (currentTab === "users") loadUsers($("userQuery").value.trim());
    };
    const typeSel = el("select", { "aria-label": "Tipo de conta" },
      ...Object.entries(TYPES).map(([v, l]) => el("option", { value: v, selected: v === u.account_type }, l)));
    typeSel.addEventListener("change", async () => {
      await rpc("admin_set_account_type", { p_user: id, p_type: typeSel.value });
      toast(`Tipo de conta: ${TYPES[typeSel.value]}.`);
      refresh();
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
      await rpc("admin_set_ban", { p_user: id, p_days: days || null });
      toast(days ? "Conta suspensa." : "Suspensão retirada.");
      refresh();
    });
    const notify = el("button", { class: "btn ghost sm", on: { click: async () => {
      const text = prompt(`Mensagem pra ${u.name} (chega como notificação "Vibra"):`);
      if (!text || !text.trim()) return;
      const n = await rpc("admin_broadcast", { p_text: text.trim(), p_user: id });
      toast(n ? "Aviso enviado." : "Não enviado.");
    } } }, "Mandar aviso");
    const del = el("button", { class: "btn danger sm", on: { click: async () => {
      const handle = String(u.handle).replace(/^@/, "");
      const typed = prompt(`Apagar a conta de ${u.name} (@${handle}) e TUDO dela, sem volta?\nDigite o @ da pessoa pra confirmar:`);
      if (!typed || typed.replace(/^@/, "") !== handle) return toast("Cancelado.");
      await rpc("admin_delete_user", { p_user: id });
      toast("Conta apagada.");
      dlg.close();
      if (currentTab === "users") loadUsers($("userQuery").value.trim());
    } } }, "Apagar conta");

    const mini = (n, l) => el("div", { class: "card" }, el("div", { class: "n" }, fmtNum(n)), el("div", { class: "l" }, l));
    const kv = (k, v) => [el("dt", {}, k), el("dd", {}, v)];

    $("udBody").replaceChildren(
      el("div", { class: "mini-stats" },
        mini(u.posts, "publicações"), mini(u.comments, "comentários"), mini(u.followers, "seguidores"),
        mini(u.following, "seguindo"), mini(u.friends, "amigos"), mini(u.reports_received, "denúncias recebidas")),
      el("dl", { class: "kv" },
        ...kv("E-mail", u.email || "—"),
        ...kv("Tipo de conta", TYPES[u.account_type] || u.account_type),
        ...kv("Criada em", fmtDate(u.created_at)),
        ...kv("Último acesso", fmtDate(u.last_sign_in_at)),
        ...kv("Situação", banned ? "Suspensa até " + fmtDate(u.banned_until) : "Ativa"),
        ...kv("Denúncias feitas", fmtNum(u.reports_made)),
        ...kv("Bio", u.bio || "—")),
      u.is_admin ? el("p", { class: "muted small" }, "Admins não podem ser suspensos nem apagados pelo painel.") :
        el("div", { class: "actions", style: "margin-top:14px" }, typeSel, banSel, notify, del),
      el("h3", { class: "section-title" }, "Publicações recentes"),
      u.recent_posts.length
        ? el("div", {}, ...u.recent_posts.map((p) =>
            el("div", { class: "log-line" }, el("span", { class: "when" }, fmtDate(p.created_at)),
              el("span", { class: "tag" }, POST_TYPES[p.type] || p.type), p.caption || "(sem legenda)")))
        : el("p", { class: "muted small" }, "Nenhuma."),
      el("h3", { class: "section-title" }, "Ações do painel nesta conta"),
      u.log.length
        ? el("div", {}, ...u.log.map((l) => el("div", { class: "log-line" }, el("span", { class: "when" }, fmtDate(l.created_at)), describe(l.action, l.detail))))
        : el("p", { class: "muted small" }, "Nenhuma.")
    );
    if (!dlg.open) dlg.showModal();
  }

  // ---------- Avisos ----------
  $("broadcastText").addEventListener("input", () => ($("broadcastCount").textContent = `${$("broadcastText").value.length}/500`));
  $("broadcastForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("broadcastText").value.trim();
    if (!text) return toast("Escreva o aviso.");
    if (!confirm(`Mandar pra TODAS as contas?\n\n"${text}"`)) return;
    const n = await rpc("admin_broadcast", { p_text: text, p_user: null });
    toast(`Aviso enviado pra ${fmtNum(n)} conta${n === 1 ? "" : "s"}.`);
    $("broadcastText").value = "";
    $("broadcastCount").textContent = "0/500";
    loadNotices();
  });
  $("bannerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const on = $("bannerOn").checked;
    const text = $("bannerText").value.trim();
    if (on && !text) return toast("Escreva o texto do aviso.");
    await rpc("admin_set_flag", { p_key: "banner", p_enabled: on, p_message: text });
    toast(on ? "Aviso no feed ligado." : "Aviso no feed desligado.");
  });

  async function loadNotices() {
    const [{ data: flag }, hist] = await Promise.all([
      db.from("app_flags").select("enabled, message").eq("key", "banner").maybeSingle(),
      rpc("admin_history", { p_limit: 300 }),
    ]);
    $("bannerOn").checked = !!flag?.enabled;
    $("bannerText").value = flag?.message || "";
    const sent = (hist || []).filter((h) => h.action === "broadcast");
    $("broadcastList").replaceChildren(
      ...(sent.length
        ? sent.map((h) =>
            el("div", { class: "card item" },
              el("div", { class: "info" },
                el("div", { class: "preview" }, h.detail?.text || ""),
                el("div", { class: "sub" }, `${fmtDate(h.created_at)} · ${h.target === "todos" ? `todos (${fmtNum(h.detail?.sent)})` : "@" + String(h.target_handle || "").replace(/^@/, "")} · ${h.admin_email || ""}`))))
        : [empty("Nenhum aviso enviado ainda.")])
    );
  }

  // ---------- Funções ----------
  async function loadFlags() {
    const { data, error } = await db.from("app_flags").select("key, enabled, message, updated_at");
    if (error) return toast("Erro: " + error.message);
    const byKey = Object.fromEntries((data || []).map((f) => [f.key, f]));
    $("flagList").replaceChildren(
      ...FLAGS.map(([key, label, help]) => {
        const f = byKey[key] || { enabled: true, message: "" };
        const box = el("input", { type: "checkbox", checked: !!f.enabled, "aria-label": label });
        const msg = el("input", { value: f.message || "", placeholder: "Mensagem pra quem tentar usar (opcional)" });
        const card = el("div", { class: "card flag" + (!f.enabled ? " off" : "") },
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
            card.classList.toggle("off", !box.checked);
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
    if (!rows.length) return list.replaceChildren(empty("Nada encontrado — tudo certo. ✅"));
    list.replaceChildren(
      ...rows.map((r) =>
        el("div", { class: "card item" },
          el("div", { class: "info" },
            el("div", {}, el("span", { class: "tag " + (r.severity === "alta" ? "bad" : "") }, r.severity), el("b", {}, r.item)),
            el("div", { class: "sub" }, r.detail))))
    );
  }

  // ---------- Histórico ----------
  function describe(action, d) {
    d = d || {};
    if (action === "flag") return `Função "${d.key || ""}" ${d.enabled ? "ligada" : "desligada"}${d.message ? ` — "${d.message}"` : ""}`;
    if (action === "ban") return `Suspensão de ${d.days >= 36500 ? "tempo indeterminado" : d.days + " dia(s)"}`;
    if (action === "account_type") return `Tipo de conta → ${TYPES[d.type] || d.type}`;
    if (action === "broadcast") return `Aviso: "${d.text || ""}"`;
    if (action.startsWith("remove:")) return `Removeu ${KIND[action.slice(7)] || action.slice(7)}${d.preview ? ` — "${d.preview}"` : ""}`;
    if (action.startsWith("dismiss:")) return `Manteve ${KIND[action.slice(8)] || action.slice(8)} (denúncias limpas)`;
    return ACTIONS[action] || action;
  }

  async function loadHistory() {
    const rows = await rpc("admin_history", { p_limit: 200 });
    const list = $("historyList");
    if (!rows.length) return list.replaceChildren(empty("Nenhuma ação registrada ainda."));
    list.replaceChildren(
      ...rows.map((h) => {
        const detail = h.action === "flag" ? { ...h.detail, key: h.target } : h.detail;
        return el("div", { class: "card item" },
          el("div", { class: "info" },
            el("div", { class: "title" }, describe(h.action, detail)),
            el("div", { class: "sub" }, `${fmtDate(h.created_at)} · ${h.admin_email || "—"}${h.target_handle ? " · @" + String(h.target_handle).replace(/^@/, "") : ""}`)));
      })
    );
  }

  db.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      if (feedChannel) db.removeChannel(feedChannel);
      feedChannel = null;
      showLogin();
    }
  });
  boot();
})();
