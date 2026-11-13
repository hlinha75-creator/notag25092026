function calculateNetLoot({ lootTotal, silverBags, repair, taxPercent }) {
  const gross = lootTotal + silverBags - repair;
  const tax = Math.floor((gross * taxPercent) / 100);
  return gross - tax;
}

function calculatePayouts({ participants, netLoot }) {
  const eligible = participants
    .filter((participant) => !participant.is_spectator)
    .map((participant) => ({
      ...participant,
      seconds: participant.manual_seconds ?? participant.calculated_seconds ?? 0
    }))
    .filter((participant) => participant.seconds > 0);

  const totalSeconds = eligible.reduce((sum, participant) => sum + participant.seconds, 0);
  if (totalSeconds <= 0 || netLoot <= 0) {
    return eligible.map((participant) => ({ discordId: participant.discord_id, payout: 0 }));
  }

  let distributed = 0;
  const payouts = eligible.map((participant, index) => {
    const payout = index === eligible.length - 1
      ? netLoot - distributed
      : Math.floor((netLoot * participant.seconds) / totalSeconds);
    distributed += payout;
    return { discordId: participant.discord_id, payout };
  });

  return payouts;
}

module.exports = {
  calculateNetLoot,
  calculatePayouts
};
