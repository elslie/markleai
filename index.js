require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
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

// Function to call Groq AI
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
    // Ignore messages from bots
    if (message.author.bot) return;

    // Check if bot is mentioned
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
    message.channel.sendTyping();

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

        // Get response from Groq AI
        const groqResponse = await callGroqAI(cleanContent, message.author.displayName);

        // Create embed for the response
        const embed = new EmbedBuilder()
            .setColor(0x00AE86)
            .setAuthor({
                name: `${message.author.displayName} asked:`,
                iconURL: message.author.displayAvatarURL()
            })
            .setDescription(cleanContent)
            .addFields({
                name: '🤖 Groq AI Response',
                value: groqResponse
            })
            .setFooter({
                text: 'Powered by Groq AI',
                iconURL: client.user.displayAvatarURL()
            })
            .setTimestamp();

        // Send the response
        await message.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Error processing message:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Error')
            .setDescription('I encountered an error while processing your request. Please try again later.')
            .setFooter({
                text: 'If this persists, contact the server administrator',
            })
            .setTimestamp();

        message.reply({ embeds: [errorEmbed] });
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
