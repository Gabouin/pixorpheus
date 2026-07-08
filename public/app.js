const userCache = {};
let currentStatus = "open";
let searchTimer = null;
let threadTimers = {};
let chartInstance = null;

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
  } catch (e) {
    throw new Error("Network error");
  }
  if (res.status === 401) {
    location.href = "/login.html";
    return null;
  }
  if (res.status === 403) return { error: "Access denied, please DM @Gabin on slack" };
  try {
    return await res.json();
  } catch (e) {
    throw new Error(`Server error (${res.status})`);
  }
}

async function getUser(id) {
  if (userCache[id]) return userCache[id];
  const d = await api(`/api/users/${id}`);
  if (d && !d.error) userCache[id] = d;
  return d || { id, name: id, avatar: null };
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function relTime(slackTs) {
  const d = Date.now() - parseFloat(slackTs) * 1000;
  const m = Math.floor(d / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (dy > 0) return dy + "d";
  if (h > 0) return h + "h";
  if (m > 0) return m + "m";
  return "< 1m";
}

function fmtSlack(t) {
  if (!t) return "";
  return esc(t)
    .replace(/\*(.+?)\*/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code style="background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:.85em;color:#111">$1</code>')
    .replace(/&lt;@([A-Z0-9]+)(?:\|[^&]+)?&gt;/g, '<span style="color:#555;font-weight:600">@$1</span>')
    .replace(/\n/g, "<br>");
}

async function loadMe() {
  const me = await api("/api/me");
  if (!me) return;
  document.getElementById("u-name").textContent = me.name;
  if (me.avatar) {
    const i = document.getElementById("u-avatar");
    i.src = me.avatar;
    i.style.display = "block";
  }
}

async function loadStats() {
  const d = await api("/api/stats");
  if (!d || d.error) return;
  document.getElementById("stats").innerHTML = `
    <div class="stat-card neutral">
      <div class="stat-label">Total Tickets</div>
      <div class="stat-value">${d.total}</div>
    </div>
    <div class="stat-card yellow">
      <div class="stat-label">Open</div>
      <div class="stat-value">${d.open}</div>
    </div>
    <div class="stat-card teal">
      <div class="stat-label">Resolved</div>
      <div class="stat-value">${d.resolved}</div>
    </div>
    <div class="stat-card red">
      <div class="stat-label">Longest Open</div>
      <div class="stat-value">${d.longest_open_days ? d.longest_open_days + "d" : "—"}</div>
      <div class="stat-sub">${d.longest_open_days ? "oldest open ticket" : "no open tickets"}</div>
    </div>`;
}

async function loadChart() {
  const d = await api("/api/activity");
  if (!d || d.error) return;

  const labels = [];
  for (let i = 29; i >= 0; i--) {
    const dt = new Date(Date.now() - i * 86400000);
    labels.push(
      (dt.getMonth() + 1).toString().padStart(2, "0") + "-" +
      dt.getDate().toString().padStart(2, "0")
    );
  }

  const mapByDay = (rows) => {
    const m = {};
    rows.forEach((r) => { m[r.day] = r.count; });
    return labels.map((l) => m[l] || 0);
  };

  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(document.getElementById("chart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Created",
          data: mapByDay(d.created),
          borderColor: "#111",
          backgroundColor: "rgba(0,0,0,.04)",
          borderWidth: 1.5,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
        },
        {
          label: "Resolved",
          data: mapByDay(d.resolved),
          borderColor: "#aaa",
          backgroundColor: "rgba(0,0,0,.02)",
          borderWidth: 1.5,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: { color: "#aaa", font: { size: 11 }, boxWidth: 24, boxHeight: 2, usePointStyle: false },
        },
        tooltip: {
          backgroundColor: "#fff",
          borderColor: "#e5e5e5",
          borderWidth: 1,
          titleColor: "#aaa",
          bodyColor: "#111",
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(0,0,0,.04)" },
          ticks: { color: "#ccc", font: { size: 10 }, maxTicksLimit: 10 },
        },
        y: {
          grid: { color: "rgba(0,0,0,.04)" },
          ticks: { color: "#ccc", font: { size: 10 } },
          beginAtZero: true,
        },
      },
    },
  });
}

