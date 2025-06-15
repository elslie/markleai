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

// Enhanced response generation with multiple strategies
async function generateResponse(userMessage, history = []) {
  // Try Hugging Face first
  try {
    const hfResponse = await callHuggingFace(userMessage, history);
    if (hfResponse && hfResponse.length > 10 && !hfResponse.includes("I'm here")) {
      return hfResponse;
    }
  } catch (error) {
    console.log('Hugging Face failed, using fallback');
  }
  
  // Enhanced fallback system based on message content
  return generateSmartFallback(userMessage, history);
}

// Smart fallback responses based on message analysis
function generateSmartFallback(message, history = []) {
  const msg = message.toLowerCase().trim();
  
  // Greeting responses
  if (msg.match(/\b(hi|hello|hey|sup|what's up)\b/)) {
    const greetings = [
      "Hey there! How's it going? 😊",
      "Hello! Nice to see you here! What's on your mind?",
      "Hi! I'm doing great, thanks for asking! How about you?",
      "Hey! Good to chat with you! What would you like to talk about?",
      "Hello there! Hope you're having a good day! 🌟"
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }
  
  // How are you responses
  if (msg.match(/how are you|how're you|how do you feel/)) {
    const responses = [
      "I'm doing great! Thanks for asking! How are you doing today?",
      "Pretty good! I love chatting with people. What about you?",
      "I'm fantastic! Always excited to have a conversation. How's your day going?",
      "Doing well! I'm here and ready to chat about whatever interests you!",
      "Great! I'm enjoying our conversation already. How are things with you?"
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
  
  // Question responses
  if (msg.includes('?')) {
    if (msg.match(/what.*do|what.*can|what.*are/)) {
      const responses = [
        "That's a great question! I'd love to help you explore that topic further.",
        "Interesting question! What specifically would you like to know more about?",
        "Good point! Let me think about that... What's your take on it?",
        "That's something worth discussing! What made you curious about this?",
        "Great question! I find that topic really fascinating too."
      ];
      return responses[Math.floor(Math.random() * responses.length)];
    }
    
    if (msg.match(/why|how|when|where|who/)) {
      const responses = [
        "That's a thought-provoking question! What's your perspective on it?",
        "Hmm, that's worth exploring! What do you think about it?",
        "Interesting question! I'd love to hear your thoughts first.",
        "That's something I find fascinating too! What got you thinking about this?",
        "Good question! There are probably multiple ways to look at that."
      ];
      return responses[Math.floor(Math.random() * responses.length)];
    }
  }
  
  // Opinion/preference questions
  if (msg.match(/do you like|favorite|prefer|opinion|think about/)) {
    const responses = [
      "I find that really interesting! What's your take on it?",
      "That's a cool topic! I'd love to hear your thoughts about it.",
      "Good question! What do you think about it? I'm curious to hear your perspective.",
      "That's something worth discussing! What's your experience with that?",
      "Interesting! I'd love to know more about your thoughts on this."
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
  
  // Thank you responses
  if (msg.match(/thank|thanks|thx/)) {
    const responses = [
      "You're very welcome! Happy to help! 😊",
      "No problem at all! That's what I'm here for!",
      "My pleasure! Feel free to ask me anything else.",
      "You're welcome! I enjoyed our conversation!",
      "Glad I could help! What else would you like to chat about?"
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
  
  // Topic-specific responses
  if (msg.match(/game|gaming|play/)) {
    const responses = [
      "Gaming is awesome! What kind of games do you enjoy playing?",
      "I love hearing about games! What's your current favorite?",
      "Games are so much fun! Are you into any particular genre?",
      "Gaming is such a great hobby! What have you been playing lately?",
      "Cool! I'd love to hear about your gaming experiences!"
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
  
  if (msg.match(/music|song|listen/)) {
    const responses = [
      "Music is amazing! What kind of music do you like?",
      "I love talking about music! What's your favorite genre?",
      "Music has such a great impact! What are you listening to lately?",
      "That's cool! Music is such a universal language. What's your taste?",
      "Awesome! I'd love to hear about your musical preferences!"
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
  
  if (msg.match(/movie|film|watch|tv|show/)) {
    const responses = [
      "Movies and shows are great! What have you been watching lately?",
      "I love hearing about what people watch! Any recommendations?",
      "That sounds interesting! What kind of movies or shows do you enjoy?",
      "Cool! I'd love to hear about your favorite films or series!",
      "Entertainment is awesome! What's caught your attention recently?"
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
  
  // Default conversational responses
  const defaultResponses = [
    "That's really interesting! Tell me more about that.",
    "I'd love to hear more about your thoughts on this!",
    "That sounds fascinating! What made you think about that?",
    "Cool! I'm enjoying our conversation. What else is on your mind?",
    "That's a great point! I'd love to explore that topic further with you.",
    "Interesting perspective! What's your experience with that?",
    "I find that topic really engaging! What do you think about it?",
    "That's worth discussing! I'm curious to hear more of your thoughts.",
    "Great topic! I'd love to continue this conversation with you.",
    "That's something I'd like to learn more about! What's your take?"
  ];
  
  return defaultResponses[Math.floor(Math.random() * defaultResponses.length)];
}

// Improved Hugging Face API call
async function callHuggingFace(text, history = [], retries = 2) {
  const models = [
    'microsoft/DialoGPT-medium',
    'facebook/blenderbot-400M-distill',
    'microsoft/DialoGPT-small'
  ];
  
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    
    try {
      console.log(`Trying model: ${model}`);
      
      // Prepare better input format
      let inputText = '';
      
      if (model.includes('DialoGPT')) {
        // DialoGPT format
        const recentHistory = history.slice(-2);
        for (const msg of recentHistory) {
          inputText += `${msg.role === 'user' ? 'Human' : 'Bot'}: ${msg.content}\n`;
        }
        inputText += `Human: ${text}\nBot:`;
      } else {
        // BlenderBot format
        inputText = text;
      }
      
      const response = await axios.post(
        `${CONFIG.HF_API_URL}${model}`,
        { 
          inputs: inputText,
          parameters: {
            max_length: model.includes('DialoGPT') ? 50 : 100,
            max_new_tokens: 50,
            do_sample: true,
            temperature: 0.8,
            top_p: 0.9,
            repetition_penalty: 1.1
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000
        }
      );

      if (response.data && response.data.length > 0) {
        let reply = response.data[0].generated_text || response.data[0].response || '';
        
        // Clean up DialoGPT response
        if (model.includes('DialoGPT') && reply.includes(inputText)) {
          reply = reply.replace(inputText, '').trim();
        }
        
        // Clean up common issues
        reply = reply
          .replace(/^(Bot:|Assistant:|AI:)/i, '')
          .replace(/Human:/gi, '')
          .replace(/\n+/g, ' ')
          .trim();
        
        if (reply && reply.length > 3 && !reply.match(/^(hi|hello|hey)\.?$/i)) {
          return reply;
        }
      }
      
    } catch (error) {
      console.log(`Model ${model} failed:`, error.response?.data?.error || error.message);
      
      // If model is loading, wait and retry
      if (error.response?.data?.error?.includes('loading') && retries > 0) {
        console.log(`Model ${model} is loading, waiting 10 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 10000));
        return await callHuggingFace(text, history, retries - 1);
      }
      
      // Try next model
      continue;
    }
  }
  
  // Return null to trigger fallback
  return null;
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
        '🤖 Bot is alive and ready to chat! 🤗',
        '⚡ Enhanced AI responses active!',
        '🔥 Free conversational AI running!',
        '📡 Multiple AI models loaded and ready!'
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
      description: 'Enhanced AI bot powered by Hugging Face! 🤗',
      fields: [
        { name: '⏱️ Latency', value: `${Date.now() - message.createdTimestamp}ms`, inline: true },
        { name: '📡 API Latency', value: `${Math.round(client.ws.ping)}ms`, inline: true },
        { name: '🤖 AI Provider', value: 'Hugging Face + Smart Fallbacks', inline: true },
        { name: '💬 Features', value: 'Context-aware responses', inline: false },
      ],
      timestamp: new Date().toISOString(),
    };
    
    message.reply({ embeds: [embed] }).catch(console.error);
    return;
  }
  
  // Add to history
  addToHistory(message.channel.id, message);
  
  // Respond when mentioned or in DMs
  if (message.mentions.has(client.user) || message.channel.type === 1) {
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
    
    // Clean the user's message
    const userMessage = message.content
      .replace(`<@${client.user.id}>`, '')
      .replace(/<@!?\d+>/g, '')
      .trim();
    
    console.log('Processing message:', userMessage);
    
    // Generate response using enhanced system
    const reply = await generateResponse(userMessage, history);
    
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
    console.error('Response Error:', error);
    await message.reply('🤖 Something went wrong, but I\'m still here! Try asking me something else!').catch(console.error);
    
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
