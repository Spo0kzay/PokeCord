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
let currentChannel = null;

let wrongGuesses = 0;
let despawnTimer = null;

// 🧠 per-user guesses (3 per Pokémon)
const userGuesses = {};

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
            o.setName('channel')
                .setDescription('Spawn channel')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('setuprole')
        .setDescription('Set roles')
        .addRoleOption(o =>
            o.setName('shinyhunter')
                .setDescription('Shiny hunter role')
        )
        .addRoleOption(o =>
            o.setName('mythichunter')
                .setDescription('Mythic hunter role')
        ),

    new SlashCommandBuilder()
        .setName('eventinfo')
        .setDescription('Event info')
        .addStringOption(o =>
            o.setName('type')
                .setDescription('legendary or mythic')
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
// COMMANDS
// --------------------
client.on('interactionCreate', async (i) => {
    if (!i.isChatInputCommand()) return;

    if (i.commandName === 'setup') {
        spawnChannels[i.guildId] = i.options.getChannel('channel').id;
        return i.reply({ content: "✅ Spawn channel set", ephemeral: true });
    }

    if (i.commandName === 'setuprole') {
        return i.reply({ content: "✅ Roles saved", ephemeral: true });
    }

    if (i.commandName === 'eventinfo') {
        const type = i.options.getString('type');

        const data = {
            legendary: { time: "12 hours", desc: "🔥 Rare powerful Pokémon events" },
            mythic: { time: "48 hours", desc: "👑 Ultra rare server-wide events" }
        };

        const e = data[type];

        const embed = new EmbedBuilder()
            .setTitle(`📅 ${type.toUpperCase()} EVENT`)
            .setDescription(`⏰ Cooldown: **${e.time}**\n\n${e.desc}`)
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
    currentChannel = channel;

    // reset user guesses
    for (const k in userGuesses) delete userGuesses[k];

    const embed = new EmbedBuilder()
        .setTitle("🌿 A wild Pokémon appeared!")
        .setDescription(
            "Type `!catch <name>` (3 tries per person)\n\n" +
            `🧪 Debug: **${name.toUpperCase()}${shiny ? " ✨ SHINY" : ""}**\n` +
            `📊 Rarity: **${rarity.name}**`
        )
        .setImage(image)
        .setColor(rarity.color);

    currentMessage = await channel.send({ embeds: [embed] });

    // 10 min timer
    despawnTimer = setTimeout(() => runAway(channel), 10 * 60 * 1000);
}

// --------------------
// RUN AWAY (EDIT ORIGINAL MESSAGE)
// --------------------
async function runAway(channel) {
    if (!currentPokemon) return;

    const embed = new EmbedBuilder()
        .setTitle(`💨 ${currentPokemon.name.toUpperCase()} ran away!`)
        .setColor(0x95a5a6)
        .setImage(currentMessage?.embeds?.[0]?.image?.url);

    if (currentMessage) {
        await currentMessage.edit({ embeds: [embed] });
    }

    currentPokemon = null;
    wrongGuesses = 0;
}

// --------------------
// CATCH SYSTEM (3 GUESSES PER USER)
// --------------------
client.on("messageCreate", async (m) => {
    if (m.author.bot) return;
    if (!m.content.startsWith("!catch")) return;
    if (!currentPokemon) return;

    const guess = m.content.split(" ")[1]?.toLowerCase();
    if (!guess) return;

    const userId = m.author.id;

    if (!userGuesses[userId]) userGuesses[userId] = 0;

    // ❌ limit per user
    if (userGuesses[userId] >= 3) {
        return m.reply("❌ You’ve used all 3 guesses for this Pokémon!");
    }

    userGuesses[userId]++;

    // ❌ wrong guess
    if (guess !== currentPokemon.name) {
        m.react("❌");

        wrongGuesses++;

        if (wrongGuesses >= 10) {
            clearTimeout(despawnTimer);
            runAway(m.channel);
        }

        return;
    }

    // 🏆 correct catch
    clearTimeout(despawnTimer);

    const embed = new EmbedBuilder()
        .setTitle(`🎉 ${currentPokemon.name.toUpperCase()} has been caught!`)
        .setDescription(
            `🏆 | Caught by: ${m.author}\n` +
            `📊 Rarity: ${currentPokemon.rarity.name}\n` +
            (currentPokemon.shiny ? "✨ Shiny!!\n" : "")
        )
        .setColor(currentPokemon.rarity.color)
        .setImage(currentMessage?.embeds?.[0]?.image?.url);

    // ✏️ EDIT ORIGINAL SPAWN MESSAGE
    if (currentMessage) {
        await currentMessage.edit({ embeds: [embed] });
    }

    // 📢 NEW MESSAGE
    await m.channel.send(
        `🎉 **${currentPokemon.name.toUpperCase()}** has been caught!`
    );

    currentPokemon = null;
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
