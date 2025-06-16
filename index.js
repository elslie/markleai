require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

console.log('🚀 Starting Discord bot...');
console.log('📋 Loading environment variables...');

// Express server for keep-alive
const app = express();
app.get('/', (req, res) => {
  const uptime = Math.floor(process.uptime());
  const uptimeFormatted = `${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m ${uptime%60}s`;
  
  res.json({ 
    status: 'Bot is alive!', 
    uptime: uptime,
    uptimeFormatted: uptimeFormatted,
    timestamp: new Date().toISOString()
  });
  
  console.log(`📡 Keep-alive ping received - Uptime: ${uptimeFormatted}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Keep-alive server running on port ${PORT}`);
});

// Discord client setup
console.log('🔧 Setting up Discord client...');
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
        console.log(`📊 Initialized message storage for server: ${guildId}`);
    }
    
    const messages = serverMessages.get(guildId);
    messages.push({
        content: message,
        username: username,
        timestamp: Date.now()
    });
    
    console.log(`💬 Stored message from ${username} in server ${guildId} (${messages.length}/${MAX_MESSAGES_PER_SERVER})`);
    
    // Keep only recent messages
    if (messages.length > MAX_MESSAGES_PER_SERVER) {
        messages.shift();
        console.log(`🗑️ Removed oldest message from server ${guildId} storage`);
    }
}

