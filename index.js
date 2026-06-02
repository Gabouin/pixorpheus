const axios = require("axios");
require("dotenv").config();

const { App } = require("@slack/bolt");
const { Pool } = require("pg");

const db = new Pool({ connectionString: process.env.DATABASE_URL });

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true
});

app.event('message', async ({ event, client }) => {
  if (event.channel !== process.env.SLACK_HELP_CHANNEL) return;
  if (event.bot_id) return;

  const allowedSubtypes = ['file_share', 'me_message', 'thread_broadcast'];
  if (event.subtype && !allowedSubtypes.includes(event.subtype)) return;

  if (event.thread_ts) {
    await handleMessageInThread(event, client);
  } else {
    await handleNewQuestion(event, client);
  }
});

async function handleNewQuestion(event, client) {
  const text = event.text || '[no text]';

  await client.chat.postMessage({
    channel: process.env.SLACK_TICKET_CHANNEL,
    text: `Nouvelle question de <@${event.user}> : ${text}`,
  });

  await client.chat.postMessage({
    channel: event.channel,
    thread_ts: event.ts,
    text: "Quelqu'un va vous aider bientôt !",
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: "Quelqu'un va vous aider bientôt !" },
      },
      {
        type: 'actions',
        elements: [{
          type: 'button',
          text: { type: 'plain_text', text: 'Marquer comme résolu' },
          style: 'primary',
          action_id: 'mark_resolved',
          value: event.ts,
        }],
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
    `INSERT INTO tickets (msg_ts, description, status, opened_by_slack_id)
     VALUES ($1, $2, 'open', $3)`,
    [event.ts, text, event.user]
  );
} catch (e) {
  if (e.code === '23505') return; // ticket déjà créé, on ignore
  throw e;

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
  const result = await db.query(
    `SELECT 1 FROM helpers WHERE slack_user_id = $1 LIMIT 1`,
    [slackUserId]
  );
  return result.rows.length > 0;
}

const macros = {
  resolve: async (ticket, event, client) => {
    await resolveTicket(ticket.msg_ts, event.user, client);
  },
  faq: async (ticket, event, client) => {
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: ticket.msg_ts,
      text: `Hey ! Check the FAQ here : <${process.env.SLACK_FAQ_URL}|FAQ>`,
    });
    await resolveTicket(ticket.msg_ts, event.user, client);
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
      text: `\`?${name}\` n'est pas une macro valide.`,
    });
  }
}

app.action('mark_resolved', async ({ ack, body, client }) => {
  await ack();
  const msgTs = body.actions[0].value;
  const resolver = body.user.id;

  const ticket = await db.query(
    `SELECT opened_by_slack_id FROM tickets WHERE msg_ts = $1`, [msgTs]
  );
  if (!ticket.rows[0]) return;

  const isHelper = await checkIsHelper(resolver);
  const isAuthor = ticket.rows[0].opened_by_slack_id === resolver;

  if (!isHelper && !isAuthor) {
    await client.chat.postEphemeral({
      channel: process.env.SLACK_HELP_CHANNEL,
      thread_ts: msgTs,
      user: resolver,
      text: "Seul le créateur du ticket ou un helper peut marquer comme résolu.",
    });
    return;
  }

  await resolveTicket(msgTs, resolver, client);
});

app.action('reopen_ticket', async ({ ack, body, client }) => {
  await ack();
  const msgTs = body.actions[0].value;

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
    text: `Ticket reopened by <@${body.user.id}>.`,
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
});

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
    text: `Resolved by <@${resolverSlackId}>!`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `Resolved by <@${resolverSlackId}>!` },
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

app.command("/pixl-ping", async ({ command, ack, respond }) => {
  const start = Date.now();
  await ack();
  const latency = Date.now() - start;
  await respond({ text: `Pong!\nLatency: ${latency}ms` });
});

app.command("/pixl-help", async ({ ack, respond }) => {
  await ack();
  await respond({
    text:
`Available Commands:
/pixl-ping - Check bot latency
/pixl-help - Show this help message
/pixl-catfact - Get a cat fact
/pixl-joke - Get a random joke`
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
    await respond({
      text: `${response.data.setup}\n\n${response.data.punchline}`
    });
  } catch (err) {
    await respond({ text: "Failed to fetch a joke." });
  }
});

(async () => {
  await app.start();
  console.log("bot is running!");
})();
