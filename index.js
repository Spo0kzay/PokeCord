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
    intents: [GatewayIntentBits.Guilds]
});

// store spawn channel per server
const spawnChannels = {};

// --------------------
// REGISTER SLASH COMMAND
// --------------------
const commands = [
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Set the Pokémon spawn channel')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel for Pokémon spawns')
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
// HANDLE /setup
// --------------------
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'setup') {
        const channel = interaction.options.getChannel('channel');

        spawnChannels[interaction.guildId] = channel.id;

        await interaction.reply({
            content: `✅ PokéCord spawn channel set to ${channel}`,
            ephemeral: true
        });
    }
});

// --------------------
// SPAWN FUNCTION (EEVEE ONLY)
// --------------------
async function spawnEevee(channel) {
    try {
        const res = await fetch("https://pokeapi.co/api/v2/pokemon/eevee");
        const data = await res.json();

        const image =
            data.sprites.other["official-artwork"].front_default ||
            data.sprites.front_default;

        const embed = new EmbedBuilder()
            .setTitle("🌿 A wild Eevee appeared!")
            .setDescription("Type the name to catch it!")
            .setImage(image)
            .setColor(0x00ff99);

        await channel.send({ embeds: [embed] });

        console.log("Spawned Eevee");

    } catch (err) {
        console.error("Spawn error:", err);
    }
}

// --------------------
// LOOP (EVERY 30 SECONDS)
// --------------------
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);

    setInterval(() => {
        for (const guildId in spawnChannels) {
            const channelId = spawnChannels[guildId];
            const channel = client.channels.cache.get(channelId);

            if (channel) {
                spawnEevee(channel);
            }
        }
    }, 30000);
});

// --------------------
// LOGIN
// --------------------
client.login(TOKEN);