async function loadLeaderboard() {
  const d = await api("/api/leaderboard");
  if (!d || d.error) return;

  async function renderCol(rows) {
    if (!rows.length)
      return '<div style="color:#333;font-size:.8rem;padding:8px 0">No data yet</div>';
    const users = await Promise.all(rows.map((r) => getUser(r.slack_id)));
    return rows.map((row, i) => {
      const u = users[i] || { name: row.slack_id, avatar: null };
      const rClass = ["r1", "r2", "r3"][i] || "";
      return `<div class="lb-row">
        <span class="lb-rank ${rClass}">${i + 1}</span>
        ${u.avatar ? `<img class="lb-avatar" src="${esc(u.avatar)}" alt="">` : `<div class="lb-avatar"></div>`}
        <span class="lb-name">${esc(u.name)}</span>
        <span class="lb-count">${row.resolved}</span>
      </div>`;
    }).join("");
  }

  const [allHTML, weekHTML, todayHTML] = await Promise.all([
    renderCol(d.allTime),
    renderCol(d.thisWeek),
    renderCol(d.today),
  ]);

  document.getElementById("lb-grid").innerHTML = `
    <div class="lb-col"><div class="lb-col-title">All Time</div>${allHTML}</div>
    <div class="lb-col"><div class="lb-col-title">This Week</div>${weekHTML}</div>
    <div class="lb-col"><div class="lb-col-title">Today</div>${todayHTML}</div>`;
}

async function loadTickets(silent = false) {
  const list = document.getElementById("ticket-list");
  if (!silent) {
    list.innerHTML = `
      <div class="ticket-row"><span class="sk" style="height:.8rem;width:60%;display:block"></span></div>
      <div class="ticket-row"><span class="sk" style="height:.8rem;width:45%;display:block;opacity:.6"></span></div>`;
  }

  const search = document.getElementById("search").value;
  const params = new URLSearchParams({ status: currentStatus });
  if (search.trim()) params.set("search", search.trim());

  const openTs = new Set(
    [...document.querySelectorAll(".ticket-row.expanded")].map((r) => r.dataset.ts)
  );
  const drafts = {};
  document.querySelectorAll(".reply-ta").forEach((ta) => {
    if (ta.value.trim()) drafts[ta.dataset.ts] = ta.value;
  });

  const data = await api("/api/tickets?" + params);
  if (!data || data.error) {
    list.innerHTML = '<div class="empty">Failed to load tickets.</div>';
    return;
  }
  if (!data.length) {
    list.innerHTML = '<div class="empty">No tickets found.</div>';
    return;
  }

  list.innerHTML = data.map((t) => buildRow(t)).join("");

  openTs.forEach((ts) => {
    const row = list.querySelector(`[data-ts="${ts}"]`);
    if (row) {
      row.classList.add("expanded");
      loadThread(ts, true);
    }
  });
  Object.entries(drafts).forEach(([ts, v]) => {
    const ta = list.querySelector(`.reply-ta[data-ts="${ts}"]`);
    if (ta) ta.value = v;
  });
}

function buildRow(t) {
  const badge = t.status === "open"
    ? '<span class="badge badge-open">Open</span>'
    : '<span class="badge badge-closed">Resolved</span>';

  const actions = t.status === "open"
    ? `<div class="reply-row">
        <textarea class="reply-ta" data-ts="${t.msg_ts}" placeholder="Reply in thread as you…"></textarea>
        <button class="btn-res" data-ts="${t.msg_ts}" data-action="resolve">Resolve</button>
        <button class="btn-send" data-ts="${t.msg_ts}" data-action="reply">Send</button>
      </div>
      <div class="action-status" id="st-${t.msg_ts}"></div>`
    : "";

  return `<div class="ticket-row" data-ts="${t.msg_ts}" data-action="toggle">
    <div class="ticket-top">
      <span class="ticket-title">${esc(t.description || "[no text]")}</span>
      ${badge}
      <span class="ticket-age">${relTime(t.msg_ts)}</span>
    </div>
    <div class="ticket-meta">opened by @${esc(t.opened_by_slack_id)}</div>
    <div class="ticket-body-wrap">
      <div class="thread-area" id="th-${t.msg_ts}"><div class="thread-loading">Loading…</div></div>
      ${actions}
    </div>
  </div>`;
}

