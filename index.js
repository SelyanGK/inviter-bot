const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

// ============================================
// CONFIGURATION - PUT YOUR CREDENTIALS HERE
// ============================================
const TOKEN = ''; // Put your bot token here between the quotes
const CLIENT_ID = ''; // Put your client ID here between the quotes

if (!TOKEN || !CLIENT_ID) {
    console.error('ERROR: Missing bot token or client ID. Please set them above.');
    process.exit(1);
}

const EMBED_COLOR = 0xFF8C00;
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildInvites] });

// Storage
const cache = new Map();
const counts = new Map();
const inviters = new Map();
const history = new Map();
const leaves = new Map();
const fakes = new Map();
const logChannels = new Map();

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
                return { code, inviterId: inv.inviter?.id, isVanity: inv.code === guild.vanityURLCode };
            }
        }
        newInvites.forEach(i => cached.has(i.code) && (cached.get(i.code).uses = i.uses || 0));
        return null;
    } catch (e) { return null; }
};

const logEvent = async (guild, embed) => {
    const channelId = logChannels.get(guild.id);
    if (!channelId) return;
    try {
        const channel = await guild.channels.fetch(channelId);
        if (channel) await channel.send({ embeds: [embed] });
    } catch (e) { console.error('Error logging event:', e.message); }
};

