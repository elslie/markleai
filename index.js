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
  PING_INTERVAL: 15 * 60 * 1000,
  MAX_MESSAGE_LENGTH: 2000,
  REQUEST_TIMEOUT: 30000
};

// Store conversation history per channel
const conversationHistory = new Map();
const processingMessages = new Set();

// Add message to conversation history
const addToHistory = (channelId, role, content) => {
  if (!conversationHistory.has(channelId)) {
    conversationHistory.set(channelId, []);
  }
  
  const history = conversationHistory.get(channelId);
  history.push({ role, content });
  
  if (history.length > CONFIG.MAX_HISTORY) {
    history.shift();
  }
};

// Main AI response function - tries multiple approaches
async function generateAIResponse(userMessage, history = []) {
  console.log(`🤖 Generating response for: "${userMessage}"`);
  
  // Try different AI services in order of preference
  const aiProviders = [
    () => callOpenAI(userMessage, history),
    () => callGroq(userMessage, history),
    () => callCohere(userMessage, history),
    () => callAnthropic(userMessage, history),
    () => callHuggingFaceChat(userMessage, history)
  ];

  for (const provider of aiProviders) {
    try {
      const response = await provider();
      if (response && response.trim().length > 0) {
        console.log(`✅ Got AI response: "${response.substring(0, 100)}..."`);
        return response;
      }
    } catch (error) {
      console.log(`❌ Provider failed: ${error.message}`);
      continue;
    }
  }

  // If all AI providers fail, return a helpful message
  return "I'm having some technical difficulties right now, but I'm still here! Could you try asking me something else?";
}

// OpenAI ChatGPT API (most reliable)
async function callOpenAI(message, history) {
  if (!process.env.OPENAI_API_KEY) throw new Error('No OpenAI API key');
  
  const messages = [
    {
      role: 'system',
      content: 'You are a helpful, friendly Discord chatbot. Be conversational, engaging, and helpful. Keep responses under 300 words and match the tone of the conversation. You can discuss any topic naturally.'
    }
  ];
  
  // Add conversation history
  for (const msg of history.slice(-6)) {
    messages.push({ role: msg.role, content: msg.content });
  }
  
  messages.push({ role: 'user', content: message });

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-3.5-turbo',
      messages: messages,
      max_tokens: 200,
      temperature: 0.8,
      presence_penalty: 0.6,
      frequency_penalty: 0.3
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: CONFIG.REQUEST_TIMEOUT
    }
  );

  return response.data?.choices?.[0]?.message?.content?.trim();
}

// Groq API (fast and free alternative)
async function callGroq(message, history) {
  if (!process.env.GROQ_API_KEY) throw new Error('No Groq API key');
  
  const messages = [
    {
      role: 'system',
      content: 'You are a helpful Discord chatbot. Be friendly, conversational, and engaging. Keep responses concise but informative.'
    }
  ];
  
  for (const msg of history.slice(-6)) {
    messages.push({ role: msg.role, content: msg.content });
  }
  
  messages.push({ role: 'user', content: message });

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'llama3-8b-8192',
      messages: messages,
      max_tokens: 200,
      temperature: 0.7
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: CONFIG.REQUEST_TIMEOUT
    }
  );

  return response.data?.choices?.[0]?.message?.content?.trim();
}

// Cohere API
async function callCohere(message, history) {
  if (!process.env.COHERE_API_KEY) throw new Error('No Cohere API key');
  
  let conversationText = '';
  for (const msg of history.slice(-4)) {
    conversationText += `${msg.role === 'user' ? 'User' : 'Bot'}: ${msg.content}\n`;
  }
  conversationText += `User: ${message}\nBot:`;

  const response = await axios.post(
    'https://api.cohere.ai/v1/generate',
    {
      model: 'command-light',
      prompt: conversationText,
      max_tokens: 150,
      temperature: 0.8,
      stop_sequences: ['User:', 'Bot:']
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.COHERE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: CONFIG.REQUEST_TIMEOUT
    }
  );

  return response.data?.generations?.[0]?.text?.trim();
}

// Anthropic Claude API
async function callAnthropic(message, history) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('No Anthropic API key');
  
  let conversation = '';
  for (const msg of history.slice(-4)) {
    conversation += `${msg.role === 'user' ? 'Human' : 'Assistant'}: ${msg.content}\n`;
  }
  conversation += `Human: ${message}\nAssistant:`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/complete',
    {
      model: 'claude-instant-1',
      prompt: conversation,
      max_tokens_to_sample: 150,
      temperature: 0.8
    },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'Content-Type': 'application/json',
      },
      timeout: CONFIG.REQUEST_TIMEOUT
    }
  );

  return response.data?.completion?.trim();
}

