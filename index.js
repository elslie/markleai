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
  MAX_HISTORY: 8,
  PING_INTERVAL: 15 * 60 * 1000, // 15 minutes
  MAX_MESSAGE_LENGTH: 2000,
  REQUEST_TIMEOUT: 20000
};

// Store conversation history per channel
const conversationHistory = new Map();
const processingMessages = new Set();

// Helper functions
const addToHistory = (channelId, role, content) => {
  if (!conversationHistory.has(channelId)) {
    conversationHistory.set(channelId, []);
  }
  
  const history = conversationHistory.get(channelId);
  history.push({ role, content, timestamp: Date.now() });
  
  // Keep only recent messages to maintain context without overwhelming the model
  if (history.length > CONFIG.MAX_HISTORY) {
    history.shift();
  }
};

const formatConversationForModel = (history, currentMessage) => {
  let conversation = "";
  
  // Add recent conversation history
  for (const msg of history.slice(-6)) { // Last 6 messages for context
    if (msg.role === 'user') {
      conversation += `Human: ${msg.content}\n`;
    } else {
      conversation += `Assistant: ${msg.content}\n`;
    }
  }
  
  // Add current message
  conversation += `Human: ${currentMessage}\nAssistant:`;
  return conversation;
};

// AI Response Generation - Multiple providers with fallback
async function generateAIResponse(userMessage, history = []) {
  // Clean and validate input
  const cleanMessage = userMessage.trim();
  if (!cleanMessage || cleanMessage.length < 1) {
    return "I'm here! What would you like to talk about?";
  }

  // Try different AI providers in order of preference
  const providers = [
    () => callHuggingFaceConversational(cleanMessage, history),
    () => callHuggingFaceText(cleanMessage, history),
    () => callOpenAI(cleanMessage, history) // If you have OpenAI key
  ];

  for (const provider of providers) {
    try {
      const response = await provider();
      if (response && response.length > 3 && response.length < 500) {
        return response;
      }
    } catch (error) {
      console.log(`Provider failed: ${error.message}`);
      continue;
    }
  }

  // If all AI providers fail, return a helpful message
  return "I'm having trouble with my AI systems right now, but I'm still here! Could you try rephrasing that?";
}

// Primary: Conversational AI models
async function callHuggingFaceConversational(message, history) {
  const models = [
    'facebook/blenderbot-400M-distill',
    'microsoft/DialoGPT-large',
    'facebook/blenderbot_small-90M'
  ];

  for (const model of models) {
    try {
      console.log(`Trying conversational model: ${model}`);
      
      const response = await axios.post(
        `https://api-inference.huggingface.co/models/${model}`,
        {
          inputs: {
            past_user_inputs: history.filter(h => h.role === 'user').slice(-3).map(h => h.content),
            generated_responses: history.filter(h => h.role === 'assistant').slice(-3).map(h => h.content),
            text: message
          },
          parameters: {
            temperature: 0.8,
            max_length: 100,
            do_sample: true,
            top_p: 0.9
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: CONFIG.REQUEST_TIMEOUT
        }
      );

      let reply = response.data?.generated_text || response.data?.response || '';
      
      if (reply && typeof reply === 'string') {
        reply = cleanAIResponse(reply);
        if (isValidResponse(reply)) {
          console.log(`✅ Got response from ${model}: "${reply}"`);
          return reply;
        }
      }

    } catch (error) {
      if (error.response?.status === 503) {
        console.log(`Model ${model} is loading...`);
        continue;
      }
      console.log(`Model ${model} error:`, error.message);
    }
  }
  
  return null;
}

// Secondary: Text generation models
async function callHuggingFaceText(message, history) {
  const models = [
    'gpt2',
    'EleutherAI/gpt-neo-125M',
    'distilgpt2'
  ];

  for (const model of models) {
    try {
      console.log(`Trying text model: ${model}`);
      
      // Create a prompt that encourages conversational response
      const conversationPrompt = formatConversationForModel(history, message);
      
      const response = await axios.post(
        `https://api-inference.huggingface.co/models/${model}`,
        {
          inputs: conversationPrompt,
          parameters: {
            max_new_tokens: 50,
            temperature: 0.7,
            do_sample: true,
            top_p: 0.9,
            repetition_penalty: 1.1,
            stop: ["Human:", "Assistant:", "\n\n"]
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: CONFIG.REQUEST_TIMEOUT
        }
      );

      let reply = response.data?.[0]?.generated_text || '';
      
      if (reply) {
        // Extract just the assistant's response
        reply = reply.replace(conversationPrompt, '').trim();
        reply = cleanAIResponse(reply);
        
        if (isValidResponse(reply)) {
          console.log(`✅ Got response from ${model}: "${reply}"`);
          return reply;
        }
      }

    } catch (error) {
      console.log(`Text model ${model} error:`, error.message);
    }
  }
  
  return null;
}

// Optional: OpenAI fallback (if you have API key)
async function callOpenAI(message, history) {
  if (!process.env.OPENAI_API_KEY) return null;
  
  try {
    const messages = [
      { role: 'system', content: 'You are a helpful, friendly Discord chatbot. Keep responses conversational and under 100 words.' }
    ];
    
    // Add conversation history
    for (const msg of history.slice(-4)) {
      messages.push({ role: msg.role, content: msg.content });
    }
    
    messages.push({ role: 'user', content: message });

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: messages,
        max_tokens: 100,
        temperature: 0.8
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: CONFIG.REQUEST_TIMEOUT
      }
    );

    const reply = response.data?.choices?.[0]?.message?.content;
    if (reply && isValidResponse(reply)) {
      console.log('✅ Got OpenAI response');
      return cleanAIResponse(reply);
    }
  } catch (error) {
    console.log('OpenAI error:', error.message);
  }
  
  return null;
}

