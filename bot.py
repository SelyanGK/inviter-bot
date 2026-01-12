require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
    console.error('ERROR: Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env file');
    process.exit(1);
}

const EMBED_COLOR = 0xFF8C00;
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildInvites] });

const cache = new Map();
const counts = new Map();
const inviters = new Map();
const history = new Map();

const getData = (m, g) => m.has(g) ? m.get(g) : m.set(g, new Map()).get(g);
const getCount = (g, u) => getData(counts, g).get(u) || 0;
const inc = (g, u) => getData(counts, g).set(u, getCount(g, u) + 1);
const dec = (g, u) => getData(counts, g).set(u, Math.max(0, getCount(g, u) - 1));

const cacheInvites = async (guild) => {
    try {
        const invites = await guild.invites.fetch();
        const m = new Map();
        invites.forEach(i => m.set(i.code, { uses: i.uses || 0, inviterId: i.inviter?.id }));
        cache.set(guild.id, m);
        console.log(`Cached ${invites.size} invites for ${guild.name}`);
    } catch (e) { console.error(`Error caching invites: ${e.message}`); }
};

const findUsed = async (guild) => {
    try {
        const newInvites = await guild.invites.fetch();
        const cached = cache.get(guild.id) || new Map();
        for (const [code, inv] of newInvites) {
            const c = cached.get(code);
            const uses = inv.uses || 0;
            if (c && uses > c.uses) {
                c.uses = uses;
                return { code, inviterId: inv.inviter?.id };
            }
        }
        newInvites.forEach(i => cached.has(i.code) && (cached.get(i.code).uses = i.uses || 0));
        return null;
    } catch (e) { return null; }
};

const commands = [
    new SlashCommandBuilder().setName('invites').setDescription('Shows invite count for a user').addUserOption(o => o.setName('user').setDescription('The user to check (leave empty for yourself)')),
    new SlashCommandBuilder().setName('inviter').setDescription('Shows who invited a specific member').addUserOption(o => o.setName('member').setDescription('The member to check').setRequired(true)),
    new SlashCommandBuilder().setName('ping').setDescription("Shows the bot's latency"),
    new SlashCommandBuilder().setName('resetinvites').setDescription('Reset all invite data for a user').addUserOption(o => o.setName('user').setDescription('The user to reset invites for').setRequired(true)).setDefaultMemberPermissions(0x8),
    new SlashCommandBuilder().setName('addinvites').setDescription('Add invites to a user').addUserOption(o => o.setName('user').setDescription('The user to add invites to').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('Number of invites to add').setRequired(true).setMinValue(1)).setDefaultMemberPermissions(0x8),
    new SlashCommandBuilder().setName('removeinvites').setDescription('Remove invites from a user').addUserOption(o => o.setName('user').setDescription('The user to remove invites from').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('Number of invites to remove').setRequired(true).setMinValue(1)).setDefaultMemberPermissions(0x8),
    new SlashCommandBuilder().setName('invitespanel').setDescription('Send an invite panel to a channel').addChannelOption(o => o.setName('channel').setDescription('The channel to send the panel to').setRequired(true)).setDefaultMemberPermissions(0x8)
].map(c => c.toJSON());

new REST({ version: '10' }).setToken(TOKEN).put(Routes.applicationCommands(CLIENT_ID), { body: commands }).then(() => console.log('Commands registered')).catch(console.error);

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    for (const g of client.guilds.cache.values()) await cacheInvites(g);
    console.log('Bot ready!');
});

client.on('guildCreate', cacheInvites);

client.on('inviteCreate', i => {
    const c = cache.get(i.guild.id) || new Map();
    c.set(i.code, { uses: i.uses || 0, inviterId: i.inviter?.id });
    cache.set(i.guild.id, c);
});

client.on('inviteDelete', i => cache.get(i.guild.id)?.delete(i.code));

client.on('guildMemberAdd', async m => {
    const used = await findUsed(m.guild);
    if (!used?.inviterId) return console.log(`${m.user.tag} joined - inviter unknown`);
    
    const h = getData(history, m.guild.id);
    const inv = getData(inviters, m.guild.id);
    
    if (h.has(m.id)) {
        const d = h.get(m.id);
        if (d.left) {
            d.rejoinCount++;
            d.left = false;
        }
    } else {
        h.set(m.id, { inviterId: used.inviterId, left: false, rejoinCount: 0 });
    }
    
    inv.set(m.id, used.inviterId);
    inc(m.guild.id, used.inviterId);
    console.log(`${m.user.tag} joined via ${used.inviterId}`);
});

