const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  StringSelectMenuBuilder
} = require('discord.js');
const ids = require('../../config/ids');
const customEventWizard = require('./customEventWizard.service');
const sponsoredCtaBuilds = require('./sponsoredCtaBuilds.service');
const eventTypes = require('./eventTypes');
const weaponSelectionModes = require('./weaponSelectionModes');

const buildForumPattern = /^builds?(?:$|[-_ ])/i;

function isBuildForum(channel) {
  return channel?.type === ChannelType.GuildForum && buildForumPattern.test(buildForumName(channel.name));
}

function buildForumName(value) {
  return String(value || '').replace(/^[^a-z0-9]+/i, '');
}

async function forumChannels(guild) {
  const fetched = await guild?.channels?.fetch?.();
  return [...(fetched?.values?.() || [])]
    .filter(isBuildForum)
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
    .slice(0, 25);
}

async function forumSelectionPayload(guild, draft) {
  assertVisualDraft(draft);
  const forums = await forumChannels(guild);
  if (!forums.length) {
    throw new Error('Nao encontrei canais de forum cujo nome comece com build- ou builds-.');
  }
  return {
    content: [
      '**Onde estão as imagens das builds?**',
      'Escolha o fórum que os participantes devem consultar. O bot tentará ligar cada arma ao post correspondente.'
    ].join('\n'),
    embeds: [],
    components: [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`group_dungeon_forum:select:${draft.id}`)
        .setPlaceholder('Escolha um fórum de builds')
        .addOptions(forums.map((channel) => ({
          label: channel.name.slice(0, 100),
          value: channel.id,
          description: 'Fórum de imagens e builds'.slice(0, 100),
          emoji: '📚'
        })))
    )]
  };
}

async function selectForum({ client, guild, draftId, creatorId, channelId }) {
  const draft = customEventWizard.getDraft(draftId, creatorId);
  assertVisualDraft(draft);
  const channel = await guild?.channels?.fetch?.(channelId).catch(() => null)
    || await client.channels.fetch(channelId).catch(() => null);
  if (!isBuildForum(channel)) throw new Error('Escolha um canal de fórum cujo nome comece com build- ou builds-.');

  const threads = await sponsoredCtaBuilds.fetchForumThreads(channel);
  draft.buildsChannelId = channel.id;
  draft.buildsChannelName = channel.name;
  draft.reviewedManualBuildKeys = [];
  for (const slot of draft.slotDefinitions) {
    const match = bestThreadMatch(slot.value, threads);
    slot.buildUrl = match ? `https://discord.com/channels/${guild.id || ids.guildId}/${match.id}` : null;
  }
  return draft;
}

async function completionPayload({ client, guild, draft }) {
  assertVisualDraft(draft);
  if (!draft.buildsChannelId) {
    const expectedForum = eventTypes.visualBuildForumFor(draft.contentType);
    const forums = await forumChannels(guild);
    const matched = forums.find((channel) => buildForumName(channel.name).toLowerCase() === expectedForum);
    if (matched) {
      await selectForum({
        client,
        guild,
        draftId: draft.id,
        creatorId: draft.creatorId,
        channelId: matched.id
      });
    } else {
      return forumSelectionPayload(guild, draft);
    }
  }
  return nextPayload(draft);
}

function assertVisualDraft(draft) {
  if (!eventTypes.usesVisualComposition(draft?.contentType)) {
    throw new Error('Este assistente nao pertence a um evento com composicao visual.');
  }
}

