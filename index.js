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

// 🔢 Parse Wordle score
function parseWordle(text) {
    const match = text.match(/wordle.*?\b(X|\d)\/6\b/i);
    if (!match) return null;

    return match[1] === 'X' ? 7 : parseInt(match[1], 10);
}

// 📊 Generate leaderboard from the last 24 hours
async function generateLeaderboard(channelId) {
  const result = await app.client.conversations.history({
    channel: channelId,
    limit: 200,
  });

  const scores = {};

  // Only include messages from today (midnight onwards)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const midnightTs = todayStart.getTime() / 1000;

  for (const msg of result.messages) {
    if (parseFloat(msg.ts) < midnightTs) continue;

    const score = parseWordle(msg.text);
    if (!score) continue;

    const user = msg.user;

    // Keep best (lowest) score per user
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

  data.forEach(([user, score], i) => {
    const rank = i + 1;
    const medal =
      rank === 1 ? "🥇" :
      rank === 2 ? "🥈" :
      rank === 3 ? "🥉" : `${rank}.`;

    const displayScore = score === 7 ? "X" : score;
    text += `${medal} <@${user}> — ${displayScore}/6\n`;
  });

  return text;
}

// 🎯 Random replies
const replies = {
  1: [
    "No. F***ing. Way!",
    "What is the GOD mode sh*t you're doing?",
    "People, I think it's time we quit!"
  ],
  2: [
    "Oh bullS*******t",
    "Chal ae ae ae, kuch bhi, cheating mat kar!",
    "Bhai sahaaaaaab!"
  ],
  3: [
    "Lezzz goooooo!",
    "Dayammnnnnn bro!",
    "Wow, someone's having a good morning!"
  ],
  4: [
    "Cute!",
    "Ohhhhh noice!",
    "Isko award do koi!!"
  ],
  5: [
    "You got this bro!",
    "Hmmmm, sh*t happens!",
    "Boy, that's rough!"
  ],
  6: [
    "Ouch, that... yeah, that hurts",
    "Aaaii gaaaaaa!! 💀",
    "Do you need a hug bro?"
  ],
  7: ["💀"]
};

// 🎯 Handle Wordle messages
app.message(async ({ message, client }) => {
  try {
    if (message.subtype || !message.text) return;
    if (message.thread_ts) return;

    const score = parseWordle(message.text);
    if (!score) return;

    // 🎲 Reply with a random reaction
    const options = replies[score];
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
  console.log("⚡ Wordle bot running");
})();