client.on('guildMemberRemove', m => {
    const h = getData(history, m.guild.id);
    const inv = getData(inviters, m.guild.id);
    
    h.has(m.id) && (h.get(m.id).left = true);
    const invId = inv.get(m.id);
    invId && (dec(m.guild.id, invId), inv.delete(m.id));
    console.log(`${m.user.tag} left`);
});

client.on('interactionCreate', async i => {
    if (i.isCommand()) {
        const { commandName: cmd, guildId: g } = i;
        const embed = () => new EmbedBuilder().setColor(EMBED_COLOR).setTimestamp();
        
        if (cmd === 'invites') {
            const u = i.options.getUser('user') || i.user;
            const c = getCount(g, u.id);
            await i.reply({ embeds: [embed().setTitle('Invite Count').setDescription(`${u} has invited **${c}** member${c !== 1 ? 's' : ''} to this server.`)] });
        }
        
        else if (cmd === 'inviter') {
            const u = i.options.getUser('member');
            const info = getData(history, g).get(u.id);
            const e = embed().setTitle('Inviter Information');
            
            if (info?.inviterId) {
                let d = `${u} was invited by <@${info.inviterId}>.`;
                info.left ? d += '\n\n**Status:** Left the server' : info.rejoinCount > 0 && (d += `\n\n**Status:** Rejoined the server (${info.rejoinCount} time${info.rejoinCount !== 1 ? 's' : ''})`);
                e.setDescription(d);
            } else {
                e.setDescription(`Inviter unknown for ${u}.`);
            }
            
            await i.reply({ embeds: [e] });
        }
        
        else if (cmd === 'ping') {
            await i.reply({ embeds: [embed().setTitle('Pong! 🏓').setDescription(`Latency: **${Math.round(client.ws.ping)}ms**`)] });
        }
        
        else if (cmd === 'resetinvites') {
            const u = i.options.getUser('user');
            getData(counts, g).set(u.id, 0);
            await i.reply({ embeds: [embed().setTitle('Invites Reset').setDescription(`Successfully reset all invite data for ${u}.`)] });
        }
        
        else if (cmd === 'addinvites') {
            const u = i.options.getUser('user');
            const amt = i.options.getInteger('amount');
            getData(counts, g).set(u.id, getCount(g, u.id) + amt);
            await i.reply({ embeds: [embed().setTitle('Invites Added').setDescription(`Added **${amt}** invite${amt !== 1 ? 's' : ''} to ${u}.\n\nNew total: **${getCount(g, u.id)}**`)] });
        }
        
        else if (cmd === 'removeinvites') {
            const u = i.options.getUser('user');
            const amt = i.options.getInteger('amount');
            getData(counts, g).set(u.id, Math.max(0, getCount(g, u.id) - amt));
            await i.reply({ embeds: [embed().setTitle('Invites Removed').setDescription(`Removed **${amt}** invite${amt !== 1 ? 's' : ''} from ${u}.\n\nNew total: **${getCount(g, u.id)}**`)] });
        }
        
        else if (cmd === 'invitespanel') {
            const ch = i.options.getChannel('channel');
            const btn = new ButtonBuilder().setCustomId('invite_button').setLabel('click here!').setStyle(ButtonStyle.Secondary);
            const row = new ActionRowBuilder().addComponents(btn);
            
            await ch.send({ embeds: [new EmbedBuilder().setDescription('click the button to see your invites!').setColor(EMBED_COLOR)], components: [row] });
            await i.reply({ embeds: [embed().setTitle('Panel Sent').setDescription(`Invite panel has been sent to ${ch}.`)], ephemeral: true });
        }
    }
    
    else if (i.isButton() && i.customId === 'invite_button') {
        const c = getCount(i.guildId, i.user.id);
        await i.reply({ embeds: [new EmbedBuilder().setTitle('Your Invites').setDescription(`You have invited **${c}** member${c !== 1 ? 's' : ''} to this server.`).setColor(EMBED_COLOR).setTimestamp()], ephemeral: true });
    }
});

client.login(TOKEN);
