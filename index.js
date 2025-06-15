const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Bot is alive!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Keep-alive server running on port ${PORT}`);
});

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.on('messageCreate', message => {
  if (message.content === '!ping') {
    message.channel.send('Pong! I am alive and ready.');
  }
});

const messageHistory = {}; // Store recent messages per channel

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const channelId = message.channel.id;
  messageHistory[channelId] ||= [];
  messageHistory[channelId].push({ role: 'user', content: `${message.author.username}: ${message.content}` });

  // Keep only the last 15 messages
  if (messageHistory[channelId].length > 15) {
    messageHistory[channelId].shift();
  }

  // Trigger bot on mention (you can change this behavior)
  if (message.mentions.has(client.user)) {
    message.channel.sendTyping();
    const messagesForAI = messageHistory[channelId].slice(-15);

    const prompt = [
      { role: 'system', content: 'You are a helpful and witty assistant in a Discord chat.' },
      ...messagesForAI
    ];

    try {
      const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: "openai/gpt-3.5-turbo", // Or another free model
        messages: prompt,
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://yourdomain.com', // Replace or omit
          'Content-Type': 'application/json'
        }
      });

      const reply = response.data.choices[0].message.content;
      message.channel.send(reply);
    } catch (err) {
      console.error('OpenRouter error:', err.response?.data || err.message);
      message.channel.send('⚠️ Something went wrong while talking to the AI.');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