function bestThreadMatch(weaponName, threads) {
  const weapon = normalizeName(weaponName);
  if (!weapon) return null;
  return (threads || [])
    .map((thread) => {
      const title = normalizeName(thread.name);
      let score = 0;
      if (title === weapon) score = 1000;
      else if (title === `build ${weapon}` || title === `${weapon} build`) score = 900;
      else if (title.startsWith(`${weapon} `) || title.startsWith(`build ${weapon} `)) {
        score = 500 - Math.abs(title.length - weapon.length);
      }
      return { thread, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.thread || null;
}

function missingBuilds(draft, { includeReviewed = false } = {}) {
  const reviewed = new Set(draft.reviewedManualBuildKeys || []);
  const unique = new Map();
  for (const slot of draft.slotDefinitions) {
    if (!slot.buildKey || slot.buildUrl || (!includeReviewed && reviewed.has(slot.buildKey))) continue;
    if (!unique.has(slot.buildKey)) unique.set(slot.buildKey, { buildKey: slot.buildKey, name: slot.value });
  }
  return [...unique.values()];
}

function manualLinkPage(draft, pageSize = 5) {
  return missingBuilds(draft).slice(0, pageSize);
}

function saveManualLinks({ draftId, creatorId, links }) {
  const draft = customEventWizard.getDraft(draftId, creatorId);
  const reviewed = new Set(draft.reviewedManualBuildKeys || []);
  for (const item of links || []) {
    reviewed.add(item.buildKey);
    const url = normalizeUrl(item.url);
    for (const slot of draft.slotDefinitions.filter((candidate) => candidate.buildKey === item.buildKey)) {
      if (url) slot.buildUrl = url;
    }
  }
  draft.reviewedManualBuildKeys = [...reviewed];
  return draft;
}

function nextPayload(draft) {
  const missing = missingBuilds(draft);
  if (!missing.length) return reviewPayload(draft);
  return {
    content: [
      `Não encontrei automaticamente **${missing.length}** arma(s) no fórum <#${draft.buildsChannelId}>.`,
      'Você pode informar os links dos posts. Campos deixados vazios usarão apenas o fórum geral.'
    ].join('\n'),
    embeds: [],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`group_dungeon:missing_links:${draft.id}`)
        .setLabel('Informar links pendentes')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`group_dungeon:review_without_links:${draft.id}`)
        .setLabel('Continuar sem links')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`group_dungeon:cancel:${draft.id}`)
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Danger)
    )]
  };
}

function reviewPayload(draft) {
  assertVisualDraft(draft);
  const eventLabel = eventTypes.eventTypeLabel(draft.contentType);
  const lines = draft.slotDefinitions.map((slot) => {
    if (draft.compositionMode !== 'predefined') return `🎮 **${slot.fieldLabel}:** escolha do participante`;
    const emoji = slot.emojiId ? `<:${slot.emojiName || 'arma'}:${slot.emojiId}>` : slot.emojiName || '⚔️';
    const weapon = slot.buildUrl ? `[${slot.value}](${slot.buildUrl})` : slot.value;
    return `${emoji} **${slot.fieldLabel}:** ${weapon}`;
  });
  const unresolved = missingBuilds(draft, { includeReviewed: true }).length;
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Revisar ${eventLabel}`)
    .setDescription([
      `**${draft.title}** · ${draft.scheduledTime}`,
      `📍 ${draft.location}`,
      `📚 <#${draft.buildsChannelId}>`,
      `🧩 **Armas:** ${weaponSelectionModes.modes[weaponSelectionModes.normalize(draft.compositionMode)].label}`,
      '',
      ...lines,
      unresolved ? `\n${unresolved} arma(s) usarão o fórum geral, sem link individual.` : null
    ].filter(Boolean).join('\n').slice(0, 4096));
  return {
    content: '',
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`group_dungeon:confirm:${draft.id}`)
        .setLabel(`Publicar ${eventLabel}`.slice(0, 80))
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`group_dungeon:change_forum:${draft.id}`)
        .setLabel('Trocar fórum')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`group_dungeon:cancel:${draft.id}`)
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Danger)
    )]
  };
}

function normalizeUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  let url;
  try { url = new URL(text); } catch { throw new Error(`Link invalido: ${text.slice(0, 80)}`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use links http ou https para as builds.');
  return url.toString();
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

module.exports = {
  bestThreadMatch,
  buildForumName,
  completionPayload,
  forumChannels,
  forumSelectionPayload,
  isBuildForum,
  manualLinkPage,
  missingBuilds,
  nextPayload,
  reviewPayload,
  saveManualLinks,
  selectForum
};
