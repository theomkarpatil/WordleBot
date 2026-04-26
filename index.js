require('dotenv').config();

const { App } = require('@slack/bolt');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SIGNING_SECRET,
});

// 🔢 Parse Wordle score
function parseWordle(text) {
  const match = text.match(/Wordle\s+\d+\s+(X|\d)\/6/);
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

  for (const msg of result.messages) {
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
  let text = "*📊 Wordle Leaderboard*\n\n";

  data.forEach(([user, score], i) => {
    const rank = i + 1;
    const medal =
      rank === 1 ? "🥇" :
      rank === 2 ? "🥈" :
      rank === 3 ? "🥉" : `${rank}.`;

    text += `${medal} <@${user}> — ${score}/6\n`;
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

// 🧠 Track last leaderboard day (in-memory)
let lastLeaderboardDate = null;

// 🎯 Handle messages
app.message(async ({ message, client }) => {
  try {
    // Ignore non-user messages
    if (message.subtype || !message.text) return;

    // Ignore thread replies
    if (message.thread_ts) return;

    const score = parseWordle(message.text);
    if (!score) return;

    // 🎲 Reply randomly
    const options = replies[score];
    const reply = options[Math.floor(Math.random() * options.length)];

    await client.chat.postMessage({
      channel: message.channel,
      text: reply,
      thread_ts: message.ts,
    });

    // 📅 Leaderboard trigger (once per day)
    const today = new Date().toDateString();

    if (lastLeaderboardDate !== today) {
      lastLeaderboardDate = today;

      const leaderboard = await generateLeaderboard(message.channel);
      const leaderboardMessage = formatLeaderboard(leaderboard);

      await client.chat.postMessage({
        channel: message.channel,
        text: leaderboardMessage,
      });
    }

  } catch (err) {
    console.error("Message handler error:", err);
  }
});

// 🚀 Start app
(async () => {
  await app.start(process.env.PORT || 3000);
  console.log("⚡ Wordle bot running");
})();