const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder
} = require('discord.js');
const weaponCatalog = require('./customEventWeaponCatalog.service');

const roleVisuals = {
  tank: { emoji: '🛡️', color: 0x5865f2 },
  healer: { emoji: '✋', color: 0x36c978 },
  support: { emoji: '🟧', color: 0xf0a34a },
  dps: { emoji: '⚔️', color: 0xe45858 }
};

function progressText(step) {
  const chosen = step.draft.slotDefinitions.filter((slot) => slot.buildKey).length;
  return `Vaga **${step.position + 1}/${step.total}** • ${chosen}/${step.total} armas escolhidas`;
}

function navigationRow(step) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`custom_event:build_back:${step.draft.id}:${Math.max(0, step.position - 1)}`)
      .setLabel('Voltar uma vaga')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(step.position === 0),
    new ButtonBuilder()
      .setCustomId(`custom_event:cancel:${step.draft.id}`)
      .setLabel('Cancelar')
      .setStyle(ButtonStyle.Danger)
  );
}

function compositionPayload(step) {
  if (step.complete) return { content: 'Composição completa.', embeds: [], components: [] };
  const options = weaponCatalog.familyOptions(step.draft.catalog, step.slot.role);
  if (!options.length) throw new Error(`Não há famílias disponíveis para ${step.slot.fieldLabel}.`);
  const selected = step.slot.value ? `\nAtual: **${step.slot.value}**` : '';
  const visual = roleVisuals[step.slot.role] || roleVisuals.dps;
  const embed = new EmbedBuilder()
    .setColor(visual.color)
    .setTitle(`${visual.emoji} ${step.slot.fieldLabel}`)
    .setDescription(`${progressText(step)}${selected}\n\nEscolha primeiro a **família da arma**. As recomendações aparecem no topo.`)
    .setFooter({ text: 'O próximo menu mostrará somente as armas dessa família.' });
  return {
    content: '',
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`custom_event_family:select:${step.draft.id}:${step.position}`)
          .setPlaceholder(`Família de ${step.slot.fieldLabel}`.slice(0, 150))
          .addOptions(options)
      ),
      navigationRow(step)
    ]
  };
}

function weaponPayload(step, familyKey) {
  if (step.complete) return { content: 'Composição completa.', embeds: [], components: [] };
  const family = weaponCatalog.familyByKey(step.draft.catalog, step.slot.role, familyKey);
  const options = weaponCatalog.weaponOptions(step.draft.catalog, step.slot.role, familyKey);
  if (!family || !options.length) throw new Error(`Não há armas disponíveis nessa família para ${step.slot.fieldLabel}.`);
  const visual = roleVisuals[step.slot.role] || roleVisuals.dps;
  const embed = new EmbedBuilder()
    .setColor(visual.color)
    .setTitle(`${family.symbol} ${family.label}`)
    .setDescription(`${progressText(step)}\n\nAgora escolha uma das **${options.length} armas** de ${family.label}.`)
    .setFooter({ text: step.slot.fieldLabel });
  if (family.iconUrl) embed.setThumbnail(family.iconUrl);
  return {
    content: '',
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`custom_event_weapon:select:${step.draft.id}:${step.position}:${familyKey}`)
          .setPlaceholder(`Arma de ${family.label}`.slice(0, 150))
          .addOptions(options)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`custom_event:weapon_change:${step.draft.id}:${step.position}`)
          .setLabel('Voltar às famílias')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`custom_event:cancel:${step.draft.id}`)
          .setLabel('Cancelar')
          .setStyle(ButtonStyle.Danger)
      )
    ]
  };
}

function selectionPayload(selection) {
  const { build, draft, position, slot, total } = selection;
  const visual = roleVisuals[slot.role] || roleVisuals.dps;
  const remainingSameRole = draft.slotDefinitions.filter((candidate) => (
    candidate.role === slot.role && candidate.index > slot.index && !candidate.buildKey
  )).length;
  const symbol = build.familySymbol || '⚔️';
  const embed = new EmbedBuilder()
    .setColor(visual.color)
    .setTitle(`${symbol} ${build.name}`)
    .setDescription(`**${slot.fieldLabel}** • vaga ${position + 1}/${total}\n\nConfira a arma e confirme para continuar.`)
    .addFields(
      { name: 'Família', value: build.familyLabel || 'Build do fórum', inline: true },
      { name: 'Função', value: `${visual.emoji} ${slot.fieldLabel.replace(/\s+\d+$/, '')}`, inline: true }
    );
  if (build.iconUrl) embed.setThumbnail(build.iconUrl);
  if (build.buildUrl) embed.setURL(build.buildUrl);

  const buttons = [
    new ButtonBuilder()
      .setCustomId(`custom_event:weapon_confirm:${draft.id}:${position}`)
      .setLabel('Confirmar e continuar')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`custom_event:weapon_change:${draft.id}:${position}`)
      .setLabel('Trocar arma')
      .setStyle(ButtonStyle.Secondary)
  ];
  if (remainingSameRole > 0) {
    buttons.push(new ButtonBuilder()
      .setCustomId(`custom_event:weapon_repeat:${draft.id}:${position}`)
      .setLabel(`Repetir nas próximas ${remainingSameRole}`.slice(0, 80))
      .setStyle(ButtonStyle.Primary));
  }
  if (build.buildUrl) {
    buttons.push(new ButtonBuilder()
      .setLabel('Abrir build')
      .setURL(build.buildUrl)
      .setStyle(ButtonStyle.Link));
  }
  buttons.push(new ButtonBuilder()
    .setCustomId(`custom_event:cancel:${draft.id}`)
    .setLabel('Cancelar')
    .setStyle(ButtonStyle.Danger));

  return { content: '', embeds: [embed], components: [new ActionRowBuilder().addComponents(buttons)] };
}

module.exports = { compositionPayload, selectionPayload, weaponPayload };