document.getElementById("ticket-list").addEventListener("click", (e) => {
  const resolveBtn = e.target.closest('[data-action="resolve"]');
  const replyBtn = e.target.closest('[data-action="reply"]');
  const row = e.target.closest('[data-action="toggle"]');

  if (resolveBtn) { resolveTicket(resolveBtn.dataset.ts, resolveBtn); return; }
  if (replyBtn) { sendReply(replyBtn.dataset.ts, replyBtn); return; }
  if (row && !e.target.closest("textarea, button, input")) toggleRow(row);
});

function toggleRow(row) {
  const ts = row.dataset.ts;
  const wasOpen = row.classList.contains("expanded");
  row.classList.toggle("expanded");
  if (!wasOpen) {
    loadThread(ts);
    threadTimers[ts] = setInterval(() => loadThread(ts, true), 5000);
  } else {
    clearInterval(threadTimers[ts]);
    delete threadTimers[ts];
  }
}

async function loadThread(ts, silent = false) {
  const el = document.getElementById(`th-${ts}`);
  if (!el) return;
  if (!silent) el.innerHTML = '<div class="thread-loading">Loading…</div>';

  const data = await api(`/api/tickets/${ts}/thread`);
  if (!data || data.error) {
    el.innerHTML = '<div class="thread-loading">Could not load thread.</div>';
    return;
  }
  if (!data.length) {
    el.innerHTML = '<div class="thread-loading">No messages yet.</div>';
    return;
  }

  const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 40;
  el.innerHTML = data.map((m) => `
    <div class="msg">
      ${m.avatar ? `<img class="msg-av" src="${esc(m.avatar)}" alt="">` : `<div class="msg-av"></div>`}
      <div class="msg-content">
        <div class="msg-who">${esc(m.name)}<span class="msg-time-small">${relTime(m.ts)}</span></div>
        <div class="msg-text">${fmtSlack(m.text)}</div>
      </div>
    </div>`).join("");
  if (atBottom || !silent) el.scrollTop = el.scrollHeight;
}

async function sendReply(ts, btn) {
  const ta = document.querySelector(`.reply-ta[data-ts="${ts}"]`);
  const st = document.getElementById(`st-${ts}`);
  const txt = ta?.value.trim();
  if (!txt) return;

  btn.disabled = true;
  try {
    const res = await api(`/api/tickets/${ts}/reply`, {
      method: "POST",
      body: JSON.stringify({ text: txt }),
    });
    btn.disabled = false;
    if (res?.ok) {
      ta.value = "";
      showStatus(st, "Sent", "ok");
      loadThread(ts, true);
    } else {
      showStatus(st, "Error: " + (res?.error || "Failed"), "err");
    }
  } catch (e) {
    btn.disabled = false;
    showStatus(st, "Error: " + e.message, "err");
  }
}

async function resolveTicket(ts, btn) {
  const st = document.getElementById(`st-${ts}`);

  if (btn.dataset.confirming !== "1") {
    btn.dataset.confirming = "1";
    btn.textContent = "Sure?";
    setTimeout(() => {
      if (btn.dataset.confirming === "1") {
        btn.dataset.confirming = "";
        btn.textContent = "Resolve";
      }
    }, 3000);
    return;
  }

  btn.dataset.confirming = "";
  btn.textContent = "Resolve";
  btn.disabled = true;
  showStatus(st, "Resolving…", "");

  try {
    const res = await api(`/api/tickets/${ts}/resolve`, { method: "POST", body: "{}" });
    btn.disabled = false;
    if (res?.ok) {
      showStatus(st, "Resolved", "ok");
      clearInterval(threadTimers[ts]);
      delete threadTimers[ts];
      setTimeout(() => loadTickets(true), 800);
    } else {
      showStatus(st, "Error: " + (res?.error || "Unknown error"), "err");
    }
  } catch (e) {
    btn.disabled = false;
    showStatus(st, "Error: " + e.message, "err");
  }
}

