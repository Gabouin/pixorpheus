<h1 align="center">
  <br>
  <img width="18%" alt="Pixorpheus" src="https://github.com/user-attachments/assets/REPLACE_WITH_YOUR_IMAGE" />
  <br>
  Pixorpheus
  <br>
</h1>

<h4 align="center">
The official Slack bot of the <a href="https://hackclub.slack.com/archives/C0B5P4N0WHH">Pixl</a> YSWS program — part entertainer, part support system, part AI with too much personality.
</h4>

<div align="center">

![License](https://img.shields.io/badge/License-ISC-blue.svg)
![Platform](https://img.shields.io/badge/Platform-Slack-4A154B.svg)
![Runtime](https://img.shields.io/badge/Node.js-18+-339933.svg)
![Deploy](https://img.shields.io/badge/Deployed-Railway-7B2FBE.svg)
![Hack Club](https://img.shields.io/badge/Hack%20Club-YSWS-EC3750.svg)

</div>

<p align="center">
  <a href="#architecture">Architecture</a> •
  <a href="#slash-commands">Commands</a> •
  <a href="#ai-system">AI</a> •
  <a href="#github-webhook">GitHub Webhook</a> •
  <a href="#dashboard">Dashboard</a> •
  <a href="#environment-variables">Env Vars</a> •
  <a href="#deployment">Deployment</a>
</p>

<br>

<p align="center">
Pixorpheus handles the full help/ticket workflow for Pixl, talks to people in threads, remembers things about everyone, roasts people on demand, and generally acts like a teenager.
</p>

---

## Table of Contents

- [Architecture](#architecture)
- [Slash Commands](#slash-commands)
  - [Fun & Utility](#fun--utility)
  - [Pixl Program](#pixl-program)
  - [Memory & Knowledge](#memory--knowledge)
  - [Support Team Only](#support-team-only)
- [Inline Commands (pixo:)](#inline-commands-pixo)
- [Thread Controls](#thread-controls)
- [AI System](#ai-system)
- [Smart FAQ](#smart-faq)
- [GitHub Webhook](#github-webhook)
- [Auto-Close](#auto-close)
- [Help & Ticket System](#help--ticket-system)
- [Style Listening System](#style-listening-system)
- [Training Mode](#training-mode)
- [Dashboard](#dashboard)
- [Database](#database)
- [Environment Variables](#environment-variables)
- [Deployment](#deployment)

---

## Architecture

| File | Role |
|---|---|
| `index.js` | Main Slack bot - all commands, events, AI, ticket system, GitHub webhook receiver |
| `dashboard.js` | Express web server - helper dashboard with Slack OAuth |
| `public/` | Dashboard frontend (HTML/CSS/JS) |
| `models.json` | Model list (legacy) |

Both `index.js` and `dashboard.js` are separate processes sharing the same PostgreSQL database. The bot runs on Slack's Bolt v4 framework (`ExpressReceiver`). The dashboard runs on Express.

---

## Slash Commands

### Fun & Utility

| Command | Description |
|---|---|
| `/pixl-ping` | Check bot latency |
| `/pixl-help` | List all available commands |
| `/pixl-joke` | Get a random joke (via JokeAPI) |
| `/pixl-coinflip` | Flip a coin |
| `/pixl-fact` | Get a random surprising fact (AI-generated) |
| `/pixl-urban [word]` | Urban Dictionary definition - AI-filtered to remove the worst ones |
| `/pixl-ask [question]` | Ask Pixorpheus anything publicly |
| `/pixl-roast [@user]` | Roast someone (or yourself) - pulls from memory for extra precision |
| `/pixl-remind [time] [message]` | Set a reminder - supports `s`, `min`, `h` (e.g. `/pixl-remind 10min grab lunch`) - max 24h |
| `/pixl-countdown [time] [label]` | Countdown timer that posts to channel when it hits zero |
| `/pixl-poll Question; Option1, Option2 [, 10min]` | Create a poll with emoji reactions - add a time at the end to auto-close it |
| `/pixl-ship [description]` | Announce a project you shipped |
| `/pixl-stats` | Bot activity stats (pixelizations, AI replies, roasts, reminders - since last restart) |

### Pixl Program

| Command | Description |
|---|---|
| `/pixl [@user] [size]` | Pixelate a Slack profile picture - only works in the Pixl channels. Optional pixel size 2–64 (default 8). Reacts with `:pixl-delete:` to remove. |
| `/pixl-lastship [@user or github_username]` | Show the last approved Hack Club Ship. No argument = your own ships (matched by Slack ID). Pass `@user` to look up someone else by Slack ID. Pass a GitHub username as plain text to look up by username. |
| `/pixl-leaderboard` | Show who Pixorpheus knows the most facts about - the most engaged members |

### Memory & Knowledge

| Command | Description |
|---|---|
| `/pixl-mymemory [@user]` | See what Pixorpheus remembers about you (ephemeral) - or mention someone to show their profile publicly |
| `/pixl-helpstats` | Ticket stats - total, open, resolved counts |

### Support Team Only

These commands require being a helper, an admin (`SLACK_ADMIN_USER_IDS`), or a member of the ticket channel.

| Command | Description |
|---|---|
| `/pixl-addhelper @user` | Add someone to the helpers list |
| `/pixl-removehelper @user` | Remove someone from the helpers list |
| `/pixl-helpers` | List all current helpers |
| `/pixl-remember [fact]` | Teach Pixorpheus a fact about the server - injected into every AI reply (Gabin can also use this) |
| `/pixl-forget [number]` | Remove a stored memory entry by number |
| `/pixl-memories` | List all stored server memories |

---

## Inline Commands (pixo:)

These are typed directly in a message (not slash commands). They only work in channels where Pixorpheus has access - **private channels or channels it's been added to**.

| Command | Where | Description |
|---|---|---|
| `pixo:kawaii` | Any channel Pixorpheus is in | Start listening mode - Pixorpheus begins collecting messages in that channel to learn the writing style |
| `pixo:notkawaii` | Same channel | Stop listening mode - processes the collected messages and saves the speaking style |
| `pixo:kawaii?` | Anywhere | Check if listening mode is active - shows the channel and how many messages have been collected (ephemeral) |
| `pixo:recap` | Any channel | Summarize the last 6 hours of messages in the channel, shown only to you (ephemeral). Use `pixo:recap today` to summarize since midnight, `pixo:recap 2h` for a custom timeframe (supports `min`, `h`, `d`). In a thread, it summarizes the thread instead. |

> Only one listening session can be active at a time. Starting a new one in a different channel resets the previous one.

There's also a special delete feature: react with `:pixl-delete:` to any Pixorpheus message and it will delete itself.

---

## Thread Controls

Type these anywhere in a thread to control Pixorpheus's behavior:

| Command | Effect |
|---|---|
| `PIXOSTOP` | Mute Pixorpheus in the current thread - it will stop replying unless directly mentioned |
| `PIXOSTART` | Unmute Pixorpheus in the current thread |

---

## AI System

### How It Works

Pixorpheus replies to messages when:
1. Someone mentions it by name (`pixorpheus`, `pixo`, `pix`)
2. Someone directly @mentions it (`@pixorpheus`)
3. It decides to jump in uninvited if there's a genuinely good opening (chime mode - ~45% chance it acts on it)
4. Someone DMs it

Messages are batched for 1.5 seconds (if mentioned) or 8 seconds (if chiming) to avoid replying to every single message in a fast conversation.

### Models

| Use case | Model |
|---|---|
| All AI replies and utility tasks | `anthropic/claude-sonnet-5` via Hack Club AI (`HACKCLUB_AI_KEY`) |
| DMs | `claude-haiku-4-5` via Anthropic SDK (with web search) |

The active model can be overridden with the `HC_AI_MODEL` env var. Rate limits (429) are handled silently. Credit exhaustion (402) posts a visible error.

### Memory System

Pixorpheus automatically learns about people over time:

- **Facts** - extracted from every conversation (name, projects, skills, interests, etc.). Stored per user in PostgreSQL. Up to 100 facts per person.
- **Personality traits** - extracted 20% of the time, capturing communication style (blunt, enthusiastic, chaotic, etc.)
- **Server memory** - facts about the Pixl program added via `/pixl-remember` - injected into every AI reply
- **Style notes** - learned from the listening/training system (see below) - also injected into every reply

All of this is fed into the system prompt before every reply, so Pixorpheus always has context on who it's talking to.

### Web Search

Pixorpheus automatically searches the web (via Brave Search API) when a message seems to need up-to-date info - current events, news, prices, recent releases, etc. It decides whether to search before replying.

### Custom Emojis

Pixorpheus has a full list of custom Slack emojis it knows about and uses in messages when contextually appropriate:

`:wiltedrose:` `:yay:` `:loll:` `:sad-pf:` `:skulk:` `:noooovanish:` `:angy:` `:yesyes:` `:blobhaj_party:` `:shocked:` `:upvote:` `:lets-fucking-gooo:` `:huh3d:` `:thumbs-up:` `:3c:` `:byee:` `:hii:` `:nono:` `:hehehe:` `:awww:` `:alibaba-admire:` `:alibaba-grin:` `:cryign:` `:heavysob:` `:brokenheart:` `:nyan:` `:cat-gun:` `:isob:` `:sob-pray:` `:agadance:` `:cat-woah:` `:cat-heart:` `:communist:` `:eyes_wtf:` `:eyes_shaking:` `:eyes-out-of-head:` `:orpheus-love:` `:orpheus-baguette:` `:orphanage:` `:orpheus-explode:` `:hyper-dino-wave:` `:pepedyingoflaughter:` `:pet-gabin:` `:pet-ridit:` `:pet-maxx:` `:yapa:` `:yay-gay:` `:wagay:` `:gay-flag:` `:bhjflag_gay:` `:spinny_cat_gay:` `:1984:`

It can also react to messages with these emojis (the AI decides when it's appropriate).

### Special Behaviors

- **Orpheus bot** - automatically replies "thx orphan" immediately whenever Orpheus posts in the same channel
- **New members** - posts a random welcome message when someone joins the Pixl channel (`#pixl`) and pings Gabin, Ridit, Ricky, and Alex in the thread
- **Short replies** - the bot is trained to reply like someone actually texting: 2–8 words most of the time
- **Pixl FAQ auto-reply** - if someone posts something like "what's pixl?" or "c'est quoi pixl" anywhere (not in a thread), Pixorpheus replies in thread with an explanation without needing to be mentioned
- **Nickname awareness** - Pixorpheus knows "pixo" and "pix" are its nicknames and owns them — never acts confused

---

## Smart FAQ

When a user posts in the help channel, Pixorpheus automatically checks whether the question was already answered before creating a ticket.

### How it works

1. As soon as a message lands in the help channel, Pixorpheus queries the last 60 resolved tickets (by description and title)
2. It uses DeepSeek to compare the new question against all of them and look for a semantic match
3. If a similar resolved ticket is found, the user gets an **ephemeral** message with a link to that ticket and a "View FAQ" button - before they even have to wait for a reply
4. The ticket is still created normally so a helper can follow up if needed

The FAQ check runs in parallel with the ticket creation flow - it never slows anything down.

- **Language:** English only (the bot reminds users to post in English if needed)
- **Threshold:** Only high-confidence matches are surfaced - vague similarity is ignored

---

## GitHub Webhook

Pixorpheus can post a Slack message whenever you push to `main` or merge a PR into `main` on any GitHub repo.

### Setup

1. Set `GITHUB_NOTIFY_CHANNEL` (Slack channel ID) and `GITHUB_WEBHOOK_SECRET` (any random string) on the bot's Railway service
2. In each GitHub repo: **Settings → Webhooks → Add webhook**
   - Payload URL: `https://[bot-url].railway.app/webhooks/github`
   - Content type: `application/json`
   - Secret: same value as `GITHUB_WEBHOOK_SECRET`
   - Events: **Pushes** + **Pull requests**

### Output

- **Push to main:** `gabin pushed 2 commits to 'main' on gabin/myrepo` + commit messages + short hashes
- **PR merged to main:** `gabin merged PR #12 "Fix the thing" into 'main' on gabin/myrepo`

The endpoint lives at `POST /webhooks/github` on the bot (not the dashboard). No auth required — the GitHub HMAC-SHA256 signature is verified if `GITHUB_WEBHOOK_SECRET` is set.

---

## Auto-Close

Tickets that have been open for more than **7 days** with no activity are automatically closed.

### Rules

- A ticket qualifies if: it has been open for 7+ days AND the last message in the thread is also 7+ days old
- At closure, Pixorpheus posts a message in the thread explaining the ticket was auto-closed due to inactivity, and tells the user to open a new ticket if the issue is still relevant
- The ticket channel message is updated to show the resolved status

Auto-close runs once at startup and once every 24 hours.

---

## Help & Ticket System

This is the core support system for the Pixl program.

### Flow

1. **User posts in the help channel** →
   - Pixorpheus adds a 🤔 reaction to the message
   - Posts a thread reply: "Someone will be here soon!" + a "Mark as resolved" button
   - Sends the user an ephemeral message asking them to set a title for their ticket ("Set title" / "Skip" buttons)

2. **Title modal** (optional) →
   - If the user clicks "Set title", a modal opens with a text input (max 100 chars)
   - Submit → ticket created with the title
   - Close/Skip → ticket created without a title
   - If the user ignores the ephemeral for **3 minutes**, the ticket is created automatically without a title

3. **Ticket appears in the private ticket channel** with:
   - Status line: `🔴 Open - not claimed` / `🟡 Claimed by @X` / `✅ Resolved by @X`
   - Buttons: **Claim** (or Unclaim) + **Mark Resolved** - or **Reopen** if closed
   - The ticket title (or the first 80 characters of the message if no title)
   - Author mention
   - Quoted description
   - **View in Slack** button (direct link to the thread)
   - Ticket number at the bottom

### Actions Available

| Where | Action | Who can do it |
|---|---|---|
| Help channel thread | Mark as resolved (button) | Ticket author, helpers, support team |
| Help channel thread | `?resolve` or `?close` macro | Helpers only |
| Help channel thread | `?faq` macro | Helpers only - posts FAQ link and resolves |
| Help channel thread | `?reopen` macro | Helpers only |
| Ticket channel | Claim / Unclaim | Helpers and support team |
| Ticket channel | Mark Resolved | Helpers and support team |
| Ticket channel | Reopen | Helpers and support team |
| Dashboard | Reply to thread | Helpers (appears as their name) |
| Dashboard | Mark Resolved | Helpers |

Thread macros are typed as the **first word** in a thread reply (e.g. `?resolve` - the message is automatically deleted after running).

### Status Updates

When a ticket is resolved or reopened, the message in the ticket channel is automatically updated with the new status and buttons. The help channel thread always gets a notification message.

Reactions on the original message: 🤔 = open, ✅ = resolved.

---

## Style Listening System

> ⚠️ Only works in channels where Pixorpheus has been added (private channels or channels it's a member of).

This system lets you train Pixorpheus's speaking style from real conversations.

### How to use

1. Type `pixo:kawaii` in a channel - Pixorpheus confirms it's watching
2. Talk normally in that channel - it collects all messages
3. Type `pixo:notkawaii` when done - Pixorpheus processes the messages and saves the style
4. From now on, the style notes are injected into every AI reply

Only one listening session can be active at a time. Minimum 5 messages needed to process.

### Check status

Type `pixo:kawaii?` anywhere - you'll get an ephemeral showing whether listening mode is on, which channel, and how many messages collected.

---

## Training Mode

A more explicit style training flow, available only in the designated training channel (`TRAINING_CHANNEL` env var, hardcoded as `C0BD7JSTQNM`).

| Command | Effect |
|---|---|
| `pixo:child labor training` | Start training mode - Pixorpheus watches every message in the channel |
| `pixo:stop child labor training` | Stop training - processes all collected messages and saves the style |

Requires at least 5 messages. The extracted style overwrites the previous style notes (same DB table as the listening system).

---

## Dashboard

A web dashboard for helpers and admins, running separately from the bot (`dashboard.js`). Available at https://dashboard.gabintavernier.com and if you need access, please DM me on Slack.

### Access

Login via Slack OAuth - only helpers (in the `helpers` DB table) and admins (`SLACK_ADMIN_USER_IDS`) can log in.

### Features

| Feature | Description |
|---|---|
| **Stats** | Total tickets, open count, resolved count, longest currently open ticket |
| **Activity chart** | Created vs resolved tickets over the last 30 days |
| **Leaderboard** | Top resolvers all-time, this week, and today |
| **Ticket list** | All tickets with search and status filter - click to open the thread |
| **Thread view** | Read the full Slack thread inline |
| **Reply** | Post a reply to any ticket thread (appears in Slack under your name) |
| **Resolve** | Mark a ticket as resolved directly from the dashboard |
| **Moderation DM** | Trigger a ban or warning DM from Pixorpheus to a Slack user |

The dashboard talks to the same PostgreSQL DB as the bot. Resolving from the dashboard posts a message in the Slack thread and updates the ticket channel message.

### Speak as Pixo (admin only)

Click the **"Pixl Support" logo 5 times** in a row to reveal a hidden panel. From there you can send any message as Pixorpheus — pick a channel, optionally a thread TS to reply in a thread, type your message, send. No one else can see or trigger this; the backend endpoint (`POST /api/speak`) is gated behind `requireAdmin` which checks `SLACK_ADMIN_USER_IDS`.

### Moderation DM

`POST /api/moderate/dm` (requires being logged in as a helper or admin, same as every other `/api/*` route) sends a DM from Pixorpheus to a given user.

```
POST /api/moderate/dm
Content-Type: application/json

{ "slackUserId": "U0123456789", "action": "ban" | "warning" }
```

Message wording lives in the `MODERATION_MESSAGES` object at the top of `dashboard.js`. There's no separate secret to configure, `requireAuth` already gates this behind the existing Slack OAuth session, same as the rest of the dashboard's API.

---

## Database

All tables are created automatically at startup via `initMemoryTables()` (except `tickets` and `helpers` which must be created manually).

| Table | Purpose |
|---|---|
| `user_memory` | Per-user fact arrays (JSONB) - up to 100 facts per person |
| `user_personality` | Per-user personality trait arrays (JSONB) |
| `program_memory` | Server-wide facts injected into every AI reply |
| `polls` | Active timed polls |
| `style_memory` | Speaking style notes (one active row) |
| `helpers` | Slack user IDs of support team members |
| `tickets` | All ticket records |

### `tickets` table columns

| Column | Type | Description |
|---|---|---|
| `msg_ts` | TEXT (PK) | Slack timestamp of the original help message |
| `ticket_msg_ts` | TEXT | Slack timestamp of the ticket channel message |
| `description` | TEXT | Full text of the original message |
| `title` | TEXT | Optional title set by the user |
| `status` | TEXT | `open` or `closed` |
| `opened_by_slack_id` | TEXT | Author of the original message |
| `claimed_by_slack_id` | TEXT | Helper who claimed the ticket |
| `closed_by_slack_id` | TEXT | Who resolved it |
| `closed_at` | TIMESTAMP | When it was resolved |
| `last_msg_at` | TIMESTAMP | Last activity in the thread |
| `permalink` | TEXT | Direct Slack link to the original message |
| `ticket_number` | INTEGER | Auto-incremented ticket number |

---

## Environment Variables

### Bot (`index.js`)

| Variable | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Slack bot OAuth token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | Slack app signing secret |
| `SLACK_HELP_CHANNEL` | Channel ID of the help channel where users post questions |
| `SLACK_TICKET_CHANNEL` | Channel ID of the private ticket channel for the support team |
| `SLACK_FAQ_URL` | URL to the FAQ (linked in the "Someone will be here soon!" message) |
| `SLACK_ADMIN_USER_IDS` | Comma-separated Slack user IDs of admins (bypass helper checks) |
| `SLACK_USER_TOKEN` | User token (`xoxp-...`) for deleting macro messages in threads |
| `DATABASE_URL` | PostgreSQL connection string |
| `HACKCLUB_AI_KEY` | Hack Club AI key (all main AI calls via `anthropic/claude-sonnet-5`) |
| `HC_AI_MODEL` | Override the Hack Club AI model (default: `anthropic/claude-sonnet-5`) |
| `ANTHROPIC_API_KEY` | Anthropic API key (DM replies via Haiku with web search) |
| `BRAVE_SEARCH_KEY` | Brave Search API key (auto web search in replies) |
| `GITHUB_NOTIFY_CHANNEL` | Slack channel ID where GitHub push/PR notifications are posted |
| `GITHUB_WEBHOOK_SECRET` | Secret used to verify GitHub webhook signatures |
| `PORT` | Port for the Bolt HTTP receiver (default 3000) |

### Dashboard (`dashboard.js`)

| Variable | Description |
|---|---|
| `SLACK_CLIENT_ID` | Slack app client ID (OAuth) |
| `SLACK_CLIENT_SECRET` | Slack app client secret (OAuth) |
| `DASHBOARD_URL` | Public URL of the dashboard (e.g. `https://dashboard.pixl.app`) |
| `SESSION_SECRET` | Secret for Express session cookies |
| `DASHBOARD_PORT` | Port for the dashboard server (default 4000) |

> The dashboard also uses `DATABASE_URL`, `SLACK_BOT_TOKEN`, and `SLACK_ADMIN_USER_IDS`.

---

## Deployment

Pixorpheus is deployed on **Railway** with two services sharing one PostgreSQL database:

- **Bot service** - runs `node index.js` - auto-deploys from GitHub pushes to `main`
- **Dashboard service** - runs `node dashboard.js` - same repo, different start command

The Slack app must have the following **event subscriptions** enabled:
- `message.channels`
- `message.groups`
- `message.im`
- `message.mpim`
- `reaction_added`
- `member_joined_channel`

And the following **slash commands** registered pointing to the bot's URL.

Both `index.js` and `dashboard.js` need to be running simultaneously for the full system to work.