// Hugging Face Chat Models (fallback)
async function callHuggingFaceChat(message, history) {
  if (!process.env.HUGGINGFACE_API_KEY) throw new Error('No HuggingFace API key');
  
  // Use a better conversational model
  const response = await axios.post(
    'https://api-inference.huggingface.co/models/microsoft/DialoGPT-large',
    {
      inputs: {
        past_user_inputs: history.filter(h => h.role === 'user').slice(-3).map(h => h.content),
        generated_responses: history.filter(h => h.role === 'assistant').slice(-3).map(h => h.content),
        text: message
      },
      parameters: {
        temperature: 0.8,
        max_length: 100
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

  return response.data?.generated_text || response.data?.response;
}

// Discord event handlers
client.once('ready', () => {
  console.log(`✅ ${client.user.tag} is online!`);
  console.log(`📊 Connected to ${client.guilds.cache.size} servers`);
  
  client.user.setActivity('intelligent conversations', { type: 'LISTENING' });
  
  // Periodic status update
  setInterval(() => {
    const channel = client.channels.cache.get(CONFIG.TEST_CHANNEL_ID);
    if (channel?.isTextBased?.()) {
      const messages = [
        '🧠 AI chatbot ready for intelligent conversation!',
        '💬 Ask me anything - I can understand and respond naturally!',
        '🤖 Powered by advanced language models!',
        '⚡ Real AI, real conversations!'
      ];
      const randomMessage = messages[Math.floor(Math.random() * messages.length)];
      channel.send(randomMessage).catch(console.error);
    }
  }, CONFIG.PING_INTERVAL);
});

client.on('messageCreate', async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;
  
  // Handle ping command
  if (message.content.toLowerCase() === '!ping') {
    const embed = {
      color: 0x7289da,
      title: '🤖 AI Bot Status',
      description: 'Intelligent conversational AI ready!',
      fields: [
        { name: '⏱️ Response Time', value: `${Date.now() - message.createdTimestamp}ms`, inline: true },
        { name: '🌐 Connection', value: `${Math.round(client.ws.ping)}ms`, inline: true },
        { name: '🧠 AI Status', value: 'Multiple providers active', inline: true },
        { name: '💡 Capability', value: 'Natural language understanding', inline: false }
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'Mention me to start chatting!' }
    };
    
    return message.reply({ embeds: [embed] }).catch(console.error);
  }
  
  // Respond when mentioned or in DMs
  const shouldRespond = message.mentions.has(client.user) || 
                       message.channel.type === 1 || 
                       message.reference?.messageId; // Reply to bot
  
  if (!shouldRespond) return;
  
  // Prevent duplicate processing
  if (processingMessages.has(message.id)) return;
  processingMessages.add(message.id);
  
  try {
    await handleConversation(message);
  } finally {
    setTimeout(() => processingMessages.delete(message.id), 10000);
  }
});

async function handleConversation(message) {
  const channelId = message.channel.id;
  const history = conversationHistory.get(channelId) || [];
  
  // Show typing indicator
  const typingInterval = setInterval(() => {
    message.channel.sendTyping().catch(() => {});
  }, 5000);
  
  try {
    await message.channel.sendTyping();
    
    // Clean user message
    let userMessage = message.content
      .replace(`<@${client.user.id}>`, '')
      .replace(`<@!${client.user.id}>`, '')
      .replace(/<@!?\d+>/g, '') // Remove other mentions
      .trim();
    
    if (!userMessage) {
      userMessage = "Hello!";
    }
    
    console.log(`💭 User (${message.author.username}): ${userMessage}`);
    
    // Generate AI response
    const aiResponse = await generateAIResponse(userMessage, history);
    
    if (aiResponse && aiResponse.trim()) {
      // Truncate if too long
      const finalResponse = aiResponse.length > CONFIG.MAX_MESSAGE_LENGTH 
        ? aiResponse.substring(0, CONFIG.MAX_MESSAGE_LENGTH - 3) + '...'
        : aiResponse;
      
      // Send response
      await message.reply(finalResponse);
      
      // Update conversation history
      addToHistory(channelId, 'user', userMessage);
      addToHistory(channelId, 'assistant', finalResponse);
      
      console.log(`🤖 Bot responded: ${finalResponse.substring(0, 100)}...`);
    }
    
  } catch (error) {
    console.error('❌ Conversation error:', error);
    await message.reply('🤖 Sorry, I encountered an error. Please try again!').catch(console.error);
  } finally {
    clearInterval(typingInterval);
  }
}

// Error handling
client.on('error', console.error);
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

// Graceful shutdown
const shutdown = () => {
  console.log('🛑 Shutting down...');
  client.destroy();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start the bot
client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error('❌ Failed to login:', error);
  process.exit(1);
});
