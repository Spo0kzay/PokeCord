require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    Routes,
    REST,
    EmbedBuilder
} = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// --------------------
// STATE
// --------------------
const spawnChannels = {};

let currentPokemon = null;
let currentMessage = null;
let wrongGuesses = 0;
let despawnTimer = null;

// --------------------
// RARITY SYSTEM
// --------------------
function getRarity(id) {
    if (id <= 150) return { name: "Common 🟢", color: 0x2ecc71 };
    if (id <= 400) return { name: "Uncommon 🟡", color: 0xf1c40f };
    if (id <= 700) return { name: "Rare 🔵", color: 0x3498db };
    if (id <= 900) return { name: "Very Rare 🟣", color: 0x9b59b6 };
    return { name: "Legendary 🟠", color: 0xe67e22 };
}

// weighted spawn (more basics, fewer legendaries)
function getWeightedPokemonId() {
    const roll = Math.random();

    if (roll < 0.7) return Math.floor(Math.random() * 500) + 1;
    if (roll < 0.95) return Math.floor(Math.random() * 400) + 500;
    return Math.floor(Math.random() * 125) + 900;
}

// shiny chance
function isShiny() {
    return Math.random() < 0.01; // 1%
}

// --------------------
// SLASH COMMAND SETUP
// --------------------
const commands = [
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Set spawn channel')
        .addChannelOption(opt =>
            opt.setName('channel')
                .setDescription('Spawn channel')
                .setRequired(true)
        )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands }
    );
})();

// --------------------
// SETUP COMMAND
// --------------------
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'setup') {
        const channel = interaction.options.getChannel('channel');
        spawnChannels[interaction.guildId] = channel.id;

        await interaction.reply({
            content: `✅ Spawn channel set to ${channel}`,
            ephemeral: true
        });
    }
});

// --------------------
// SPAWN SYSTEM
// --------------------
async function spawnPokemon(channel) {
    if (currentPokemon) return;

    try {
        const id = getWeightedPokemonId();

        const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
        const data = await res.json();

        const name = data.name.toLowerCase();
        const shiny = isShiny();
        const rarity = getRarity(id);

        const image =
            data.sprites.other["official-artwork"].front_default ||
            data.sprites.front_default;

        if (!image) return spawnPokemon(channel);

        currentPokemon = { name, shiny, rarity };
        wrongGuesses = 0;

        const embed = new EmbedBuilder()
            .setTitle("🌿 A wild Pokémon appeared!")
            .setDescription(
                "Type `!catch <name>` to catch it!\n\n" +
                `🧪 Debug: **${name.toUpperCase()}${shiny ? " ✨ SHINY" : ""}**\n` +
                `📊 Rarity: **${rarity.name}**`
            )
            .setImage(image)
            .setColor(rarity.color);

        currentMessage = await channel.send({ embeds: [embed] });

        // 10 min despawn
        despawnTimer = setTimeout(() => {
            if (currentPokemon) {
                currentMessage.edit(
                    `💨 The wild **${currentPokemon.name.toUpperCase()}** ran away...`
                );

                currentPokemon = null;
                wrongGuesses = 0;
            }
        }, 10 * 60 * 1000);

    } catch (err) {
        console.error("Spawn error:", err);
    }
}

// --------------------
// CATCH SYSTEM
// --------------------
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith("!catch")) return;

    if (!currentPokemon) {
        return message.reply("❌ No Pokémon is currently available!");
    }

    const guess = message.content.split(" ")[1]?.toLowerCase();

    if (!guess) {
        return message.reply("Use: `!catch <pokemon>`");
    }

    if (guess === currentPokemon.name) {
        clearTimeout(despawnTimer);

        const shinyText = currentPokemon.shiny ? " ✨ SHINY" : "";

        await message.reply(
            `🎉 ${message.author} caught **${currentPokemon.name.toUpperCase()}${shinyText}**!`
        );

        if (currentMessage) {
            await currentMessage.edit(
                `🏆 Caught by **${message.author.username}**\n` +
                `🐾 Pokémon: **${currentPokemon.name.toUpperCase()}${shinyText}**\n` +
                `📊 Rarity: **${currentPokemon.rarity.name}**`
            );
        }

        currentPokemon = null;
        wrongGuesses = 0;

    } else {
        wrongGuesses++;
        message.react("❌");

        if (wrongGuesses >= 10) {
            clearTimeout(despawnTimer);

            message.channel.send(
                `💨 The wild **${currentPokemon.name.toUpperCase()}** ran away due to too many failed attempts...`
            );

            currentPokemon = null;
            wrongGuesses = 0;
        }
    }
});

// --------------------
// LOOP
// --------------------
client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);

    setInterval(() => {
        for (const guildId in spawnChannels) {
            const channel = client.channels.cache.get(spawnChannels[guildId]);

            if (channel) spawnPokemon(channel);
        }
    }, 30000);
});

// --------------------
// LOGIN
// --------------------
client.login(TOKEN);
