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

// Groq API configuration
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

// Rate limiting map to prevent spam
const userCooldowns = new Map();
const COOLDOWN_TIME = 5000; // 5 seconds

// Server personality analysis storage
const serverPersonalities = new Map();
const serverMessages = new Map();
const MAX_MESSAGES_PER_SERVER = 200; // Store last 200 messages per server

// Function to add message to server training data
function addServerMessage(guildId, message, username) {
    if (!serverMessages.has(guildId)) {
        serverMessages.set(guildId, []);
    }
    
    const messages = serverMessages.get(guildId);
    messages.push({
        content: message,
        username: username,
        timestamp: Date.now()
    });
    
    // Keep only recent messages
    if (messages.length > MAX_MESSAGES_PER_SERVER) {
        messages.shift();
    }
}

// Function to analyze server personality
function analyzeServerPersonality(guildId) {
    const messages = serverMessages.get(guildId) || [];
    if (messages.length < 10) {
        return {
            tone: "casual and friendly",
            style: "conversational",
            examples: []
        };
    }
    
    // Analyze recent messages for patterns
    const recentMessages = messages.slice(-50);
    const messageTexts = recentMessages.map(m => m.content);
    
    // Count patterns
    let casualCount = 0;
    let formalCount = 0;
    let emojiCount = 0;
    let capsCount = 0;
    let contractionCount = 0;
    let slangCount = 0;
    
    const slangWords = ['lol', 'lmao', 'bruh', 'fr', 'ngl', 'tbh', 'smh', 'imo', 'rn', 'af', 'sus', 'cap', 'no cap', 'bet', 'fam', 'lowkey', 'highkey'];
    const casualWords = ['yeah', 'yep', 'nah', 'gonna', 'wanna', 'kinda', 'sorta'];
    
    messageTexts.forEach(msg => {
        const lower = msg.toLowerCase();
        
        // Check for emojis
        if (/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(msg)) {
            emojiCount++;
        }
        
        // Check for caps
        if (msg !== msg.toLowerCase() && msg.length > 3) {
            capsCount++;
        }
        
        // Check for contractions
        if (/\b(don't|won't|can't|isn't|aren't|wasn't|weren't|haven't|hasn't|hadn't|wouldn't|couldn't|shouldn't|mustn't|needn't|daren't|mayn't|oughtn't|mightn't|'ll|'re|'ve|'d|'m|'s)\b/i.test(msg)) {
            contractionCount++;
        }
        
        // Check for slang
        slangWords.forEach(slang => {
            if (lower.includes(slang)) {
                slangCount++;
            }
        });
        
        // Check for casual words
        casualWords.forEach(casual => {
            if (lower.includes(casual)) {
                casualCount++;
            }
        });
        
        // Check for formal indicators
        if (/\b(however|therefore|furthermore|nevertheless|consequently|moreover|additionally)\b/i.test(msg)) {
            formalCount++;
        }
    });
    
    // Determine personality
    const totalMessages = messageTexts.length;
    const emojiRate = emojiCount / totalMessages;
    const slangRate = slangCount / totalMessages;
    const casualRate = casualCount / totalMessages;
    const contractionRate = contractionCount / totalMessages;
    
    let tone = "casual and friendly";
    let style = "conversational";
    
    if (slangRate > 0.3 || emojiRate > 0.4) {
        tone = "very casual and expressive";
        style = "informal with slang and emojis";
    } else if (casualRate > 0.2 && contractionRate > 0.3) {
        tone = "relaxed and conversational";
        style = "casual with contractions";
    } else if (formalCount > casualCount) {
        tone = "more formal and polite";
        style = "structured and proper";
    }
    
    return {
        tone: tone,
        style: style,
        examples: messageTexts.slice(-10), // Last 10 messages as examples
        stats: {
            emojiRate: Math.round(emojiRate * 100),
            slangRate: Math.round(slangRate * 100),
            casualRate: Math.round(casualRate * 100),
            contractionRate: Math.round(contractionRate * 100)
        }
    };
}
async function callGroqAI(message, username) {
    try {
        const response = await axios.post(
            GROQ_API_URL,
            {
                messages: [
                    {
                        role: 'system',
                        content: `You are a helpful AI assistant in a Discord server. Keep responses conversational, friendly, and under 2000 characters. The user's name is ${username}. Be engaging and match the tone of the conversation.`
                    },
                    {
                        role: 'user',
                        content: message
                    }
                ],
                model: 'llama3-8b-8192',
                temperature: 0.7,
                max_tokens: 500,
            },
            {
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('Error calling Groq AI:', error.response?.data || error.message);
        return 'Sorry, I encountered an error while processing your request. Please try again later.';
    }
}

// Function to check if user is on cooldown
function isOnCooldown(userId) {
    if (userCooldowns.has(userId)) {
        const expirationTime = userCooldowns.get(userId) + COOLDOWN_TIME;
        if (Date.now() < expirationTime) {
            return true;
        }
    }
    return false;
}

// Function to set user cooldown
function setCooldown(userId) {
    userCooldowns.set(userId, Date.now());
}

// Bot ready event
client.once('ready', () => {
    console.log(`🤖 ${client.user.tag} is online and ready!`);
    console.log(`📊 Serving ${client.guilds.cache.size} servers`);
    
    // Set bot status
    client.user.setActivity('for @mentions | Powered by Groq AI', { type: 'WATCHING' });
});

// Message event handler
client.on('messageCreate', async (message) => {
    // Ignore messages from bots (but not the bot's own messages for analysis)
    if (message.author.bot && message.author.id !== client.user.id) return;
    
    // Don't analyze the bot's own responses, but analyze all other messages
    if (message.author.id !== client.user.id && message.guild) {
        // Add every message to server training data (except bot mentions)
        if (!message.mentions.has(client.user) && message.content.length > 3) {
            addServerMessage(
                message.guild.id, 
                message.content, 
                message.author.displayName || message.author.username
            );
        }
    }

    // Only respond when mentioned
    if (!message.mentions.has(client.user)) return;

    // Check cooldown
    if (isOnCooldown(message.author.id)) {
        const remainingTime = Math.ceil((userCooldowns.get(message.author.id) + COOLDOWN_TIME - Date.now()) / 1000);
        message.reply(`⏰ Please wait ${remainingTime} more seconds before asking another question.`);
        return;
    }

    // Set cooldown
    setCooldown(message.author.id);

    // Show typing indicator
    await message.channel.sendTyping();

    try {
        // Clean the message content (remove mentions)
        let cleanContent = message.content
            .replace(/<@!?\d+>/g, '') // Remove user mentions
            .replace(/<@&\d+>/g, '')  // Remove role mentions
            .replace(/<#\d+>/g, '')   // Remove channel mentions
            .trim();

        // If no content after cleaning mentions, provide a default response
        if (!cleanContent) {
            cleanContent = "Hello! How can I help you?";
        }

        // Get response from Groq AI with server personality
        const groqResponse = await callGroqAI(
            cleanContent, 
            message.author.displayName, 
            message.guild?.id || 'dm'
        );

        // Send plain text response
        await message.reply(groqResponse);

    } catch (error) {
        console.error('Error processing message:', error);
        await message.reply('❌ Sorry, I encountered an error while processing your request. Please try again later.');
    }
});

// Error handling
client.on('error', console.error);

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown
const shutdown = () => {
    console.log('🛑 Shutting down...');
    client.destroy();
    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Login to Discord
if (!DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN is not set in environment variables');
    process.exit(1);
}

if (!GROQ_API_KEY) {
    console.error('❌ GROQ_API_KEY is not set in environment variables');
    process.exit(1);
}

client.login(DISCORD_TOKEN).catch((error) => {
    console.error('❌ Failed to login:', error);
    process.exit(1);
});
