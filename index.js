require('dotenv').config();

const { App, ExpressReceiver } = require('@slack/bolt');

const receiver = new ExpressReceiver({
  signingSecret: process.env.SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// 🧠 Cache bot user ID
let botUserId;

// 🧠 Track processed messages to avoid duplicates
const processedMessages = new Set();

// ✅ Ignore Slack retry requests early
receiver.router.use((req, res, next) => {
  if (req.headers['x-slack-retry-num']) {
    return res.status(200).send('OK');
  }
  next();
});

// 🔢 Parse Wordle score
function parseWordle(text) {
  const match = text.match(/Wordle\s+[\d,]+\s+(X|\d)\/6/);
  if (!match) return null;
  return match[1] === 'X' ? 7 : parseInt(match[1], 10);
}

// 📊 Generate leaderboard
async function generateLeaderboard(channelId) {
  const result = await app.client.conversations.history({
    channel: channelId,
    limit: 200,
  });

  const scores = {};

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const midnightTs = todayStart.getTime() / 1000;

  for (const msg of result.messages) {
    if (!msg.text || !msg.user) continue;
    if (parseFloat(msg.ts) < midnightTs) continue;

    const score = parseWordle(msg.text);
    if (!score) continue;

    const user = msg.user;

    if (!scores[user] || score < scores[user]) {
      scores[user] = score;
    }
  }

  return Object.entries(scores).sort((a, b) => a[1] - b[1]);
}

// 🧾 Format leaderboard
function formatLeaderboard(data) {
  if (data.length === 0) {
    return "*📊 Wordle Leaderboard*\n\nNo scores recorded in the last 24 hours!";
  }

  let text = "*📊 Wordle Leaderboard*\n\n";

  let rank = 1;
  data.forEach(([user, score], i) => {
    if (i > 0 && score !== data[i - 1][1]) {
      rank = i + 1;
    }

    const medal =
      rank === 1 ? "🥇" :
      rank === 2 ? "🥈" :
      rank === 3 ? "🥉" : `${rank}.`;

    const displayScore = score === 7 ? "X" : score;
    text += `${medal} <@${user}> — ${displayScore}/6\n`;
  });

  return text;
}

// 🎯 Replies (unchanged)
const replies = { /* keep your existing replies object exactly as is */ };

// 🎯 Handle Wordle messages
app.message(async ({ message, client }) => {
  try {
    if (!message || !message.ts) return;

    // 🚫 Deduplicate events
    if (processedMessages.has(message.ts)) return;
    processedMessages.add(message.ts);

    // 🧹 Cleanup after 60s
    setTimeout(() => processedMessages.delete(message.ts), 60000);

    // 🚫 Ignore unwanted message types
    if (message.subtype === 'bot_message') return;
    if (message.subtype === 'message_changed') return;
    if (message.edited) return;

    if (!message.text) return;
    if (message.user === botUserId) return;
    if (message.thread_ts) return;

    const score = parseWordle(message.text);
    if (!score) return;

    // 🎲 Pick random reply
    const options = replies[score];
    if (!options || options.length === 0) return;

    const reply = options[Math.floor(Math.random() * options.length)];

    await client.chat.postMessage({
      channel: message.channel,
      text: reply,
      thread_ts: message.ts,
    });

  } catch (err) {
    console.error("Message handler error:", err);
  }
});

// 🏓 Keep-alive endpoint
receiver.router.get('/ping', (req, res) => {
  res.json({ ok: true });
});

// 🕛 Leaderboard cron endpoint
receiver.router.get('/post-leaderboard', async (req, res) => {
  const secret = process.env.CRON_SECRET;

  if (secret && req.query.secret !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const channelId = process.env.WORDLE_CHANNEL_ID;
  if (!channelId) {
    return res.status(500).json({ error: 'WORDLE_CHANNEL_ID env var not set' });
  }

  try {
    const leaderboard = await generateLeaderboard(channelId);
    const leaderboardMessage = formatLeaderboard(leaderboard);

    await app.client.chat.postMessage({
      channel: channelId,
      text: leaderboardMessage,
    });

    res.json({ ok: true, entries: leaderboard.length });
  } catch (err) {
    console.error("Leaderboard post error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🚀 Start app
(async () => {
  await app.start(process.env.PORT || 3000);

  const auth = await app.client.auth.test();
  botUserId = auth.user_id;

  console.log(`⚡ Wordle bot running as ${botUserId}`);
})();