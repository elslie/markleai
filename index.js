require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

// Express server for keep-alive
const app = express();
app.get('/', (req, res) => {
  res.json({ 
    status: 'Bot is alive!', 
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Keep-alive server running on port ${PORT}`);
});

// Discord client setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Configuration
const CONFIG = {
  TEST_CHANNEL_ID: process.env.TEST_CHANNEL_ID || '1382577291015749674',
  MAX_HISTORY: 15,
  PING_INTERVAL: 15 * 60 * 1000, // 15 minutes
  MAX_MESSAGE_LENGTH: 2000, // Discord limit
  TYPING_TIMEOUT: 10000, // 10 seconds
};

// Store message history per channel
const messageHistory = new Map();

// Helper functions
const addToHistory = (channelId, message) => {
  if (!messageHistory.has(channelId)) {
    messageHistory.set(channelId, []);
  }
  
  const history = messageHistory.get(channelId);
  history.push({
    role: 'user',
    content: `${message.author.username}: ${message.content}`,
    timestamp: Date.now()
  });
  
  // Keep only recent messages
  if (history.length > CONFIG.MAX_HISTORY) {
    history.shift();
  }
};

const cleanupOldHistory = () => {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  
  for (const [channelId, history] of messageHistory.entries()) {
    const recentMessages = history.filter(msg => msg.timestamp > oneHourAgo);
    if (recentMessages.length === 0) {
      messageHistory.delete(channelId);
    } else {
      messageHistory.set(channelId, recentMessages);
    }
  }
};

const truncateMessage = (message, maxLength = CONFIG.MAX_MESSAGE_LENGTH) => {
  if (message.length <= maxLength) return message;
  return message.substring(0, maxLength - 3) + '...';
};

// Discord event handlers
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📊 Serving ${client.guilds.cache.size} guilds`);
  
  // Set bot status
  client.user.setActivity('for mentions | !ping', { type: 'WATCHING' });
  
  // Periodic keep-alive ping
  setInterval(() => {
    const channel = client.channels.cache.get(CONFIG.TEST_CHANNEL_ID);
    if (channel && channel.isTextBased()) {
      const messages = [
        '🤖 Bot heartbeat - all systems operational!',
        '⚡ Still here and ready to chat!',
        '🔥 Keeping the servers warm!',
        '📡 Maintaining connection...',
      ];
      const randomMessage = messages[Math.floor(Math.random() * messages.length)];
      channel.send(randomMessage).catch(console.error);
    }
  }, CONFIG.PING_INTERVAL);
  
  // Cleanup old message history every hour
  setInterval(cleanupOldHistory, 60 * 60 * 1000);
});

client.on('messageCreate', async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;
  
  // Handle ping command
  if (message.content.toLowerCase() === '!ping') {
    const embed = {
      color: 0x00ff00,
      title: '🏓 Pong!',
      description: 'I am alive and ready to help!',
      fields: [
        { name: '⏱️ Latency', value: `${Date.now() - message.createdTimestamp}ms`, inline: true },
        { name: '📡 API Latency', value: `${Math.round(client.ws.ping)}ms`, inline: true },
      ],
      timestamp: new Date().toISOString(),
    };
    
    message.reply({ embeds: [embed] }).catch(console.error);
    return;
  }
  
  // Add message to history
  addToHistory(message.channel.id, message);
  
  // Respond when mentioned
  if (message.mentions.has(client.user)) {
    await handleAIResponse(message);
  }
});

async function handleAIResponse(message) {
  const channelId = message.channel.id;
  const history = messageHistory.get(channelId) || [];
  
  // Show typing indicator
  const typingPromise = message.channel.sendTyping();
  const typingInterval = setInterval(() => {
    message.channel.sendTyping().catch(() => clearInterval(typingInterval));
  }, 5000);
  
  try {
    await typingPromise;
    
    // Prepare messages for AI
    const messagesForAI = [
      { 
        role: 'system', 
        content: `You are a friendly Discord bot assistant. Be helpful, concise, and conversational. Keep responses under 3 sentences when possible. Current time: ${new Date().toLocaleString()}`
      },
      ...history.slice(-10).map(h => ({ role: h.role, content: h.content }))
    ];
    
    // Call OpenRouter API
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: process.env.AI_MODEL || 'openchat/openchat-3.5-1210',
      messages: messagesForAI,
      max_tokens: 500,
      temperature: 0.7,
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': process.env.HTTP_REFERER || 'https://localhost:3000',
        'X-Title': 'Discord Bot',
        'Content-Type': 'application/json',
      },
      timeout: CONFIG.TYPING_TIMEOUT,
    });
    
    const reply = response.data.choices[0]?.message?.content;
    
    if (reply) {
      const truncatedReply = truncateMessage(reply);
      await message.reply(truncatedReply);
      
      // Add bot response to history
      const history = messageHistory.get(channelId) || [];
      history.push({
        role: 'assistant',
        content: `${client.user.username}: ${truncatedReply}`,
        timestamp: Date.now()
      });
      messageHistory.set(channelId, history);
    } else {
      await message.reply('🤔 I received an empty response. Try again?');
    }
    
  } catch (error) {
    console.error('AI Response Error:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });
    
    let errorMessage = '⚠️ Something went wrong while processing your request.';
    
    if (error.code === 'ECONNABORTED') {
      errorMessage = '⏱️ Request timed out. Please try again.';
    } else if (error.response?.status === 429) {
      errorMessage = '🚫 Rate limit exceeded. Please wait a moment.';
    } else if (error.response?.status === 401) {
      errorMessage = '🔑 API authentication failed.';
    }
    
    await message.reply(errorMessage).catch(console.error);
    
  } finally {
    clearInterval(typingInterval);
  }
}

// Error handling
client.on('error', (error) => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error('Failed to login to Discord:', error);
  process.exit(1);
});
