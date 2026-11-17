const assert = require('node:assert/strict');
const test = require('node:test');

const ids = require('../src/config/ids');
const { classifyGuildAbsence } = require('../src/modules/members/memberList.service');

function discordMember(discordId, albionName, isMember = true) {
  return {
    discordId,
    albionName,
    roleIds: new Set(isMember ? [ids.roles.member] : [])
  };
}

test('comparacao Discord x guild lista apenas cargo Membro ausente do roster', () => {
  const comparison = classifyGuildAbsence([
    discordMember('1', 'Jogador Presente'),
    discordMember('2', 'Jogador Ausente'),
    discordMember('3', ''),
    discordMember('4', 'Convidado Ausente', false)
  ], [
    { member_key: 'jogador presente', character_name: 'Jogador Presente' }
  ]);

  assert.deepEqual(comparison.discordMembers.map((row) => row.discordId), ['1', '2', '3']);
  assert.deepEqual(comparison.absent.map((row) => row.discordId), ['2']);
  assert.deepEqual(comparison.unverified.map((row) => row.discordId), ['3']);
});

test('comparacao de nomes ignora caixa, espacos e acentos', () => {
  const comparison = classifyGuildAbsence([
    discordMember('1', '  ÁlBïon Hero  ')
  ], [
    { character_name: 'albion hero' }
  ]);

  assert.equal(comparison.absent.length, 0);
});

test('campanha separa ausentes removiveis de membros protegidos', () => {
  const removable = discordMember('1', 'Ausente Removivel');
  const protectedMember = {
    ...discordMember('2', 'Ausente Protegido'),
    removalBlockedReason: 'cargo staff'
  };
  const comparison = classifyGuildAbsence([removable, protectedMember], []);

  assert.deepEqual(comparison.absent.map((row) => row.discordId), ['1', '2']);
  assert.deepEqual(comparison.eligible.map((row) => row.discordId), ['1']);
  assert.deepEqual(comparison.protected.map((row) => row.discordId), ['2']);
});
