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
  // Skip empty or very short messages
  if (!userMessage || userMessage.length < 2) {
    return "What's on your mind?";
  }
  
  // Try Hugging Face first with better filtering
  try {
    const hfResponse = await callHuggingFace(userMessage, history);
    if (hfResponse && 
        hfResponse.length > 5 && 
        !hfResponse.match(/^(hi|hello|hey|i'm here|thanks)\.?$/i) &&
        !hfResponse.includes("I'm here") &&
        !hfResponse.includes("would you like to")) {
      console.log('Using HF response:', hfResponse);
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
  
  // Handle basic greetings
  if (msg.match(/^(hi|hello|hey|sup|what's up|whats up)$/)) {
    const greetings = [
      "Hey! What's going on?",
      "Hi there! How's your day going?",
      "Hello! What brings you here today?",
      "Hey! Good to see you! What's new?",
      "Hi! What would you like to chat about?"
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }
  
  // Handle "what's up" variations with more context
  if (msg.match(/what.*up|whats.*up|wassup/)) {
    const responses = [
      "Not much, just hanging out here! What about you?",
      "Just chilling and ready to chat! How about you?",
      "Nothing too exciting, but I'm here to talk! What's new with you?",
      "Just vibing! What's going on in your world?",
      "Same old, same old! What brings you by?"
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
  
  // Handle abbreviations and slang better
  if (msg.match(/\bs\b.*\bp\b|s and p/)) {
    const responses = [
      "Not sure what you mean by that - could you explain?",
      "I didn't catch that, could you clarify?",
      "What do you mean exactly?",
      "Can you elaborate on that?",
      "I'm not following - what are you referring to?"
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
  
  // Handle questions
  if (msg.includes('?')) {
    const responses = [
      "That's an interesting question! What do you think?",
      "Good question! I'd love to hear your perspective on that.",
      "Hmm, that's worth thinking about. What's your take?",
      "What made you curious about that?",
      "That's something I find fascinating too!"
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
  
  // Handle common topics
  if (msg.match(/game|gaming|play/)) {
    return "Gaming sounds fun! What games are you into?";
  }
  
  if (msg.match(/music|song|listen/)) {
    return "Music is awesome! What kind of music do you like?";
  }
  
  if (msg.match(/movie|film|watch|tv|show/)) {
    return "Cool! What have you been watching lately?";
  }
  
  if (msg.match(/work|job|school/)) {
    return "How's that going for you?";
  }
  
  if (msg.match(/tired|sleepy|busy/)) {
    return "I hear you! Sometimes you just need a break.";
  }
  
  if (msg.match(/thanks|thank you|thx/)) {
    return "You're welcome! What else is on your mind?";
  }
  
  // Handle longer messages with more substance
  if (message.length > 20) {
    const responses = [
      "That's really interesting! Tell me more.",
      "I see what you mean. What do you think about that?",
      "That's a good point. How do you feel about it?",
      "Interesting perspective! What's your experience with that?",
      "That sounds worth exploring further!"
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
  
  // Default responses for short/unclear messages
  const defaultResponses = [
    "What's on your mind?",
    "Tell me more about that!",
    "What would you like to talk about?",
    "I'm listening - what's up?",
    "What brings you here today?"
  ];
  
  return defaultResponses[Math.floor(Math.random() * defaultResponses.length)];
}

// Improved Hugging Face API call
async function callHuggingFace(text, history = [], retries = 2) {
  const models = [
    'microsoft/DialoGPT-medium',
    'facebook/blenderbot-400M-distill'
  ];
  
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    
    try {
      console.log(`Trying model: ${model} with input: "${text}"`);
      
      // Prepare input based on model type
      let inputText = text;
      
      if (model.includes('DialoGPT')) {
        // For DialoGPT, use conversation format
        const recentHistory = history.slice(-2);
        let conversation = '';
        
        for (const msg of recentHistory) {
          conversation += `${msg.role === 'user' ? 'Human' : 'Bot'}: ${msg.content}\n`;
        }
        conversation += `Human: ${text}\nBot:`;
        inputText = conversation;
      }
      
      const response = await axios.post(
        `${CONFIG.HF_API_URL}${model}`,
        { 
          inputs: inputText,
          parameters: {
            max_new_tokens: 60,
            do_sample: true,
            temperature: 0.7,
            top_p: 0.9,
            repetition_penalty: 1.2,
            pad_token_id: 50256
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
        if (model.includes('DialoGPT')) {
          // Remove the input conversation from the response
          if (reply.includes('Bot:')) {
            const parts = reply.split('Bot:');
            reply = parts[parts.length - 1].trim();
          }
          
          // Remove any remaining conversation artifacts
          reply = reply
            .replace(/Human:.*$/gi, '')
            .replace(/Bot:.*$/gi, '')
            .split('\n')[0] // Take only first line
            .trim();
        }
        
        // General cleanup
        reply = reply
          .replace(/^(Assistant:|AI:|Bot:)/i, '')
          .replace(/\n+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        // Filter out bad responses
        if (reply && 
            reply.length > 3 && 
            reply.length < 200 &&
            !reply.match(/^(hi|hello|hey|ok|yes|no|sure)\.?$/i) &&
            !reply.includes('I don\'t know') &&
            !reply.includes('I can\'t') &&
            !reply.includes('sorry')) {
          
          console.log(`Got good response from ${model}: "${reply}"`);
          return reply;
        } else {
          console.log(`Filtered out response from ${model}: "${reply}"`);
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
    }
  }
  
  // Return null to trigger fallback
  console.log('All HF models failed, using fallback');
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
