// Shared #pixl-logs event logging, used by both the bot (index.js) and the dashboard.
// Resolves the channel once (create it if missing), then posts. Never throws —
// logging must not break the feature that triggered it.
const LOG_CHANNEL_NAME = 'pixl-logs';
let channelId = process.env.PIXL_LOGS_CHANNEL_ID || null;
let resolving = null;

async function resolveChannel(slack) {
  if (channelId) return channelId;
  if (resolving) return resolving;

  resolving = (async () => {
    let found = null, cursor;
    do {
      const page = await slack.conversations.list({ limit: 200, cursor, types: 'public_channel', exclude_archived: true });
      found = page.channels?.find(c => c.name === LOG_CHANNEL_NAME);
      cursor = found ? null : page.response_metadata?.next_cursor;
    } while (!found && cursor);

    if (found) {
      channelId = found.id;
      if (!found.is_member) {
        try { await slack.conversations.join({ channel: channelId }); } catch (_) {}
      }
    } else {
      const created = await slack.conversations.create({ name: LOG_CHANNEL_NAME });
      channelId = created.channel.id;
      console.log(`[pixl-logs] created #${LOG_CHANNEL_NAME} (${channelId})`);
    }
    return channelId;
  })();

  try {
    return await resolving;
  } finally {
    resolving = null;
  }
}

async function logEvent(slack, text) {
  try {
    const channel = await resolveChannel(slack);
    await slack.chat.postMessage({ channel, text, unfurl_links: false });
  } catch (e) {
    const scope = e.data?.needed ? ` (missing scope: ${e.data.needed})` : '';
    console.error(`[pixl-logs] failed to log: ${e.data?.error || e.message}${scope}`);
  }
}

module.exports = { logEvent };
