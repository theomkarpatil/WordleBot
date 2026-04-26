require('dotenv').config();

const { App } = require('@slack/bolt');
const cron = require('node-cron');

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SIGNING_SECRET,
});

// Parse Wordle score
function parseWordle(text) {
    const match = text.match(/Wordle\s+\d+\s+(X|\d)\/6/);
    if (!match) return null;

    return match[1] === 'X' ? 7 : parseInt(match[1], 10);
}

// Generate leaderboard
async function generateLeaderboard(channelId) {
    const result = await app.client.conversations.history({
        channel: channelId,
        limit: 100,
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

// Format message
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

// Run every day at 11:59 PM
console.log("Script started...");
cron.schedule('59 23 * * *', async () => {
    console.log("Cron running...");
    const channelId = 'C0ARKDL6EJK';

    const leaderboard = await generateLeaderboard(channelId);
    const message = formatLeaderboard(leaderboard);

    await app.client.chat.postMessage({
        channel: channelId,
        text: message,
    });

    console.log("Posted leaderboard");
}, {
    timezone: "Asia/Kolkata"
});

const express = require('express');
// Access the underlying express app
const receiver = app.receiver;
const expressApp = receiver.app;

// ✅ Register BEFORE app.start()
expressApp.post('/slack/events', (req, res, next) => {
    if (req.body && req.body.type === 'url_verification') {
        return res.status(200).json({ challenge: req.body.challenge });
    }
    next();
});

// Start app
(async () => {
    await app.start(process.env.PORT || 3000);
    console.log("Bot is running");
})();

// 🎯 Auto-reply to Wordle messages
app.message(async ({ message, client }) => {
    try {
        // Ignore bot messages
        if (message.subtype === 'bot_message') return;

        // Ignore replies (only top-level messages)
        if (message.thread_ts) return;

        const text = message.text;
        if (!text) return;

        const score = parseWordle(text);
        if (!score) return;

        let reply = "";
        let index = Math.floor(Math.random() * 3) + 1;

        switch (score) {
            case 1:
                if (index == 1)
                    reply = "No. F***ing. Way!";
                else if (index == 2)
                    reply = "What is the GOD mode sh*t you're doing?";
                else if (index == 3)
                    reply = "People, I think it's time we quit!";
                break;
            case 2:
                if (index == 1)
                    reply = "Oh bullS*******t";
                else if (index == 2)
                    reply = "Chal ae ae ae, kuch bhi, cheating mat kar!";
                else if (index == 3)
                    reply = "Bhai sahaaaaaab!";
                break;
            case 3:
                if (index == 1)
                    reply = "Lezzz goooooo!";
                else if (index == 2)
                    reply = "Dayammnnnnn bro!";
                else if (index == 3)
                    reply = "Wow, someone's having a good morning!";
                break;
            case 4:
                if (index == 1)
                    reply = "Cute!";
                else if (index == 2)
                    reply = "Ohhhhh noice!";
                else if (index == 3)
                    reply = "Isko award do koi!!";
                break;
            case 5:
                if (index == 1)
                    reply = "You got this bro!";
                else if (index == 2)
                    reply = "Hmmmm, sh*t happens!";
                else if (index == 3)
                    reply = "Boy, that's rough!";
                break;
            case 6:
                if (index == 1)
                    reply = "Ouch, that... yeah, that hurts";
                else if (index == 2)
                    reply = "Aaaii gaaaaaa!! 💀";
                else if (index == 3)
                    reply = "Do you need a hug bro?";
                break;
            case 7:
                reply = "💀";
                break;
            default:
                return;
        }

        await client.chat.postMessage({
            channel: message.channel,
            text: reply,
            thread_ts: message.ts // reply in thread
        });

    } catch (err) {
        console.error("Reply error:", err);
    }
});