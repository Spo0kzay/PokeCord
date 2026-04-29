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
const shinyRole = {};
const mythicRole = {};
const eventConfig = {};

let currentPokemon = null;
let currentMessage = null;
let wrongGuesses = 0;
let despawnTimer = null;

const streaks = {};

// --------------------
// RARITY
// --------------------
function getRarity(id) {
    if (id <= 150) return { name: "Common 🟢", color: 0x2ecc71 };
    if (id <= 400) return { name: "Rare 🔵", color: 0x3498db };
    if (id <= 700) return { name: "Epic 🟣", color: 0x9b59b6 };
    if (id <= 900) return { name: "Legendary 🟠", color: 0xe67e22 };
    return { name: "Mythic 🔴", color: 0xe74c3c };
}

function getWeightedPokemonId() {
    const r = Math.random();
    if (r < 0.7) return Math.floor(Math.random() * 500) + 1;
    if (r < 0.95) return Math.floor(Math.random() * 400) + 500;
    return Math.floor(Math.random() * 125) + 900;
}

function isShiny() {
    return Math.random() < 0.01;
}

// --------------------
// SLASH COMMANDS
// --------------------
const commands = [
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Set spawn channel')
        .addChannelOption(o =>
            o.setName('channel').setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('setuprole')
        .setDescription('Set special roles')
        .addRoleOption(o =>
            o.setName('shinyhunter')
        )
        .addRoleOption(o =>
            o.setName('mythichunter')
        ),

    new SlashCommandBuilder()
        .setName('eventinfo')
        .setDescription('View event timing info')
        .addStringOption(o =>
            o.setName('type')
                .setRequired(true)
                .addChoices(
                    { name: 'legendary', value: 'legendary' },
                    { name: 'mythic', value: 'mythic' }
                )
        )
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands }
    );
})();

// --------------------
// COMMAND HANDLER
// --------------------
client.on('interactionCreate', async (i) => {
    if (!i.isChatInputCommand()) return;

    // setup channel
    if (i.commandName === 'setup') {
        spawnChannels[i.guildId] = i.options.getChannel('channel').id;
        return i.reply({ content: "✅ Spawn channel set", ephemeral: true });
    }

    // roles
    if (i.commandName === 'setuprole') {
        const shiny = i.options.getRole('shinyhunter');
        const mythic = i.options.getRole('mythichunter');

        if (shiny) shinyRole[i.guildId] = shiny.id;
        if (mythic) mythicRole[i.guildId] = mythic.id;

        return i.reply({ content: "✅ Roles set", ephemeral: true });
    }

    // event info
    if (i.commandName === 'eventinfo') {
        const type = i.options.getString('type');

        const data = {
            legendary: {
                cooldown: "12 hours",
                description: "🔥 Legendary events spawn powerful Pokémon with boosted rarity rates."
            },
            mythic: {
                cooldown: "48 hours",
                description: "👑 Mythic events are extremely rare server-wide special spawns."
            }
        };

        const e = data[type];

        const embed = new EmbedBuilder()
            .setTitle(`📅 ${type.toUpperCase()} EVENT INFO`)
            .setDescription(
                `⏰ Cooldown: **${e.cooldown}**\n\n${e.description}`
            )
            .setColor(type === "mythic" ? 0xe74c3c : 0xe67e22);

        return i.reply({ embeds: [embed], ephemeral: true });
    }
});

// --------------------
// SPAWN
// --------------------
async function spawnPokemon(channel) {
    if (currentPokemon) return;

    const id = getWeightedPokemonId();
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
    const data = await res.json();

    const name = data.name.toLowerCase();
    const shiny = isShiny();
    const rarity = getRarity(id);

    const image =
        data.sprites.other["official-artwork"].front_default ||
        data.sprites.front_default;

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

    despawnTimer = setTimeout(() => {
        if (!currentPokemon) return;

        currentMessage.edit({
            embeds: [
                new EmbedBuilder()
                    .setTitle(`💨 ${currentPokemon.name.toUpperCase()} ran away!`)
                    .setColor(0x95a5a6)
            ]
        });

        currentPokemon = null;
    }, 10 * 60 * 1000);
}

// --------------------
// CATCH
// --------------------
client.on("messageCreate", async (m) => {
    if (m.author.bot) return;
    if (!m.content.startsWith("!catch")) return;

    if (!currentPokemon) return;

    const guess = m.content.split(" ")[1]?.toLowerCase();
    if (!guess) return;

    if (guess === currentPokemon.name) {
        clearTimeout(despawnTimer);

        const embed = new EmbedBuilder()
            .setTitle(`🎉 ${currentPokemon.name.toUpperCase()} has been caught!`)
            .setDescription(
                `🏆 | Caught by: ${m.author}\n` +
                `📊 Rarity: ${currentPokemon.rarity.name}\n` +
                (currentPokemon.shiny ? "✨ Shiny!!\n" : "")
            )
            .setColor(currentPokemon.rarity.color);

        await m.channel.send({ embeds: [embed] });

        currentPokemon = null;
    } else {
        wrongGuesses++;

        if (wrongGuesses >= 10) {
            clearTimeout(despawnTimer);

            m.channel.send(`💨 ${currentPokemon.name.toUpperCase()} ran away!`);

            currentPokemon = null;
        }
    }
});

// --------------------
// LOOP
// --------------------
client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);

    setInterval(() => {
        for (const g in spawnChannels) {
            const ch = client.channels.cache.get(spawnChannels[g]);
            if (ch) spawnPokemon(ch);
        }
    }, 30000);
});

client.login(TOKEN);