function showStatus(el, msg, cls) {
  if (!el) return;
  el.textContent = msg;
  el.className = "action-status" + (cls ? " " + cls : "");
  if (cls === "ok") {
    setTimeout(() => {
      el.textContent = "";
      el.className = "action-status";
    }, 3000);
  }
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentStatus = btn.dataset.status;
    loadTickets();
  });
});

document.getElementById("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadTickets, 350);
});

const INACTIVITY_MS = 15 * 60 * 1000;
let lastActivity = Date.now();

["mousemove", "keydown", "click", "touchstart", "scroll"].forEach((e) => {
  document.addEventListener(e, () => { lastActivity = Date.now(); }, { passive: true });
});

setInterval(() => {
  const overlay = document.getElementById("conf-overlay");
  if (!overlay.classList.contains("visible") && Date.now() - lastActivity >= INACTIVITY_MS) {
    overlay.classList.add("visible");
  }
}, 30000);

function dismissReminder() {
  lastActivity = Date.now();
  document.getElementById("conf-overlay").classList.remove("visible");
}

let logoClicks = 0, logoTimer = null;
document.querySelector('.logo').addEventListener('click', () => {
  logoClicks++;
  clearTimeout(logoTimer);
  logoTimer = setTimeout(() => { logoClicks = 0; }, 1200);
  if (logoClicks === 5) {
    const p = document.getElementById('speak-panel');
    p.style.display = p.style.display === 'none' ? 'block' : 'none';
  }
  if (logoClicks >= 10) {
    logoClicks = 0;
    openSpeakLog();
  }
});

async function openSpeakLog() {
  const panel = document.getElementById('log-panel');
  const list = document.getElementById('log-list');
  panel.style.display = 'flex';
  list.innerHTML = '<div style="padding:16px 20px;font-size:.78rem;color:#bbb;">Loading…</div>';
  const data = await api('/api/speak/log');
  if (!data || data.error) {
    list.innerHTML = `<div style="padding:16px 20px;font-size:.78rem;color:#dc2626;">${data?.error || 'Error'}</div>`;
    return;
  }
  if (!data.length) {
    list.innerHTML = '<div style="padding:16px 20px;font-size:.78rem;color:#bbb;">No messages sent yet.</div>';
    return;
  }
  list.innerHTML = data.map(e => {
    const d = new Date(e.created_at);
    const when = d.toLocaleDateString('en', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
    const where = e.thread_ts ? `${e.channel_name} (thread)` : e.channel_name;
    return `<div style="padding:10px 20px;border-bottom:1px solid #f5f5f5;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:3px;">
        <span style="font-size:.78rem;font-weight:600;color:#111;">${esc(e.user_name || '?')}</span>
        <span style="font-size:.7rem;color:#bbb;">${when}</span>
      </div>
      <div style="font-size:.72rem;color:#aaa;margin-bottom:4px;">→ ${esc(where)}</div>
      <div style="font-size:.82rem;color:#444;white-space:pre-wrap;word-break:break-word;">${esc(e.text)}</div>
    </div>`;
  }).join('');
}

async function speakSend() {
  const channel = document.getElementById('speak-channel').value.trim();
  const text = document.getElementById('speak-text').value.trim();
  const thread_ts = document.getElementById('speak-thread').value.trim();
  const st = document.getElementById('speak-status');
  if (!channel || !text) { st.textContent = 'channel + message required'; return; }
  st.textContent = 'Sending…';
  const res = await api('/api/speak', { method: 'POST', body: JSON.stringify({ channel, text, thread_ts }) });
  if (res?.ok) {
    st.textContent = 'Sent';
    document.getElementById('speak-text').value = '';
    document.getElementById('speak-thread').value = '';
    setTimeout(() => { st.textContent = ''; }, 2000);
  } else {
    st.textContent = res?.error || 'Error';
  }
}

loadMe();
loadStats();
loadChart();
loadLeaderboard();
loadTickets();
setInterval(loadStats, 60000);
setInterval(loadLeaderboard, 60000);
setInterval(() => loadTickets(true), 30000);
