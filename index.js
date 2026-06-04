const axios = require("axios");
const Jimp = require("jimp");
require("dotenv").config();

const { App } = require("@slack/bolt");
const { Pool } = require("pg");

const db = new Pool({ connectionString: process.env.DATABASE_URL });

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

app.event('message', async ({ event, client }) => {
  const isHelpChannel = event.channel === process.env.SLACK_HELP_CHANNEL;
  const isTicketChannel = event.channel === process.env.SLACK_TICKET_CHANNEL;

  if (!isHelpChannel && !isTicketChannel) return;
  if (event.bot_id) return;

  const allowedSubtypes = ['file_share', 'me_message', 'thread_broadcast'];
  if (event.subtype && !allowedSubtypes.includes(event.subtype)) return;

  if (isHelpChannel) {
    if (event.thread_ts) {
      await handleMessageInThread(event, client);
    } else {
      await handleNewQuestion(event, client);
    }
  }
});

async function handleNewQuestion(event, client) {
  const text = event.text || '[no text — see thread for attachments]';

  const ticketMsg = await client.chat.postMessage({
    channel: process.env.SLACK_TICKET_CHANNEL,
    text: `New question from <@${event.user}>`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*New ticket from <@${event.user}>*\n>${text}` }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Resolve from here' },
            style: 'primary',
            action_id: 'resolve_from_ticket_channel',
            value: event.ts,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'View thread' },
            action_id: 'view_thread',
            url: `https://slack.com/app_redirect?channel=${event.channel}&message_ts=${event.ts}`,
          }
        ]
      }
    ]
  });

  await client.chat.postMessage({
    channel: event.channel,
    thread_ts: event.ts,
    text: "Someone will be here to help you soon!",
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Someone will be here to help you soon! In the meantime, check out the <${process.env.SLACK_FAQ_URL}|FAQ>.`
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Mark as resolved' },
            style: 'primary',
            action_id: 'mark_resolved',
            value: event.ts,
          }
        ],
      },
    ],
  });

  try {
    await client.reactions.add({
      channel: event.channel,
      name: 'thinking_face',
      timestamp: event.ts,
    });
  } catch (e) {}

  try {
    await db.query(
      `INSERT INTO tickets (msg_ts, ticket_msg_ts, description, status, opened_by_slack_id)
       VALUES ($1, $2, $3, 'open', $4)`,
      [event.ts, ticketMsg.ts, text, event.user]
    );
  } catch (e) {
    if (e.code === '23505') return;
    throw e;
  }
}

async function handleMessageInThread(event, client) {
  const ticket = await db.query(
    `SELECT * FROM tickets WHERE msg_ts = $1`, [event.thread_ts]
  );
  if (!ticket.rows[0]) return;

  const isHelper = await checkIsHelper(event.user);
  const text = event.text || '';
  const firstWord = text.trim().split(/\s+/)[0]?.toLowerCase();

  if (isHelper && firstWord?.startsWith('?')) {
    await runMacro(firstWord.slice(1), ticket.rows[0], event, client);
    return;
  }

  await db.query(
    `UPDATE tickets SET last_msg_at = NOW() WHERE msg_ts = $1`,
    [event.thread_ts]
  );
}

async function checkIsHelper(slackUserId) {
  const admins = (process.env.SLACK_ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (admins.includes(slackUserId)) return true;
  const result = await db.query(
    `SELECT 1 FROM helpers WHERE slack_user_id = $1 LIMIT 1`,
    [slackUserId]
  );
  return result.rows.length > 0;
}

async function checkIsInTicketChannel(slackUserId, client) {
  try {
    let cursor;
    do {
      const result = await client.conversations.members({
        channel: process.env.SLACK_TICKET_CHANNEL,
        limit: 200,
        cursor,
      });
      if (result.members.includes(slackUserId)) return true;
      cursor = result.response_metadata?.next_cursor;
    } while (cursor);
    return false;
  } catch (e) {
    return false;
  }
}

const macros = {
  resolve: async (ticket, event, client) => {
    await resolveTicket(ticket.msg_ts, event.user, client);
  },
  close: async (ticket, event, client) => {
    await resolveTicket(ticket.msg_ts, event.user, client);
  },
  faq: async (ticket, event, client) => {
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: ticket.msg_ts,
      text: `Hey! Check out the FAQ here: <${process.env.SLACK_FAQ_URL}|FAQ>`,
    });
    await resolveTicket(ticket.msg_ts, event.user, client);
  },
  reopen: async (ticket, event, client) => {
    await reopenTicket(ticket.msg_ts, event.user, client);
  },
};

async function runMacro(name, ticket, event, client) {
  if (macros[name]) {
    await macros[name](ticket, event, client);
    try {
      await client.chat.delete({
        channel: event.channel,
        ts: event.ts,
        token: process.env.SLACK_USER_TOKEN,
      });
    } catch (e) {}
  } else {
    await client.chat.postEphemeral({
      channel: event.channel,
      thread_ts: ticket.msg_ts,
      user: event.user,
      text: `\`?${name}\` is not a valid macro. Available: \`?resolve\`, \`?faq\`, \`?reopen\``,
    });
  }
}