// Response cleaning and validation
function cleanAIResponse(response) {
  return response
    .replace(/^(Assistant:|AI:|Bot:|Human:)/i, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s.,!?'-]/g, '')
    .trim()
    .substring(0, 300); // Reasonable length limit
}

function isValidResponse(response) {
  if (!response || response.length < 3 || response.length > 300) return false;
  
  // Filter out common bad responses
  const badPatterns = [
    /^(hi|hello|hey|ok|yes|no|sure|thanks)\.?$/i,
    /^(i don't|i can't|sorry|i'm sorry)/i,
    /^(what|how|when|where|why)\??$/i,
    /^[^\w]*$/,
    /(.)\1{4,}/ // Repeated characters
  ];
  
  return !badPatterns.some(pattern => pattern.test(response));
}

// Discord event handlers
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📊 Serving ${client.guilds.cache.size} guilds`);
  
  client.user.setActivity('conversations | !ping', { type: 'LISTENING' });
  
  // Keep-alive ping
  setInterval(() => {
    const channel = client.channels.cache.get(CONFIG.TEST_CHANNEL_ID);
    if (channel && channel.isTextBased()) {
      const messages = [
        '🤖 AI chatbot online and ready!',
        '💬 Having natural conversations!',
        '🧠 Multiple AI models loaded!',
        '⚡ Powered by real AI, not if-statements!'
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
      title: '🤖 AI Chatbot Status',
      description: 'Real AI conversation, no hardcoded responses!',
      fields: [
        { name: '⏱️ Latency', value: `${Date.now() - message.createdTimestamp}ms`, inline: true },
        { name: '📡 Discord', value: `${Math.round(client.ws.ping)}ms`, inline: true },
        { name: '🧠 AI Models', value: 'HuggingFace + Fallbacks', inline: true },
        { name: '💬 Type', value: 'Conversational AI', inline: false },
      ],
      timestamp: new Date().toISOString(),
    };
    
    message.reply({ embeds: [embed] }).catch(console.error);
    return;
  }
  
  // Respond when mentioned or in DMs
  if (message.mentions.has(client.user) || message.channel.type === 1) {
    const messageId = message.id;
    
    if (processingMessages.has(messageId)) return;
    processingMessages.add(messageId);
    
    try {
      await handleAIConversation(message);
    } finally {
      setTimeout(() => processingMessages.delete(messageId), 5000);
    }
  }
});

async function handleAIConversation(message) {
  const channelId = message.channel.id;
  const history = conversationHistory.get(channelId) || [];
  
  // Show typing indicator
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
    
    console.log(`💬 Processing: "${userMessage}"`);
    
    // Generate AI response
    const aiReply = await generateAIResponse(userMessage, history);
    
    if (aiReply) {
      // Send response
      await message.reply(aiReply);
      
      // Store conversation
      addToHistory(channelId, 'user', userMessage);
      addToHistory(channelId, 'assistant', aiReply);
      
      console.log(`✅ Responded: "${aiReply}"`);
    }
    
  } catch (error) {
    console.error('❌ Conversation Error:', error);
    await message.reply('🤖 My AI brain had a hiccup! Try asking me something else.').catch(console.error);
    
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
