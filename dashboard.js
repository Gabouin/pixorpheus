const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const { Pool } = require('pg');
const { WebClient } = require('@slack/web-api');

const db = new Pool({ connectionString: process.env.DATABASE_URL });
const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

const app = express();
app.set('trust proxy', 1); // Railway runs behind a reverse proxy
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: 'auto', // auto = secure on HTTPS, not secure on HTTP
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (!req.session.user) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
    return res.redirect('/login.html');
  }
  next();
}

// Redirect to Slack OpenID Connect
app.get('/auth/slack', (req, res) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SLACK_CLIENT_ID,
    scope: 'openid profile email',
    redirect_uri: `${process.env.DASHBOARD_URL}/auth/callback`,
  });
  res.redirect(`https://slack.com/openid/connect/authorize?${params}`);
});

// Slack OIDC callback
app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/login.html?error=cancelled');

  try {
    const tokenRes = await axios.post(
      'https://slack.com/api/openid.connect.token',
      new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID,
        client_secret: process.env.SLACK_CLIENT_SECRET,
        code,
        redirect_uri: `${process.env.DASHBOARD_URL}/auth/callback`,
        grant_type: 'authorization_code',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    if (!tokenRes.data.ok) throw new Error(tokenRes.data.error);

    const userInfoRes = await axios.get('https://slack.com/api/openid.connect.userInfo', {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` },
    });

    if (!userInfoRes.data.ok) throw new Error(userInfoRes.data.error);

    const u = userInfoRes.data;
    req.session.user = {
      id: u['https://slack.com/user_id'] || u.sub,
      name: u.name || u.given_name || u.email,
      avatar: u['https://slack.com/user_image_72'] || u.picture,
    };

    req.session.save(err => {
      if (err) console.error('[auth] session save error:', err);
      res.redirect('/');
    });
  } catch (e) {
    console.error('[auth] callback error:', e.message);
    res.redirect('/login.html?error=auth_failed');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login.html'));
});

// ─────────────────────────────────────────────
// SLACK USER CACHE
// ─────────────────────────────────────────────

const userCache = new Map();

async function getSlackUser(id) {
  if (userCache.has(id)) return userCache.get(id);
  const res = await slack.users.info({ user: id });
  const p = res.user.profile;
  const info = {
    id,
    name: p.display_name || p.real_name || id,
    avatar: p.image_72,
  };
  userCache.set(id, info);
  setTimeout(() => userCache.delete(id), 5 * 60 * 1000);
  return info;
}

// ─────────────────────────────────────────────
// API
// ─────────────────────────────────────────────

app.get('/api/me', requireAuth, (req, res) => {
  res.json(req.session.user);
});

app.get('/api/users/:id', requireAuth, async (req, res) => {
  try {
    res.json(await getSlackUser(req.params.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/leaderboard', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT closed_by_slack_id AS slack_id, COUNT(*)::int AS resolved
      FROM tickets
      WHERE status = 'closed' AND closed_by_slack_id IS NOT NULL
      GROUP BY closed_by_slack_id
      ORDER BY resolved DESC
      LIMIT 20
    `);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/tickets', requireAuth, async (req, res) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM tickets';
    const params = [];
    if (status && status !== 'all') {
      query += ' WHERE status = $1';
      params.push(status);
    }
    query += ' ORDER BY msg_ts DESC';
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Send a reply to a ticket thread as the logged-in helper
app.post('/api/tickets/:ts/reply', requireAuth, async (req, res) => {
  const { ts } = req.params;
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Text is required' });

  try {
    let username = req.session.user.name;
    let icon_url = req.session.user.avatar;
    try {
      const info = await getSlackUser(req.session.user.id);
      username = info.name;
      icon_url = info.avatar;
    } catch (_) {}

    // chat:write.customize scope lets us override username + icon
    await slack.chat.postMessage({
      channel: process.env.SLACK_HELP_CHANNEL,
      thread_ts: ts,
      text: text.trim(),
      username,
      icon_url,
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// SERVE DASHBOARD
// ─────────────────────────────────────────────

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.DASHBOARD_PORT || 4000;
app.listen(PORT, () => {
  console.log(`📊 Dashboard running on port ${PORT}`);
});
