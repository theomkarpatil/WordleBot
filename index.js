require('dotenv').config();

const { App, ExpressReceiver } = require('@slack/bolt');

// Use ExpressReceiver so we can add custom routes
const receiver = new ExpressReceiver({
  signingSecret: process.env.SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// Cache bot user ID to avoid responding to own messages
let botUserId;

// Cache replies fetched from Google Sheet
let replies = {};

// 🛡️ Dedupe to avoid responding multiple times to the same message
// (Slack can deliver the same event more than once; also protects against accidental double-processing)
const processedMessageKeys = new Map(); // key -> expiresAtMs
const DEDUPE_TTL_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, expiresAt] of processedMessageKeys.entries()) {
    if (expiresAt <= now) processedMessageKeys.delete(key);
  }
}, 60 * 1000).unref?.();

const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTq962wlfriHfnwYdfL6b_zjA1u8YoXA1IbW3YGE5vstCckHbdU4DFFQdNq2WZJGWfGKYHQ7qD_ApAs/pub?gid=0&single=true&output=csv';

// 📥 Fetch and parse replies from Google Sheet CSV
async function loadReplies() {
  try {
    const res = await fetch(SHEET_CSV_URL);
    const text = await res.text();

    const rows = text.trim().split('\n').map(row => {
      // Handle quoted CSV fields (e.g. fields containing commas)
      const fields = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < row.length; i++) {
        const char = row[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          fields.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      fields.push(current.trim());
      return fields;
    });

    // First row is headers: 1, 2, 3, 4, 5, 6
    const headers = rows[0].map(h => parseInt(h.trim(), 10));
    const newReplies = {};

    headers.forEach((score, colIndex) => {
      if (isNaN(score)) return;
      newReplies[score] = [];
      for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
        const cell = rows[rowIndex][colIndex];
        if (cell && cell.length > 0) {
          newReplies[score].push(cell);
        }
      }
    });

    // Score 7 = X/6 (failed), keep hardcoded
    newReplies[7] = ['💀'];

    replies = newReplies;
    console.log('✅ Replies loaded from Google Sheet');
  } catch (err) {
    console.error('❌ Failed to load replies from sheet:', err);
  }
}

// ✅ fix: ignore Slack retry requests (caused duplicate replies on slow cold starts)
receiver.router.use((req, res, next) => {
  if (req.headers['x-slack-retry-num']) {
    return res.status(200).send('OK');
  }
  next();
});

// 🔢 Parse Wordle score
function parseWordle(text) {
  const match = text.match(/Wordle\s+[\d,]+\s+(X|\d)\/6/); // ✅ fix: allow commas in puzzle number
  if (!match) return null;
  return match[1] === 'X' ? 7 : parseInt(match[1], 10);
}

// 📊 Generate leaderboard from today
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
    return "*📊 Wordle Leaderboard*\n\nNo scores recorded today!";
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

// 🎯 Handle Wordle messages
app.message(async ({ message, client }) => {
  try {
    if (message.subtype || !message.text) return;
    if (message.user === botUserId) return; // ✅ fix: skip own messages
    if (message.thread_ts) return;

    const messageKey = `${message.channel}:${message.user}:${message.ts}`;
    const now = Date.now();
    const existingExpiry = processedMessageKeys.get(messageKey);
    if (existingExpiry && existingExpiry > now) return;
    processedMessageKeys.set(messageKey, now + DEDUPE_TTL_MS);

    const score = parseWordle(message.text);
    if (!score) return;

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

// 🏓 Keep-alive ping — hit this every 10-14 mins via cron-job.org
receiver.router.get('/ping', (req, res) => {
  res.json({ ok: true });
});

// 🔄 Reload replies from sheet on demand — useful after editing the sheet
// GET: https://your-app.onrender.com/reload-replies?secret=YOUR_SECRET
receiver.router.get('/reload-replies', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.query.secret !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  await loadReplies();
  res.json({ ok: true, scores: Object.fromEntries(Object.entries(replies).map(([k, v]) => [k, v.length])) });
});

// 🕛 HTTP endpoint triggered by an external cron service (e.g. cron-job.org)
// Set up a daily cron job to GET: https://your-app.onrender.com/post-leaderboard?secret=YOUR_SECRET
// Schedule it for 11:59 PM in your timezone.
//
// Required env vars:
//   WORDLE_CHANNEL_ID — the Slack channel ID to post the leaderboard in
//   CRON_SECRET      — a secret token to protect this endpoint
receiver.router.get('/post-leaderboard', async (req, res) => {
  const secret = process.env.CRON_SECRET;

  if (secret && req.query.secret !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const channelId = process.env.WORDLE_CHANNEL_ID;
  if (!channelId) {
    return res.status(500).json({ error: 'WORDLE_CHANNEL_ID env var not set' });
  }

  // ✅ fix: respond immediately so cron-job.org doesn't time out on cold starts
  res.json({ ok: true });

  // ✅ fix: post to Slack in the background after responding
  try {
    const leaderboard = await generateLeaderboard(channelId);
    const leaderboardMessage = formatLeaderboard(leaderboard);
    await app.client.chat.postMessage({
      channel: channelId,
      text: leaderboardMessage,
    });
  } catch (err) {
    console.error("Leaderboard post error:", err);
  }
});

// 🚀 Start app
(async () => {
  await app.start(process.env.PORT || 3000);
  const auth = await app.client.auth.test();
  botUserId = auth.user_id; // ✅ cache bot user ID at startup
  console.log(`⚡ Wordle bot running as ${botUserId}`);
  await loadReplies(); // 📥 load replies from Google Sheet on startup
})();