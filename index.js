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
  MAX_HISTORY: 10,
  PING_INTERVAL: 15 * 60 * 1000, // 15 minutes
  MAX_MESSAGE_LENGTH: 2000,
  HF_MODEL: process.env.HF_MODEL || 'microsoft/DialoGPT-medium',
  HF_API_URL: 'https://api-inference.huggingface.co/models/'
};

// Store message history per channel
const messageHistory = new Map();
const processingMessages = new Set();

// Helper functions
const addToHistory = (channelId, message) => {
  if (!messageHistory.has(channelId)) {
    messageHistory.set(channelId, []);
  }
  
  const history = messageHistory.get(channelId);
  history.push({
    role: message.author.bot ? 'assistant' : 'user',
    content: message.content,
    timestamp: Date.now()
  });
  
  if (history.length > CONFIG.MAX_HISTORY) {
    history.shift();
  }
};

const truncateMessage = (message, maxLength = CONFIG.MAX_MESSAGE_LENGTH) => {
  if (message.length <= maxLength) return message;
  return message.substring(0, maxLength - 3) + '...';
};

// Hugging Face API call
async function callHuggingFace(text, retries = 3) {
  const models = [
    'microsoft/DialoGPT-medium',
    'facebook/blenderbot-400M-distill',
    'microsoft/DialoGPT-small'
  ];
  
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    
    try {
      console.log(`Trying model: ${model}`);
      
      const response = await axios.post(
        `${CONFIG.HF_API_URL}${model}`,
        { 
          inputs: text,
          parameters: {
            max_length: 100,
            do_sample: true,
            temperature: 0.7
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000
        }
      );

      if (response.data && response.data.length > 0) {
        let reply = response.data[0].generated_text || response.data[0].response || '';
        
        // Clean up the response
        if (reply.includes(text)) {
          reply = reply.replace(text, '').trim();
        }
        
        return reply || "I'm here! What would you like to chat about?";
      }
      
    } catch (error) {
      console.log(`Model ${model} failed:`, error.response?.data?.error || error.message);
      
      // If model is loading, wait and retry
      if (error.response?.data?.error?.includes('loading')) {
        console.log(`Model ${model} is loading, waiting 20 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 20000));
        
        if (retries > 0) {
          return await callHuggingFace(text, retries - 1);
        }
      }
      
      // Try next model
      continue;
    }
  }
  
  // Fallback responses if all models fail
  const fallbacks = [
    "I'm here and ready to chat! 😊",
    "Hi there! How can I help you today?",
    "Hello! What's on your mind?",
    "Hey! I'm online and ready to talk!",
    "Hi! Thanks for mentioning me - what would you like to discuss?"
  ];
  
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

// Discord event handlers
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📊 Serving ${client.guilds.cache.size} guilds`);
  
  client.user.setActivity('for mentions | !ping', { type: 'WATCHING' });
  
  // Keep-alive ping
  setInterval(() => {
    const channel = client.channels.cache.get(CONFIG.TEST_CHANNEL_ID);
    if (channel && channel.isTextBased()) {
      const messages = [
        '🤖 Bot is alive and using Hugging Face! 🤗',
        '⚡ Free AI bot running smoothly!',
        '🔥 No payment required - still chatting!',
        '📡 Hugging Face models loaded and ready!'
      ];
      const randomMessage = messages[Math.floor(Math.random() * messages.length)];
      channel.send(randomMessage).catch(console.error);
    }
  }, CONFIG.PING_INTERVAL);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  // Handle ping command
  if (message.content.toLowerCase() === '!ping') {
    const embed = {
      color: 0x00ff00,
      title: '🏓 Pong!',
      description: 'Free AI bot powered by Hugging Face! 🤗',
      fields: [
        { name: '⏱️ Latency', value: `${Date.now() - message.createdTimestamp}ms`, inline: true },
        { name: '📡 API Latency', value: `${Math.round(client.ws.ping)}ms`, inline: true },
        { name: '🤖 AI Provider', value: 'Hugging Face (FREE!)', inline: true },
      ],
      timestamp: new Date().toISOString(),
    };
    
    message.reply({ embeds: [embed] }).catch(console.error);
    return;
  }
  
  // Add to history
  addToHistory(message.channel.id, message);
  
  // Respond when mentioned
  if (message.mentions.has(client.user)) {
    const messageId = message.id;
    
    if (processingMessages.has(messageId)) {
      return;
    }
    
    processingMessages.add(messageId);
    
    try {
      await handleAIResponse(message);
    } finally {
      setTimeout(() => {
        processingMessages.delete(messageId);
      }, 5000);
    }
  }
});

async function handleAIResponse(message) {
  const channelId = message.channel.id;
  const history = messageHistory.get(channelId) || [];
  
  // Show typing
  const typingInterval = setInterval(() => {
    message.channel.sendTyping().catch(() => clearInterval(typingInterval));
  }, 5000);
  
  try {
    message.channel.sendTyping();
    
    // Prepare input for Hugging Face
    let conversationText = '';
    const recentHistory = history.slice(-3); // Last 3 messages for context
    
    for (const msg of recentHistory) {
      conversationText += `${msg.role === 'user' ? 'Human' : 'Bot'}: ${msg.content}\n`;
    }
    
    // Add current message
    conversationText += `Human: ${message.content.replace(`<@${client.user.id}>`, '').trim()}\nBot:`;
    
    console.log('Sending to Hugging Face:', conversationText);
    
    const reply = await callHuggingFace(conversationText);
    
    if (reply) {
      const truncatedReply = truncateMessage(reply);
      await message.reply(truncatedReply);
      
      // Add bot response to history
      addToHistory(channelId, {
        author: { bot: true },
        content: truncatedReply
      });
    }
    
  } catch (error) {
    console.error('Hugging Face Error:', error);
    await message.reply('🤗 Having trouble connecting to Hugging Face. Try again in a moment!').catch(console.error);
    
  } finally {
    clearInterval(typingInterval);
  }
}

// Error handling
client.on('error', (error) => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 Shutting down gracefully...');
  client.destroy();
  process.exit(0);
});

// Login
client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error('Failed to login:', error);
  process.exit(1);
});
