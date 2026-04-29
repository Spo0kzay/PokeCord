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

// per-server spawn channels
const spawnChannels = {};

// active encounter
let currentPokemon = null;
let wrongGuesses = 0;
let despawnTimer = null;

// --------------------
// REGISTER SLASH COMMAND
// --------------------
const commands = [
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Set Pokémon spawn channel')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Spawn channel')
                .setRequired(true)
        )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log("Registering slash commands...");

        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands }
        );

        console.log("Slash commands registered.");
    } catch (err) {
        console.error(err);
    }
})();

// --------------------
// /setup handler
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
// SPAWN FUNCTION
// --------------------
async function spawnPokemon(channel) {
    if (currentPokemon) return;

    try {
        const randomId = Math.floor(Math.random() * 1025) + 1;

        const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${randomId}`);
        const data = await res.json();

        const name = data.name.toLowerCase();

        const image =
            data.sprites.other["official-artwork"].front_default ||
            data.sprites.front_default;

        if (!image) return spawnPokemon(channel);

        currentPokemon = { name };
        wrongGuesses = 0;

        const embed = new EmbedBuilder()
            .setTitle("🌿 A wild Pokémon appeared!")
            .setDescription(
                "Type `!catch <name>` to catch it!\n\n" +
                `🧪 Debug: **${name.toUpperCase()}**`
            )
            .setImage(image)
            .setColor(0x00ff99);

        await channel.send({ embeds: [embed] });

        console.log(`Spawned: ${name}`);

        // 10 min despawn
        despawnTimer = setTimeout(() => {
            if (currentPokemon) {
                channel.send(`💨 The wild **${currentPokemon.name.toUpperCase()}** ran away...`);
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

        await message.reply(`🎉 ${message.author} caught **${currentPokemon.name.toUpperCase()}**!`);

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

            if (channel) {
                spawnPokemon(channel);
            }
        }
    }, 30000);
});

// --------------------
// LOGIN
// --------------------
client.login(TOKEN);
