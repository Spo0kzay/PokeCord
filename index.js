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

let currentPokemon = null;
let currentMessage = null;
let wrongGuesses = 0;
let despawnTimer = null;

// streak system
const streaks = {};

// --------------------
// RARITY SYSTEM
// --------------------
function getRarity(id) {
    if (id <= 150) return { name: "Common 🟢", color: 0x2ecc71 };
    if (id <= 400) return { name: "Rare 🔵", color: 0x3498db };
    if (id <= 700) return { name: "Epic 🟣", color: 0x9b59b6 };
    if (id <= 900) return { name: "Legendary 🟠", color: 0xe67e22 };
    return { name: "Mythic 🔴", color: 0xe74c3c };
}

// weighted spawn
function getWeightedPokemonId() {
    const roll = Math.random();

    if (roll < 0.7) return Math.floor(Math.random() * 500) + 1;
    if (roll < 0.95) return Math.floor(Math.random() * 400) + 500;
    return Math.floor(Math.random() * 125) + 900;
}

// shiny chance
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
        .setDescription('Set special roles')
        .addRoleOption(o =>
            o.setName('shinyhunter')
                .setDescription('Shiny hunter role')
                .setRequired(false)
        )
        .addRoleOption(o =>
            o.setName('mythichunter')
                .setDescription('Mythic hunter role')
                .setRequired(false)
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

    // setup roles
    if (i.commandName === 'setuprole') {
        const shiny = i.options.getRole('shinyhunter');
        const mythic = i.options.getRole('mythichunter');

        if (shiny) shinyRole[i.guildId] = shiny.id;
        if (mythic) mythicRole[i.guildId] = mythic.id;

        return i.reply({
            content: "✅ Roles updated",
            ephemeral: true
        });
    }
});

// --------------------
// STREAK LOGIC
// --------------------
function getStreakBonus(userId) {
    const s = streaks[userId] || 0;

    if (s >= 100) return "mythic";
    if (s >= 25) return "legendary";
    if (s >= 10) return "epic";
    if (s >= 5) return "rare";

    return null;
}

// force rarity override
function forceRarity(type) {
    if (type === "rare") return { name: "Rare 🟡", color: 0xf1c40f };
    if (type === "epic") return { name: "Epic 🟣", color: 0x9b59b6 };
    if (type === "legendary") return { name: "Legendary 🟠", color: 0xe67e22 };
    if (type === "mythic") return { name: "Mythic 🔴", color: 0xe74c3c };
}

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
    let rarity = getRarity(id);

    const image =
        data.sprites.other["official-artwork"].front_default ||
        data.sprites.front_default;

    currentPokemon = { name, shiny, rarity };
    wrongGuesses = 0;

    const embed = new EmbedBuilder()
        .setTitle("🌿 A wild Pokémon appeared!")
        .setDescription("Type `!catch <name>` to catch it!")
        .setImage(image)
        .setColor(rarity.color);

    currentMessage = await channel.send({ embeds: [embed] });

    // 10 min runaway
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
        wrongGuesses = 0;
    }, 10 * 60 * 1000);
}

// --------------------
// CATCH SYSTEM
// --------------------
client.on("messageCreate", async (m) => {
    if (m.author.bot) return;
    if (!m.content.startsWith("!catch")) return;

    if (!currentPokemon) return;

    const guess = m.content.split(" ")[1]?.toLowerCase();

    if (!guess) return;

    const userId = m.author.id;

    streaks[userId] = streaks[userId] || 0;

    const bonus = getStreakBonus(userId);

    let rarity = currentPokemon.rarity;

    if (bonus) rarity = forceRarity(bonus);

    if (guess === currentPokemon.name) {
        clearTimeout(despawnTimer);

        streaks[userId]++;

        const embed = new EmbedBuilder()
            .setTitle(`🎉 ${currentPokemon.name.toUpperCase()} has been caught!`)
            .setDescription(
                `🏆 | Caught by: ${m.author}\n` +
                `📊 Rarity: ${rarity.name}\n` +
                (currentPokemon.shiny ? `✨ Shiny!!\n` : "") +
                `🔥 Streak: ${streaks[userId]}`
            )
            .setColor(rarity.color);

        await m.channel.send({ embeds: [embed] });

        currentPokemon = null;
        wrongGuesses = 0;

    } else {
        wrongGuesses++;

        streaks[userId] = 0; // reset streak on fail

        await currentMessage.edit({
            embeds: [
                new EmbedBuilder()
                    .setTitle("🌿 A wild Pokémon appeared!")
                    .setDescription(
                        "Type `!catch <name>` to catch it!\n\n" +
                        `❌ Wrong attempts: ${wrongGuesses}/10`
                    )
                    .setImage(currentMessage.embeds[0]?.image?.url)
                    .setColor(currentPokemon.rarity.color)
            ]
        });

        if (wrongGuesses >= 10) {
            clearTimeout(despawnTimer);

            currentMessage.edit({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`💨 ${currentPokemon.name.toUpperCase()} ran away!`)
                        .setColor(0x95a5a6)
                ]
            });

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
        for (const g in spawnChannels) {
            const ch = client.channels.cache.get(spawnChannels[g]);
            if (ch) spawnPokemon(ch);
        }
    }, 30000);
});

client.login(TOKEN);