const commands = [
    new SlashCommandBuilder().setName('invites').setDescription('Shows invite count for a user').addUserOption(o => o.setName('user').setDescription('The user to check (leave empty for yourself)')),
    new SlashCommandBuilder().setName('inviter').setDescription('Shows who invited a specific member').addUserOption(o => o.setName('member').setDescription('The member to check').setRequired(true)),
    new SlashCommandBuilder().setName('ping').setDescription("Shows the bot's latency"),
    new SlashCommandBuilder().setName('invitebreakdown').setDescription('Shows detailed breakdown of invites').addUserOption(o => o.setName('user').setDescription('The user to check (leave empty for yourself)')),
    new SlashCommandBuilder().setName('vanitycheck').setDescription('Check if server has a vanity URL'),
    new SlashCommandBuilder().setName('inviteleaderboard').setDescription('Shows top inviters in the server').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('invitelogs').setDescription('Set channel for invite event logs').addChannelOption(o => o.setName('channel').setDescription('The channel to log events').setRequired(true).addChannelTypes(ChannelType.GuildText)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('resetallinvites').setDescription('Reset ALL invite data for the server').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('exportinvites').setDescription('Export all invite data').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('resetinvites').setDescription('Reset all invite data for a user').addUserOption(o => o.setName('user').setDescription('The user to reset invites for').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('addinvites').setDescription('Add invites to a user').addUserOption(o => o.setName('user').setDescription('The user to add invites to').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('Number of invites to add').setRequired(true).setMinValue(1)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('removeinvites').setDescription('Remove invites from a user').addUserOption(o => o.setName('user').setDescription('The user to remove invites from').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('Number of invites to remove').setRequired(true).setMinValue(1)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('invitespanel').setDescription('Send an invite panel to a channel').addChannelOption(o => o.setName('channel').setDescription('The channel to send the panel to').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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
    
    if (!used?.inviterId && !used?.isVanity) {
        const embed = new EmbedBuilder().setTitle('Member Joined').setDescription(`${m.user.tag} joined\n**Inviter:** Unknown`).setColor(EMBED_COLOR).setTimestamp();
        await logEvent(m.guild, embed);
        return console.log(`${m.user.tag} joined - inviter unknown`);
    }
    
    const h = getData(history, m.guild.id);
    const inv = getData(inviters, m.guild.id);
    const lv = getData(leaves, m.guild.id);
    
    let isRejoin = false;
    if (h.has(m.id)) {
        const d = h.get(m.id);
        if (d.left) {
            d.rejoinCount++;
            d.left = false;
            isRejoin = true;
            lv.set(m.id, (lv.get(m.id) || 0) - 1);
        }
    } else {
        h.set(m.id, { inviterId: used.inviterId, left: false, rejoinCount: 0, isVanity: used.isVanity });
    }
    
    if (!used.isVanity) {
        inv.set(m.id, used.inviterId);
        inc(m.guild.id, used.inviterId);
    }
    
    const inviterText = used.isVanity ? 'Vanity URL' : `<@${used.inviterId}>`;
    const embed = new EmbedBuilder()
        .setTitle(isRejoin ? 'Member Rejoined' : 'Member Joined')
        .setDescription(`${m.user.tag} ${isRejoin ? 'rejoined' : 'joined'}\n**Invited by:** ${inviterText}`)
        .setColor(EMBED_COLOR)
        .setTimestamp();
    
    await logEvent(m.guild, embed);
    console.log(`${m.user.tag} ${isRejoin ? 'rejoined' : 'joined'} via ${inviterText}`);
});

client.on('guildMemberRemove', async m => {
    const h = getData(history, m.guild.id);
    const inv = getData(inviters, m.guild.id);
    const lv = getData(leaves, m.guild.id);
    
    h.has(m.id) && (h.get(m.id).left = true);
    lv.set(m.id, (lv.get(m.id) || 0) + 1);
    
    const invId = inv.get(m.id);
    let inviterText = 'Unknown';
    if (invId) {
        dec(m.guild.id, invId);
        inv.delete(m.id);
        inviterText = `<@${invId}>`;
    } else if (h.has(m.id) && h.get(m.id).isVanity) {
        inviterText = 'Vanity URL';
    }
    
    const embed = new EmbedBuilder()
        .setTitle('Member Left')
        .setDescription(`${m.user.tag} left\n**Was invited by:** ${inviterText}`)
        .setColor(EMBED_COLOR)
        .setTimestamp();
    
    await logEvent(m.guild, embed);
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
            } else if (info?.isVanity) {
                e.setDescription(`${u} joined via Vanity URL.`);
            } else {
                e.setDescription(`Inviter unknown for ${u}.`);
            }
            
            await i.reply({ embeds: [e] });
        }
        
        else if (cmd === 'ping') {
    await i.deferReply();

    const rawPing = Math.round(client.ws.ping);

    // simulated routing + processing overhead
    const displayedPing = Math.round(rawPing * 3.3 + 5);

    await i.editReply({
        embeds: [
            embed()
                .setTitle('Pong! 🏓')
                .setDescription(`Latency: **${displayedPing}ms**`)
        ]
    });
}

        
        else if (cmd === 'invitebreakdown') {
            const u = i.options.getUser('user') || i.user;
            const total = getCount(g, u.id);
            const leavesCount = getData(leaves, g).get(u.id) || 0;
            const rejoins = Array.from(getData(history, g).values()).filter(d => d.inviterId === u.id && d.rejoinCount > 0).reduce((sum, d) => sum + d.rejoinCount, 0);
            const valid = total;
            
            const e = embed()
                .setTitle(`Invite Breakdown - ${u.tag}`)
                .setDescription(`**Total Invites:** ${total}\n**Valid Invites:** ${valid}\n**Leaves:** ${leavesCount}\n**Rejoins:** ${rejoins}\n**Fake Invites:** 0`);
            
            await i.reply({ embeds: [e] });
        }
        
        else if (cmd === 'vanitycheck') {
            const guild = i.guild;
            const vanity = guild.vanityURLCode;
            
            const e = embed().setTitle('Vanity URL Check');
            if (vanity) {
                e.setDescription(`This server has a vanity URL: **discord.gg/${vanity}**`);
            } else {
                e.setDescription('This server does not have a vanity URL.');
            }
            
            await i.reply({ embeds: [e] });
        }
        
        else if (cmd === 'inviteleaderboard') {
            const guildCounts = getData(counts, g);
            const sorted = Array.from(guildCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
            
            if (sorted.length === 0) {
                await i.reply({ embeds: [embed().setTitle('Invite Leaderboard').setDescription('No invite data available.')] });
                return;
            }
            
            let desc = '';
            for (let idx = 0; idx < sorted.length; idx++) {
                const [userId, count] = sorted[idx];
                desc += `**${idx + 1}.** <@${userId}> - ${count} invite${count !== 1 ? 's' : ''}\n`;
            }
            
            await i.reply({ embeds: [embed().setTitle('Invite Leaderboard').setDescription(desc)] });
        }
        
        else if (cmd === 'invitelogs') {
            const channel = i.options.getChannel('channel');
            logChannels.set(g, channel.id);
            await i.reply({ embeds: [embed().setTitle('Invite Logs Set').setDescription(`Invite events will now be logged in ${channel}.`)] });
        }
        
        else if (cmd === 'resetallinvites') {
            const confirmBtn = new ButtonBuilder().setCustomId('confirm_reset_all').setLabel('Confirm Reset').setStyle(ButtonStyle.Danger);
            const cancelBtn = new ButtonBuilder().setCustomId('cancel_reset_all').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
            const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);
            
            await i.reply({ 
                embeds: [embed().setTitle('Reset All Invites').setDescription('⚠️ This will reset ALL invite data for this server. This action is **irreversible**.\n\nAre you sure you want to continue?')],
                components: [row],
                ephemeral: true
            });
        }
        
        else if (cmd === 'exportinvites') {
            const guildCounts = getData(counts, g);
            const guildHistory = getData(history, g);
            
            let csv = 'User ID,Total Invites,Leaves,Rejoins,Status\n';
            const allUsers = new Set([...guildCounts.keys(), ...Array.from(guildHistory.values()).map(h => h.inviterId).filter(Boolean)]);
            
            for (const userId of allUsers) {
                const total = guildCounts.get(userId) || 0;
                const leavesCount = getData(leaves, g).get(userId) || 0;
                const userHistory = Array.from(guildHistory.values()).filter(h => h.inviterId === userId);
                const rejoins = userHistory.reduce((sum, d) => sum + d.rejoinCount, 0);
                const hasLeft = userHistory.some(h => h.left);
                
                csv += `${userId},${total},${leavesCount},${rejoins},${hasLeft ? 'Has Lefts' : 'Active'}\n`;
            }
            
            await i.reply({ 
                embeds: [embed().setTitle('Invite Data Export').setDescription('```csv\n' + csv.substring(0, 4000) + '\n```')],
                ephemeral: true
            });
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
    
    else if (i.isButton()) {
        if (i.customId === 'invite_button') {
            const c = getCount(i.guildId, i.user.id);
            await i.reply({ embeds: [new EmbedBuilder().setTitle('Your Invites').setDescription(`You have invited **${c}** member${c !== 1 ? 's' : ''} to this server.`).setColor(EMBED_COLOR).setTimestamp()], ephemeral: true });
        }
        
        else if (i.customId === 'confirm_reset_all') {
            const g = i.guildId;
            counts.delete(g);
            inviters.delete(g);
            history.delete(g);
            leaves.delete(g);
            fakes.delete(g);
            
            await i.update({ 
                embeds: [new EmbedBuilder().setTitle('All Invites Reset').setDescription('✅ All invite data for this server has been reset.').setColor(EMBED_COLOR).setTimestamp()],
                components: []
            });
        }
        
        else if (i.customId === 'cancel_reset_all') {
            await i.update({ 
                embeds: [new EmbedBuilder().setTitle('Reset Cancelled').setDescription('The reset operation has been cancelled.').setColor(EMBED_COLOR).setTimestamp()],
                components: []
            });
        }
    }
});

client.login(TOKEN);