// Function to analyze server personality
function analyzeServerPersonality(guildId) {
    console.log(`🧠 Analyzing personality for server: ${guildId}`);
    
    const messages = serverMessages.get(guildId) || [];
    if (messages.length < 10) {
        console.log(`⚠️ Not enough messages for analysis (${messages.length}/10) - using default personality`);
        return {
            tone: "casual and friendly",
            style: "conversational",
            examples: []
        };
    }
    
    // Analyze recent messages for patterns
    const recentMessages = messages.slice(-50);
    const messageTexts = recentMessages.map(m => m.content);
    
    console.log(`📈 Analyzing ${messageTexts.length} recent messages for patterns...`);
    
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
    
    console.log(`📊 Analysis results:
    - Emoji rate: ${Math.round(emojiRate * 100)}%
    - Slang rate: ${Math.round(slangRate * 100)}%
    - Casual rate: ${Math.round(casualRate * 100)}%
    - Contraction rate: ${Math.round(contractionRate * 100)}%`);
    
    let tone = "casual and friendly";
    let style = "conversational";
    
    if (slangRate > 0.3 || emojiRate > 0.4) {
        tone = "very casual and expressive";
        style = "informal with slang and emojis";
        console.log(`🎭 Server personality: Very casual and expressive`);
    } else if (casualRate > 0.2 && contractionRate > 0.3) {
        tone = "relaxed and conversational";
        style = "casual with contractions";
        console.log(`🎭 Server personality: Relaxed and conversational`);
    } else if (formalCount > casualCount) {
        tone = "more formal and polite";
        style = "structured and proper";
        console.log(`🎭 Server personality: Formal and polite`);
    } else {
        console.log(`🎭 Server personality: Default casual and friendly`);
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

async function callGroqAI(message, username, guildId) {
    console.log(`🤖 Calling Groq AI for user: ${username}`);
    console.log(`📝 Message: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`);
    
    try {
        const personality = guildId ? analyzeServerPersonality(guildId) : null;
        let systemPrompt = `You are a helpful AI assistant in a Discord server. Keep responses conversational, friendly, and under 2000 characters. The user's name is ${username}. Be engaging and match the tone of the conversation.`;
        
        if (personality) {
            systemPrompt += ` The server has a ${personality.tone} communication style that is ${personality.style}.`;
            console.log(`🎨 Using server personality: ${personality.tone}`);
        }
        
        const requestData = {
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: message
                }
            ],
            model: 'llama3-8b-8192',
            temperature: 0.7,
            max_tokens: 500,
        };
        
        console.log(`📤 Sending request to Groq API...`);
        const startTime = Date.now();
        
        const response = await axios.post(
            GROQ_API_URL,
            requestData,
            {
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const responseTime = Date.now() - startTime;
        const aiResponse = response.data.choices[0].message.content;
        
        console.log(`✅ Groq API response received in ${responseTime}ms`);
        console.log(`📋 Response: "${aiResponse.substring(0, 150)}${aiResponse.length > 150 ? '...' : ''}"`);
        console.log(`📊 Token usage - Prompt: ${response.data.usage?.prompt_tokens || 'N/A'}, Completion: ${response.data.usage?.completion_tokens || 'N/A'}`);
        
        return aiResponse;
    } catch (error) {
        console.error('❌ Error calling Groq AI:', error.response?.data || error.message);
        if (error.response?.status) {
            console.error(`📊 HTTP Status: ${error.response.status}`);
        }
        return 'Sorry, I encountered an error while processing your request. Please try again later.';
    }
}

// Function to check if user is on cooldown
function isOnCooldown(userId) {
    if (userCooldowns.has(userId)) {
        const expirationTime = userCooldowns.get(userId) + COOLDOWN_TIME;
        if (Date.now() < expirationTime) {
            const remainingTime = Math.ceil((expirationTime - Date.now()) / 1000);
            console.log(`⏰ User ${userId} is on cooldown for ${remainingTime} more seconds`);
            return true;
        }
    }
    return false;
}

// Function to set user cooldown
function setCooldown(userId) {
    userCooldowns.set(userId, Date.now());
    console.log(`⏰ Set cooldown for user: ${userId}`);
}

// Bot ready event
client.once('ready', () => {
    console.log(`\n🎉 SUCCESS! Bot is now online!`);
    console.log(`🤖 Bot: ${client.user.tag}`);
    console.log(`🆔 Bot ID: ${client.user.id}`);
    console.log(`📊 Connected to ${client.guilds.cache.size} server(s):`);
    
    client.guilds.cache.forEach(guild => {
        console.log(`   • ${guild.name} (${guild.memberCount} members)`);
    });
    
    // Set bot status
    client.user.setActivity('for @mentions | Powered by Groq AI', { type: 'WATCHING' });
    console.log(`✅ Bot status set successfully`);
    console.log(`\n🔍 Monitoring messages and waiting for mentions...\n`);
});

// Guild events for logging
client.on('guildCreate', (guild) => {
    console.log(`➕ Joined new server: ${guild.name} (${guild.memberCount} members)`);
});

client.on('guildDelete', (guild) => {
    console.log(`➖ Left server: ${guild.name}`);
    // Clean up stored data for this server
    if (serverMessages.has(guild.id)) {
        serverMessages.delete(guild.id);
        console.log(`🗑️ Cleaned up stored messages for ${guild.name}`);
    }
});

// Message event handler
client.on('messageCreate', async (message) => {
    // Ignore messages from bots (but not the bot's own messages for analysis)
    if (message.author.bot && message.author.id !== client.user.id) return;
    
    const serverName = message.guild ? message.guild.name : 'DM';
    const channelName = message.channel.name || 'DM';
    const userName = message.author.displayName || message.author.username;
    
    // Don't analyze the bot's own responses, but analyze all other messages
    if (message.author.id !== client.user.id && message.guild) {
        // Add every message to server training data (except bot mentions)
        if (!message.mentions.has(client.user) && message.content.length > 3) {
            console.log(`👂 Listening in ${serverName}/#${channelName} - ${userName}: "${message.content.substring(0, 50)}${message.content.length > 50 ? '...' : ''}"`);
            addServerMessage(
                message.guild.id, 
                message.content, 
                userName
            );
        }
    }

    // Only respond when mentioned
    if (!message.mentions.has(client.user)) return;

    console.log(`\n🔔 BOT MENTIONED!`);
    console.log(`📍 Server: ${serverName}`);
    console.log(`📍 Channel: #${channelName}`);
    console.log(`👤 User: ${userName} (${message.author.id})`);
    console.log(`💬 Full message: "${message.content}"`);

    // Check cooldown
    if (isOnCooldown(message.author.id)) {
        const remainingTime = Math.ceil((userCooldowns.get(message.author.id) + COOLDOWN_TIME - Date.now()) / 1000);
        console.log(`🚫 User on cooldown, sending cooldown message`);
        message.reply(`⏰ Please wait ${remainingTime} more seconds before asking another question.`);
        return;
    }

    // Set cooldown
    setCooldown(message.author.id);

    // Show typing indicator
    console.log(`⌨️ Showing typing indicator...`);
    await message.channel.sendTyping();

    try {
        // Clean the message content (remove mentions)
        let cleanContent = message.content
            .replace(/<@!?\d+>/g, '') // Remove user mentions
            .replace(/<@&\d+>/g, '')  // Remove role mentions
            .replace(/<#\d+>/g, '')   // Remove channel mentions
            .trim();

        console.log(`🧹 Cleaned message: "${cleanContent}"`);

        // If no content after cleaning mentions, provide a default response
        if (!cleanContent) {
            cleanContent = "Hello! How can I help you?";
            console.log(`🔄 Using default message: "${cleanContent}"`);
        }

        // Get response from Groq AI with server personality
        const groqResponse = await callGroqAI(
            cleanContent, 
            userName, 
            message.guild?.id || null
        );

        // Send plain text response
        console.log(`📤 Sending response to Discord...`);
        const sentMessage = await message.reply(groqResponse);
        console.log(`✅ Response sent successfully! Message ID: ${sentMessage.id}`);
        console.log(`📏 Response length: ${groqResponse.length} characters\n`);

    } catch (error) {
        console.error('❌ Error processing message:', error);
        console.error('📋 Error details:', error.stack);
        await message.reply('❌ Sorry, I encountered an error while processing your request. Please try again later.');
    }
});

// Error handling
client.on('error', (error) => {
    console.error('❌ Discord client error:', error);
});

client.on('warn', (warning) => {
    console.warn('⚠️ Discord client warning:', warning);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

// Graceful shutdown
const shutdown = () => {
    console.log('\n🛑 Shutting down gracefully...');
    console.log('📊 Final stats:');
    console.log(`   • Servers: ${client.guilds?.cache.size || 0}`);
    console.log(`   • Stored server data: ${serverMessages.size}`);
    console.log(`   • Active cooldowns: ${userCooldowns.size}`);
    
    client.destroy();
    console.log('✅ Discord client destroyed');
    console.log('👋 Goodbye!');
    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Validation and login
console.log('🔍 Validating environment variables...');

if (!DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN is not set in environment variables');
    console.error('💡 Make sure to set DISCORD_TOKEN in your .env file');
    process.exit(1);
}

if (!GROQ_API_KEY) {
    console.error('❌ GROQ_API_KEY is not set in environment variables');
    console.error('💡 Make sure to set GROQ_API_KEY in your .env file');
    process.exit(1);
}

console.log('✅ Environment variables validated');
console.log('🔐 Attempting to login to Discord...');

client.login(DISCORD_TOKEN).catch((error) => {
    console.error('❌ Failed to login to Discord:', error);
    console.error('💡 Check if your DISCORD_TOKEN is valid');
    process.exit(1);
});