async function resolveTicket(msgTs, resolverSlackId, client) {
  const check = await db.query(
    `SELECT status FROM tickets WHERE msg_ts = $1`, [msgTs]
  );
  if (!check.rows[0] || check.rows[0].status === 'closed') return;

  await db.query(
    `UPDATE tickets SET status = 'closed', closed_at = NOW(),
     closed_by_slack_id = $1 WHERE msg_ts = $2`,
    [resolverSlackId, msgTs]
  );

  await client.chat.postMessage({
    channel: process.env.SLACK_HELP_CHANNEL,
    thread_ts: msgTs,
    text: `Ticket resolved by <@${resolverSlackId}>!`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `Resolved by <@${resolverSlackId}>! If you have more questions, feel free to open a new thread.` },
      },
      {
        type: 'actions',
        elements: [{
          type: 'button',
          action_id: 'reopen_ticket',
          text: { type: 'plain_text', text: 'Reopen' },
          value: msgTs,
        }],
      },
    ],
  });

  const ticket = await db.query(
    `SELECT ticket_msg_ts FROM tickets WHERE msg_ts = $1`, [msgTs]
  );
  if (ticket.rows[0]?.ticket_msg_ts) {
    try {
      await client.chat.update({
        channel: process.env.SLACK_TICKET_CHANNEL,
        ts: ticket.rows[0].ticket_msg_ts,
        text: `Ticket resolved by <@${resolverSlackId}>`,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Ticket resolved by <@${resolverSlackId}>*` }
          }
        ]
      });
    } catch (e) {}
  }

  try {
    await client.reactions.add({
      channel: process.env.SLACK_HELP_CHANNEL,
      name: 'white_check_mark',
      timestamp: msgTs,
    });
  } catch (e) {}

  try {
    await client.reactions.remove({
      channel: process.env.SLACK_HELP_CHANNEL,
      name: 'thinking_face',
      timestamp: msgTs,
    });
  } catch (e) {}
}

async function reopenTicket(msgTs, reopenerSlackId, client) {
  const check = await db.query(
    `SELECT status FROM tickets WHERE msg_ts = $1`, [msgTs]
  );
  if (!check.rows[0] || check.rows[0].status === 'open') return;

  await db.query(
    `UPDATE tickets SET status = 'open', closed_at = NULL,
     closed_by_slack_id = NULL WHERE msg_ts = $1`,
    [msgTs]
  );

  await client.chat.postMessage({
    channel: process.env.SLACK_HELP_CHANNEL,
    thread_ts: msgTs,
    text: `Ticket reopened by <@${reopenerSlackId}>.`,
  });

  try {
    await client.reactions.add({
      channel: process.env.SLACK_HELP_CHANNEL,
      name: 'thinking_face',
      timestamp: msgTs,
    });
  } catch (e) {}

  try {
    await client.reactions.remove({
      channel: process.env.SLACK_HELP_CHANNEL,
      name: 'white_check_mark',
      timestamp: msgTs,
    });
  } catch (e) {}
}

app.action('mark_resolved', async ({ ack, body, client }) => {
  await ack();
  const msgTs = body.actions[0].value;
  const resolver = body.user.id;
  const channelId = body.channel.id;

  let ticket;
  try {
    const result = await db.query(
      `SELECT opened_by_slack_id FROM tickets WHERE msg_ts = $1`, [msgTs]
    );
    ticket = result.rows[0];
  } catch (e) {
    await client.chat.postEphemeral({ channel: channelId, thread_ts: msgTs, user: resolver, text: "Database error — could not load the ticket." });
    return;
  }

  if (!ticket) {
    await client.chat.postEphemeral({ channel: channelId, thread_ts: msgTs, user: resolver, text: "No ticket found for this message." });
    return;
  }

  const isHelper = await checkIsHelper(resolver);
  const isAuthor = ticket.opened_by_slack_id === resolver;
  const isInTicketChannel = await checkIsInTicketChannel(resolver, client);

  if (!isHelper && !isAuthor && !isInTicketChannel) {
    await client.chat.postEphemeral({
      channel: channelId,
      thread_ts: msgTs,
      user: resolver,
      text: "Only the ticket author, a helper, or a support team member can mark this as resolved.",
    });
    return;
  }

  await resolveTicket(msgTs, resolver, client);
});

app.action('resolve_from_ticket_channel', async ({ ack, body, client }) => {
  await ack();
  const msgTs = body.actions[0].value;
  const resolver = body.user.id;
  const channelId = body.channel.id;

  const isInTicketChannel = await checkIsInTicketChannel(resolver, client);
  const isHelper = await checkIsHelper(resolver);

  if (!isHelper && !isInTicketChannel) {
    await client.chat.postEphemeral({
      channel: channelId,
      user: resolver,
      text: "Only support team members can resolve tickets from here.",
    });
    return;
  }

  await resolveTicket(msgTs, resolver, client);
});

app.action('reopen_ticket', async ({ ack, body, client }) => {
  await ack();
  const msgTs = body.actions[0].value;
  const reopener = body.user.id;
  const channelId = body.channel.id;

  const isHelper = await checkIsHelper(reopener);
  const isInTicketChannel = await checkIsInTicketChannel(reopener, client);

  if (!isHelper && !isInTicketChannel) {
    await client.chat.postEphemeral({
      channel: channelId,
      thread_ts: msgTs,
      user: reopener,
      text: "Only helpers or support team members can reopen tickets.",
    });
    return;
  }

  await reopenTicket(msgTs, reopener, client);
});

app.action('view_thread', async ({ ack }) => { await ack(); });

app.command("/pixl-ping", async ({ ack, respond }) => {
  const start = Date.now();
  await ack();
  await respond({ text: `Pong! Latency: ${Date.now() - start}ms` });
});

app.command("/pixl-help", async ({ ack, respond }) => {
  await ack();
  await respond({
    text: `*Pixl Bot Commands*\n
*/pixl [@user]* — Pixelate a user's profile picture
*/pixl-ping* — Check bot latency
*/pixl-help* — Show this help message
*/pixl-catfact* — Get a random cat fact
*/pixl-joke* — Get a random joke
*/pixl-8ball [question]* — Ask the magic 8-ball
*/pixl-coinflip* — Flip a coin
*/pixl-roll [NdN]* — Roll dice (e.g. /pixl-roll 2d6)
*/pixl-addhelper [@user]* — Add a helper (support team only)
*/pixl-removehelper [@user]* — Remove a helper (support team only)
*/pixl-helpers* — List all helpers
*/pixl-stats* — Show ticket stats`
  });
});

app.command("/pixl-catfact", async ({ ack, respond }) => {
  await ack();
  try {
    const response = await axios.get("https://catfact.ninja/fact");
    await respond({ text: `Cat Fact:\n${response.data.fact}` });
  } catch (err) {
    await respond({ text: "Failed to fetch a cat fact." });
  }
});

app.command("/pixl-joke", async ({ ack, respond }) => {
  await ack();
  try {
    const response = await axios.get("https://official-joke-api.appspot.com/random_joke");
    await respond({ text: `${response.data.setup}\n\n${response.data.punchline}` });
  } catch (err) {
    await respond({ text: "Failed to fetch a joke." });
  }
});

app.command("/pixl-8ball", async ({ command, ack, respond }) => {
  await ack();
  const answers = [
    "It is certain.", "It is decidedly so.", "Without a doubt.", "Yes, definitely.",
    "You may rely on it.", "As I see it, yes.", "Most likely.", "Outlook good.",
    "Yes.", "Signs point to yes.", "Reply hazy, try again.", "Ask again later.",
    "Better not tell you now.", "Cannot predict now.", "Concentrate and ask again.",
    "Don't count on it.", "My reply is no.", "My sources say no.",
    "Outlook not so good.", "Very doubtful."
  ];
  const question = command.text?.trim();
  if (!question) {
    await respond({ text: "Please ask a question. Usage: `/pixl-8ball will it rain today?`" });
    return;
  }
  await respond({ text: `*${question}*\n\n_${answers[Math.floor(Math.random() * answers.length)]}_` });
});

app.command("/pixl-coinflip", async ({ ack, respond }) => {
  await ack();
  await respond({ text: `Coin flip: ${Math.random() < 0.5 ? "Heads" : "Tails"}` });
});

app.command("/pixl-roll", async ({ command, ack, respond }) => {
  await ack();
  const input = command.text?.trim() || '1d6';
  const match = input.match(/^(\d+)d(\d+)$/i);
  if (!match) {
    await respond({ text: "Usage: `/pixl-roll 2d6`" });
    return;
  }
  const count = Math.min(parseInt(match[1]), 20);
  const sides = Math.min(parseInt(match[2]), 1000);
  const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
  await respond({ text: `Rolling ${count}d${sides}: ${rolls.join(', ')} — *Total: ${rolls.reduce((a, b) => a + b, 0)}*` });
});

app.command("/pixl-addhelper", async ({ command, ack, respond, client }) => {
  await ack();
  const requesterId = command.user_id;
  const isAdmin = await checkIsHelper(requesterId);
  const isInTicketChannel = await checkIsInTicketChannel(requesterId, client);

  if (!isAdmin && !isInTicketChannel) {
    await respond({ text: "Only support team members can add helpers. To bootstrap, add your Slack user ID to `SLACK_ADMIN_USER_IDS`." });
    return;
  }

  const mention = command.text?.trim();
  const userId = mention?.match(/<@([A-Z0-9]+)(?:\|[^>]+)?>/)?.[1] || mention;

  if (!userId) {
    await respond({ text: "Usage: `/pixl-addhelper @username`" });
    return;
  }

  try {
    await db.query(`INSERT INTO helpers (slack_user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
    await respond({ text: `<@${userId}> is now a helper.` });
  } catch (e) {
    await respond({ text: "Failed to add helper." });
  }
});

app.command("/pixl-removehelper", async ({ command, ack, respond, client }) => {
  await ack();
  const requesterId = command.user_id;
  const isInTicketChannel = await checkIsInTicketChannel(requesterId, client);
  const isHelper = await checkIsHelper(requesterId);

  if (!isHelper && !isInTicketChannel) {
    await respond({ text: "Only support team members can remove helpers." });
    return;
  }

  const mention = command.text?.trim();
  const userId = mention?.match(/<@([A-Z0-9]+)(?:\|[^>]+)?>/)?.[1] || mention;

  if (!userId) {
    await respond({ text: "Usage: `/pixl-removehelper @username`" });
    return;
  }

  await db.query(`DELETE FROM helpers WHERE slack_user_id = $1`, [userId]);
  await respond({ text: `<@${userId}> is no longer a helper.` });
});

app.command("/pixl-helpers", async ({ ack, respond }) => {
  await ack();
  const result = await db.query(`SELECT slack_user_id FROM helpers`);
  if (result.rows.length === 0) {
    await respond({ text: "No helpers registered yet." });
    return;
  }
  await respond({ text: `*Current helpers:*\n${result.rows.map(r => `• <@${r.slack_user_id}>`).join('\n')}` });
});

app.command("/pixl-stats", async ({ ack, respond }) => {
  await ack();
  const [total, open, closed] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM tickets`),
    db.query(`SELECT COUNT(*) FROM tickets WHERE status = 'open'`),
    db.query(`SELECT COUNT(*) FROM tickets WHERE status = 'closed'`),
  ]);
  await respond({
    text: `*Ticket Stats*\n• Total: ${total.rows[0].count}\n• Open: ${open.rows[0].count}\n• Resolved: ${closed.rows[0].count}`
  });
});

app.command("/pixl", async ({ command, ack, client }) => {
  await ack();

  const mention = command.text?.trim();
  let targetId = command.user_id;

  if (mention) {
    const fromMention = mention.match(/<@([A-Za-z0-9]+)/)?.[1];
    if (fromMention) {
      targetId = fromMention;
    } else {
      const username = mention.replace(/^@/, '').toLowerCase();
      let found = null, cursor;
      try {
        do {
          const page = await client.users.list({ limit: 200, cursor });
          found = page.members?.find(m =>
            m.name?.toLowerCase() === username ||
            m.profile?.display_name?.toLowerCase() === username
          );
          cursor = found ? null : page.response_metadata?.next_cursor;
        } while (!found && cursor);
      } catch (e) {
        await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: `User lookup failed: ${e.message}` });
        return;
      }
      if (!found) {
        await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: `User "${mention}" not found. Try selecting from the @mention dropdown.` });
        return;
      }
      targetId = found.id;
    }
  }

  try {
    const result = await client.users.info({ user: targetId });
    const avatarUrl = result.user.profile.image_512 || result.user.profile.image_192 || result.user.profile.image_72;

    if (!avatarUrl) {
      await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: "No profile picture found." });
      return;
    }

    const image = await Jimp.read(avatarUrl);
    const w = image.getWidth();
    const h = image.getHeight();
    const pixelSize = 16;

    image
      .resize(Math.max(1, Math.floor(w / pixelSize)), Math.max(1, Math.floor(h / pixelSize)), Jimp.RESIZE_NEAREST_NEIGHBOR)
      .resize(w, h, Jimp.RESIZE_NEAREST_NEIGHBOR);

    const buffer = await image.getBufferAsync(Jimp.MIME_PNG);

    const uploadResult = await client.files.uploadV2({
      channel_id: command.channel_id,
      file: buffer,
      filename: `pixl-${targetId}.png`,
      initial_comment: `<@${targetId}> pixelated!`,
    });

    const fileId = uploadResult?.files?.[0]?.files?.[0]?.id;

    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: "Sent!",
      blocks: fileId ? [{
        type: 'actions',
        elements: [{
          type: 'button',
          text: { type: 'plain_text', text: 'Delete it' },
          style: 'danger',
          action_id: 'delete_pixl',
          value: fileId,
        }]
      }] : undefined,
    });
  } catch (e) {
    const detail = e.data?.needed ? `missing scope: ${e.data.needed}` : e.message;
    await client.chat.postEphemeral({ channel: command.channel_id, user: command.user_id, text: `Failed: ${detail}` });
  }
});

app.action('delete_pixl', async ({ ack, body, client }) => {
  await ack();
  const fileId = body.actions[0].value;
  const channelId = body.channel.id;

  let msgTs;
  try {
    const info = await client.files.info({ file: fileId });
    const shares = info.file?.shares?.public?.[channelId]
                || info.file?.shares?.private?.[channelId];
    msgTs = shares?.[0]?.ts;
  } catch (_) {}

  try { await client.files.delete({ file: fileId }); } catch (_) {}
  if (msgTs) {
    try { await client.chat.delete({ channel: channelId, ts: msgTs }); } catch (_) {}
  }
});

const shortFallbacks = ['k', 'hm', 'yeah', '?', 'lol ok', 'sure', 'mm'];

async function getAIReply(history) {
  try {
    const res = await axios.post(
      'https://ai.hackclub.com/proxy/v1/chat/completions',
      {
        model: 'meta-llama/llama-3.1-8b-instruct',
        messages: [
          {
            role: 'system',
            content: `You are Pixorpheus, a person in a Slack workspace. Reply like a real human would in a text message — short, lowercase, no punctuation if it feels unnatural. Never say things like "certainly", "of course", "great question", "I understand", "as an AI", "I'd be happy", "it seems", or any phrase that sounds like a chatbot. No lists, no markdown, no structure. If someone asks a real question give the actual answer in one sentence. Otherwise just react naturally like a person would. Max 2 sentences.`,
          },
          ...history,
        ],
        max_tokens: 80,
      },
      { headers: { Authorization: `Bearer ${process.env.HACKCLUB_AI_KEY}`, 'Content-Type': 'application/json' } }
    );
    const content = res.data.choices?.[0]?.message?.content
      ?.replace(/<think>[\s\S]*?<\/think>/gi, '')
      ?.replace(/^skip\s*\n?/i, '')
      ?.trim();
    if (content) return content;
  } catch (e) {
    console.error('AI error:', e.response?.data || e.message);
  }
  return shortFallbacks[Math.floor(Math.random() * shortFallbacks.length)];
}

let botUserId, botAppId;
const activeThreads = new Map(); // threadKey -> lastActiveAt ms
const pendingReplies = new Map();
const threadHistory = new Map();
const THREAD_TTL = 2 * 60 * 60 * 1000; // 2 hours

app.message(async ({ message, client }) => {
  if (message.bot_id && message.bot_id === botAppId) return;
  if (message.subtype && message.subtype !== 'bot_message') return;
  const text = message.text || '';

  const mentionsBot = text.toLowerCase().includes('pixorpheus') ||
                      (botUserId && text.includes(`<@${botUserId}>`));
  const threadKey = message.thread_ts || message.ts;
  const lastActive = message.thread_ts && activeThreads.get(message.thread_ts);
  const inActiveThread = lastActive && (Date.now() - lastActive < THREAD_TTL);

  if (!mentionsBot && !inActiveThread) return;
  activeThreads.set(threadKey, Date.now());

  if (!pendingReplies.has(threadKey)) {
    pendingReplies.set(threadKey, { messages: [], channel: message.channel });
  }
  const pending = pendingReplies.get(threadKey);
  pending.messages.push(text);
  clearTimeout(pending.timer);

  pending.timer = setTimeout(async () => {
    try {
      const entry = pendingReplies.get(threadKey);
      if (!entry) return;
      pendingReplies.delete(threadKey);

      if (!threadHistory.has(threadKey)) threadHistory.set(threadKey, []);
      const history = threadHistory.get(threadKey);
      history.push({ role: 'user', content: entry.messages.join('\n') });

      const reply = await getAIReply(history.slice(-10));
      if (reply) {
        history.push({ role: 'assistant', content: reply });
        await client.chat.postMessage({ channel: entry.channel, thread_ts: threadKey, text: reply });
      }
    } catch (e) {
      console.error('bot reply error:', e.message);
    }
  }, 1000);
});

(async () => {
  await app.start(process.env.PORT || 3000);
  try {
    const auth = await app.client.auth.test();
    botUserId = auth.user_id;
    botAppId = auth.bot_id;
  } catch (_) {}
  console.log("Pixl bot is running.");
})();
