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

// 🛡️ Dedupe to avoid responding multiple times to the same event
// Slack may redeliver the same message event (e.g. slow/cold start, transient timeouts).
const processedMessages = new Map(); // key -> expiresAtMs
const PROCESSED_TTL_MS = 10 * 60 * 1000; // 10 minutes

function dedupeKeyFromMessage(message) {
  // Prefer client_msg_id when present; fall back to channel+ts.
  // ts is unique per message within a channel.
  const stableId = message.client_msg_id || message.ts;
  return `${message.channel}:${stableId}`;
}

function markProcessed(key) {
  processedMessages.set(key, Date.now() + PROCESSED_TTL_MS);
}

function alreadyProcessed(key) {
  const expiresAt = processedMessages.get(key);
  if (!expiresAt) return false;
  if (expiresAt < Date.now()) {
    processedMessages.delete(key);
    return false;
  }
  return true;
}

// Periodic cleanup so the map doesn't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [key, expiresAt] of processedMessages.entries()) {
    if (expiresAt < now) processedMessages.delete(key);
  }
}, 60 * 1000).unref?.();

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

// 🎯 Random replies
const replies = {
  1: [
    "No. F***ing. Way!",
    "What is the GOD mode sh*t you're doing?",
    "People, I think it's time we quit!",
    "Hadd hoti hai yaar!",
    "ALERT! ALERT! WE HAVE A HACKER IN HERE!!",
    "Hadd hoti hai yaar!",
    "Hadd hoti hai yaar!",
    "No. F***ing. Way!"
  ],
  2: [
    "Oh bullS*******t",
    "Chal ae ae ae, kuch bhi, cheating mat kar!",
    "Bhai sahaaaaaab!",
    "Bro you hackin' on some shizz?",
    "DAAAAAYAMN SON!",
    "Yaaar hatao isko, 2 me kaun solve karta hai?",
    "Brrrt Brrrt, god gamer alert, god gamer detected, brrrt!",
    "Macha, chill da!"
  ],
  3: [
    "Lezzz goooooo!",
    "Dayammnnnnn bro!",
    "Wow, someone's having a good day!",
    "Watch out, we got a bada** over here!",
    "Deva re deva, yo tar lay bhaari nighalay!",
    "You don't gotta be that good bro!",
    "Bhai mere, 3 me toh ye me bhi solve nahi kar pata!",
    "Too easy, right? Yeah, we be smort!"
  ],
  4: [
    "Cute!",
    "Ohhhhh noice!",
    "Isko award do koi!!",
    "Yaaaaaar almost 3 me ho gaya tha!",
    "4 bottle vodka, wordle mera rozz ka!",
    "Wordle ke hai 4 guess, oh oh oh ooooooo oo!",
    "4eva young, I wanna be, 4eva yooooung!",
    "The 4 horsemen of apocalypse got nothin' on your 4 words bro!"
  ],
  5: [
    "You got this broooooo, you goooooooooot this, ishhokay!",
    "Hmmmm, sh*t happens!",
    "Boy, that's rough!",
    "Come here baby, lemme give you a huggy wuggy!",
    "Ye sub sehne ke baad 8 ghante kaam karna hai jee!",
    "Look to your left, look to your right, I'm pretty sure they did better than you today!",
    "Hota hai bro, hota hai! When life gives you lemons, squash them with your feet 'cause you clearly can't squash wordle!",
    "Yaai re yaai re, phone utha ke phek reee!",
    "AATA! MAAZHI! SATAKLIIIIII!",
    "Hey bhagwan, kyun hai ye berehem duniya!",
    "Aaj raat me 4 baje tak piiega!"
  ],
  6: [
    "Ouch, that... yeah, that hurts",
    "Aaaii gaaaaaa!! 💀",
    "Do you need a hug bro?",
    "There once was a very old man who lived by himself with no one to love, and even his pet cow didn't like him back. He would hike down the mountain to sell milk but barely anyone ever bought it. He would be sad and helpless but even he wasn't having a day as bad as you are today!",
    "Come here baby, my babyyyy awwwlele I'll give you a hug!",
    "Arjun and Meera grew up sharing lunches, secrets, and dreams under the same old banyan tree. As years passed, Arjun carried a love he never voiced, afraid of losing the only home he knew. One evening, he finally confessed, hands trembling, heart open. Meera listened, eyes kind but distant, and spoke of another life she had already chosen. They smiled through the ache, promising to remain friends, but silence slowly replaced laughter. Seasons changed, the tree stood still, and Arjun sat alone, realizing some stories don't end loudly, only fade into absence. He kept her name, but lost everything else. \n\n I was just trying to distract you from what you've been through today with this sad little story /:)",
    "Hota hai bro, hota hai, ab kya kare? I mean, the terrace up there has no guard-rails, but yaar kya, hi, kare?",
    "Whoa whoa whoa hey, hey, don't blame yourself! We all have a certain mental capacity, its okay my child.",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHHHHHHHHHHHHHHH! You and I both bro, you and I both!"
  ],
  7: ["💀"]
};

// 🎯 Handle Wordle messages
app.message(async ({ message, client }) => {
  try {
    if (message.subtype || !message.text) return;
    if (message.user === botUserId) return; // ✅ fix: skip own messages using cached bot user ID
    if (message.thread_ts) return;

    const score = parseWordle(message.text);
    if (!score) return;

    const key = dedupeKeyFromMessage(message);
    if (alreadyProcessed(key)) return;
    // Mark before posting to protect against near-simultaneous redeliveries.
    markProcessed(key);

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

// 🏓 Keep-alive ping — hit this every 10-14 mins via cron-job.org
// to prevent Render free tier from spinning down
receiver.router.get('/ping', (req, res) => {
  res.json({ ok: true });
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
    return res.sendStatus(401);
  }

  const channelId = process.env.WORDLE_CHANNEL_ID;
  if (!channelId) {
    return res.sendStatus(500);
  }

  // ✅ fix: respond immediately so cron-job.org doesn't time out on cold starts
  res.sendStatus(204); // No Content

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
})();