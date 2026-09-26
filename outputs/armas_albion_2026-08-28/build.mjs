import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const require = createRequire(import.meta.url);
const { families } = require('../../src/modules/events/weaponCatalog.js');
const outputDir = path.dirname(fileURLToPath(import.meta.url));

const WIKI_BASE = 'https://wiki.albiononline.com/wiki/';
const CRYSTAL_SOURCE = 'https://albiononline.com/news/feature-focus-crystal-weapons';
const familyMeta = {
  sword: ['Guerreiro', 'Sword'],
  axe: ['Guerreiro', 'Axe'],
  mace: ['Guerreiro', 'Mace'],
  hammer: ['Guerreiro', 'Hammer'],
  war_gloves: ['Guerreiro', 'War_Gloves'],
  crossbow: ['Guerreiro', 'Crossbow'],
  bow: ['Caçador', 'Bow'],
  dagger: ['Caçador', 'Dagger'],
  spear: ['Caçador', 'Spear'],
  quarterstaff: ['Caçador', 'Quarterstaff'],
  shapeshifter: ['Caçador', 'Shapeshifter_Staff'],
  nature: ['Caçador', 'Nature_Staff'],
  fire: ['Mago', 'Fire_Staff'],
  holy: ['Mago', 'Holy_Staff'],
  arcane: ['Mago', 'Arcane_Staff'],
  frost: ['Mago', 'Frost_Staff'],
  cursed: ['Mago', 'Cursed_Staff'],
};

const weaponRows = families.flatMap((family) => {
  const [school, wikiPage] = familyMeta[family.key];
  return family.weapons.map((weapon, index) => {
    let policy = 'A definir';
    let notes = '';
    if (weapon.name === 'Longbow') {
      policy = 'Máximo 1';
      notes = 'Regra inicial informada por Lucas: Arco Longo não deve repetir.';
    }
    if (weapon.name === 'Mistpiercer') {
      policy = 'Pode repetir';
      notes = 'Regra inicial informada por Lucas: Furabruma pode repetir.';
    }
    return [
      school,
      family.label,
      index + 1,
      weapon.name,
      weapon.itemId,
      policy,
      policy === 'Máximo 1' ? 1 : null,
      notes,
      weapon.image,
      `${WIKI_BASE}${wikiPage}`,
    ];
  });
});

const workbook = Workbook.create();
workbook.comments.setSelf({ displayName: 'Lucas' });
const summary = workbook.worksheets.add('Resumo');
const familySheet = workbook.worksheets.add('Famílias');
const weapons = workbook.worksheets.add('Armas');
const rules = workbook.worksheets.add('Regras por conteúdo');

const navy = '#172033';
const blue = '#3157D5';
const paleBlue = '#E8EEFF';
const paleGold = '#FFF4D6';
const paleGreen = '#E6F5EC';
const paleRed = '#FCE9E9';
const line = '#D8DEEA';
const muted = '#5E687C';

function styleTitle(sheet, range, title) {
  sheet.getRange(range).merge();
  const cell = sheet.getRange(range.split(':')[0]);
  cell.values = [[title]];
  cell.format = {
    fill: navy,
    font: { bold: true, color: '#FFFFFF', size: 18 },
    verticalAlignment: 'center',
  };
  sheet.getRange(range).format.rowHeight = 34;
}

function styleSubtitle(sheet, range, text) {
  sheet.getRange(range).merge();
  const cell = sheet.getRange(range.split(':')[0]);
  cell.values = [[text]];
  cell.format = {
    fill: paleBlue,
    font: { color: muted, italic: true, size: 10 },
    wrapText: true,
    verticalAlignment: 'center',
  };
  sheet.getRange(range).format.rowHeight = 32;
}

function styleHeader(range) {
  range.format = {
    fill: blue,
    font: { bold: true, color: '#FFFFFF' },
    verticalAlignment: 'center',
    wrapText: true,
    borders: { bottom: { style: 'medium', color: '#203D9D' } },
  };
  range.format.rowHeight = 28;
}

function addBodyBorders(range) {
  range.format.borders = {
    insideHorizontal: { style: 'thin', color: line },
    bottom: { style: 'thin', color: line },
  };
}

// Resumo
styleTitle(summary, 'A1:F1', 'Catálogo de armas — Albion Online');
styleSubtitle(summary, 'A2:F2', 'Base editável para definir limites de repetição por arma e por tipo de conteúdo. Catálogo alinhado ao site/Discord do bot em 28/08/2026.');
summary.getRange('A4:B9').values = [
  ['Indicador', 'Total'],
  ['Famílias de armas', null],
  ['Armas catalogadas', null],
  ['Famílias com 8 armas', null],
  ['Regras já informadas', null],
  ['Itens a revisar', null],
];
styleHeader(summary.getRange('A4:B4'));
summary.getRange('B5').formulas = [["=COUNTA('Famílias'!A4:A20)"]];
summary.getRange('B6').formulas = [["=COUNTA('Armas'!A5:A140)"]];
summary.getRange('B7').formulas = [["=COUNTIF('Famílias'!D4:D20,8)"]];
summary.getRange('B8').formulas = [["=COUNTIF('Armas'!F5:F140,\"<>A definir\")"]];
summary.getRange('B9').formulas = [["=COUNTIF('Armas'!F5:F140,\"A definir\")"]];
summary.getRange('A5:A9').format.font = { bold: true, color: navy };
summary.getRange('B5:B9').format = { font: { bold: true, color: blue, size: 14 }, numberFormat: '#,##0' };
addBodyBorders(summary.getRange('A5:B9'));

summary.getRange('D4:F8').values = [
  ['Como preencher', null, null],
  ['1', 'Regra padrão', 'Defina se a arma pode repetir em uma composição.'],
  ['2', 'Limite', 'Preencha somente quando usar “Limite personalizado”.'],
  ['3', 'Exceções', 'Na aba Regras por conteúdo, altere apenas onde a regra muda.'],
  ['4', 'Observações', 'Registre o motivo para facilitar a programação e a revisão.'],
];
summary.getRange('D4:F4').merge();
summary.getRange('D4').format = { fill: '#D69D22', font: { bold: true, color: '#FFFFFF' } };
summary.getRange('D5:D8').format = { fill: paleGold, font: { bold: true, color: '#8C5A00' }, horizontalAlignment: 'center' };
summary.getRange('E5:E8').format.font = { bold: true, color: navy };
summary.getRange('F5:F8').format = { wrapText: true, font: { color: muted } };
addBodyBorders(summary.getRange('D5:F8'));

summary.getRange('A12:F16').values = [
  ['Fontes e escopo', null, null, null, null, null],
  ['Catálogo do bot', 'src/modules/events/weaponCatalog.js', null, null, null, null],
  ['Wiki Albion', 'https://wiki.albiononline.com/wiki/Template:Weapon_families', null, null, null, null],
  ['Crystal Weapons', CRYSTAL_SOURCE, null, null, null, null],
  ['Escopo', 'Somente armas principais; não inclui off-hands, armaduras ou montarias.', null, null, null, null],
];
summary.getRange('A12:F12').merge();
summary.getRange('A12').format = { fill: navy, font: { bold: true, color: '#FFFFFF' } };
for (const row of [13, 14, 15, 16]) summary.getRange(`B${row}:F${row}`).merge();
summary.getRange('A13:A16').format.font = { bold: true, color: navy };
summary.getRange('B13:B16').format = { font: { color: muted }, wrapText: true };
addBodyBorders(summary.getRange('A13:F16'));
summary.getRange('A1:F16').format.font.name = 'Aptos';
summary.getRange('A1:F16').format.verticalAlignment = 'center';
summary.getRange('A:A').format.columnWidth = 25;
summary.getRange('B:B').format.columnWidth = 24;
summary.getRange('C:C').format.columnWidth = 3;
summary.getRange('D:D').format.columnWidth = 8;
summary.getRange('E:E').format.columnWidth = 22;
summary.getRange('F:F').format.columnWidth = 48;
summary.showGridLines = false;
summary.freezePanes.freezeRows(2);

// Famílias
styleTitle(familySheet, 'A1:G1', 'Famílias de armas');
styleSubtitle(familySheet, 'A2:G2', 'O bot organiza o catálogo em 17 famílias/linhas, cada uma com 8 armas.');
familySheet.getRange('A3:G3').values = [['Escola', 'Família (PT-BR)', 'Família (EN)', 'Qtd. armas', 'Chave do bot', 'Cor', 'Fonte']];
styleHeader(familySheet.getRange('A3:G3'));
const familyRows = families.map((family) => {
  const [school, wikiPage] = familyMeta[family.key];
  return [school, family.label, family.labelEn, null, family.key, family.color, `${WIKI_BASE}${wikiPage}`];
});
familySheet.getRange('A4:G20').values = familyRows;
for (let r = 4; r <= 20; r += 1) familySheet.getRange(`D${r}`).formulas = [[`=COUNTIF('Armas'!$B$5:$B$140,B${r})`]];
familySheet.getRange('D4:D20').format.numberFormat = '#,##0';
familySheet.getRange('A4:A20').format.font = { bold: true, color: navy };
familySheet.getRange('F4:F20').format.fill = families.map((family) => [family.color]);
familySheet.getRange('F4:F20').format.font = { color: '#FFFFFF' };
addBodyBorders(familySheet.getRange('A4:G20'));
familySheet.tables.add('A3:G20', true, 'FamiliasTable').style = 'TableStyleMedium2';
familySheet.getRange('A:G').format.autofitColumns();
familySheet.getRange('A:A').format.columnWidth = 16;
familySheet.getRange('B:C').format.columnWidth = 22;
familySheet.getRange('D:D').format.columnWidth = 12;
familySheet.getRange('E:E').format.columnWidth = 18;
familySheet.getRange('F:F').format.columnWidth = 10;
familySheet.getRange('G:G').format.columnWidth = 48;
familySheet.showGridLines = false;
familySheet.freezePanes.freezeRows(3);

// Armas
styleTitle(weapons, 'A1:J1', 'Catálogo completo de armas');
styleSubtitle(weapons, 'A2:J2', 'Células amarelas são editáveis. Os exemplos Arco Longo e Furabruma já foram preenchidos conforme sua orientação.');
weapons.getRange('A4:J4').values = [['Escola', 'Família', 'Ordem', 'Arma', 'Item ID', 'Regra padrão', 'Limite', 'Observações', 'Imagem', 'Fonte']];
styleHeader(weapons.getRange('A4:J4'));
weapons.getRange('A5:J140').values = weaponRows;
weapons.getRange('C5:C140').format.numberFormat = '0';
weapons.getRange('G5:G140').format.numberFormat = '0';
weapons.getRange('F5:H140').format.fill = paleGold;
weapons.getRange('F5:F140').dataValidation = { rule: { type: 'list', values: ['A definir', 'Máximo 1', 'Pode repetir', 'Limite personalizado', 'Não permitido'] } };
weapons.getRange('G5:G140').dataValidation = { rule: { type: 'whole', operator: 'between', formula1: 1, formula2: 99 } };
weapons.getRange('F5:F140').conditionalFormats.add('containsText', { text: 'Máximo 1', format: { fill: paleRed, font: { color: '#A32424', bold: true } } });
weapons.getRange('F5:F140').conditionalFormats.add('containsText', { text: 'Pode repetir', format: { fill: paleGreen, font: { color: '#17693A', bold: true } } });
weapons.getRange('A5:B140').format.font = { color: navy };
weapons.getRange('D5:D140').format.font = { bold: true, color: navy };
weapons.getRange('H5:H140').format.wrapText = true;
weapons.getRange('I5:J140').format.wrapText = false;
addBodyBorders(weapons.getRange('A5:J140'));
weapons.tables.add('A4:J140', true, 'ArmasTable').style = 'TableStyleMedium2';
weapons.getRange('A:A').format.columnWidth = 14;
weapons.getRange('B:B').format.columnWidth = 20;
weapons.getRange('C:C').format.columnWidth = 8;
weapons.getRange('D:D').format.columnWidth = 25;
weapons.getRange('E:E').format.columnWidth = 34;
weapons.getRange('F:F').format.columnWidth = 21;
weapons.getRange('G:G').format.columnWidth = 10;
weapons.getRange('H:H').format.columnWidth = 48;
weapons.getRange('I:J').format.columnWidth = 52;
weapons.showGridLines = false;
weapons.freezePanes.freezeRows(4);
weapons.freezePanes.freezeColumns(4);

// Regras por conteúdo
styleTitle(rules, 'A1:N1', 'Regras específicas por conteúdo');
styleSubtitle(rules, 'A2:N2', 'Use “Herdar padrão” quando a regra da aba Armas servir. Preencha uma exceção somente quando o comportamento mudar naquele conteúdo.');
const ruleHeaders = ['Escola', 'Família', 'Arma', 'Item ID', 'Regra padrão', 'DG Grupo', 'Roaming T6', 'Outposts', 'Static', 'Gank T8', 'World Boss', 'Raid Avalon', 'Raid Full', 'CTA'];
rules.getRange('A4:N4').values = [ruleHeaders];
styleHeader(rules.getRange('A4:N4'));
for (let r = 5; r <= 140; r += 1) {
  rules.getRange(`A${r}:E${r}`).formulas = [[
    `='Armas'!A${r}`,
    `='Armas'!B${r}`,
    `='Armas'!D${r}`,
    `='Armas'!E${r}`,
    `='Armas'!F${r}`,
  ]];
}
rules.getRange('F5:N140').values = Array.from({ length: 136 }, () => Array(9).fill('Herdar padrão'));
rules.getRange('F5:N140').format.fill = paleGold;
rules.getRange('F5:N140').dataValidation = { rule: { type: 'list', values: ['Herdar padrão', 'Não permitido', 'Máximo 1', 'Pode repetir', 'Limite personalizado'] } };
rules.getRange('F5:N140').conditionalFormats.add('notContainsText', { text: 'Herdar padrão', format: { fill: paleBlue, font: { color: blue, bold: true } } });
rules.getRange('C5:C140').format.font = { bold: true, color: navy };
addBodyBorders(rules.getRange('A5:N140'));
rules.tables.add('A4:N140', true, 'RegrasConteudoTable').style = 'TableStyleMedium2';
rules.getRange('A:A').format.columnWidth = 14;
rules.getRange('B:B').format.columnWidth = 19;
rules.getRange('C:C').format.columnWidth = 24;
rules.getRange('D:D').format.columnWidth = 34;
rules.getRange('E:N').format.columnWidth = 19;
rules.showGridLines = false;
rules.freezePanes.freezeRows(4);
rules.freezePanes.freezeColumns(5);

for (const sheet of [familySheet, weapons, rules]) {
  sheet.getUsedRange().format.font.name = 'Aptos';
  sheet.getUsedRange().format.verticalAlignment = 'center';
}

const inspectSummary = await workbook.inspect({
  kind: 'table',
  range: 'Resumo!A1:F16',
  include: 'values,formulas',
  tableMaxRows: 20,
  tableMaxCols: 8,
});
console.log(inspectSummary.ndjson);

const inspectCatalog = await workbook.inspect({
  kind: 'table',
  range: 'Armas!A4:J12',
  include: 'values,formulas',
  tableMaxRows: 12,
  tableMaxCols: 10,
});
console.log(inspectCatalog.ndjson);

const errors = await workbook.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 300 },
  summary: 'final formula error scan',
});
console.log(errors.ndjson);

for (const [sheetName, range, filename, scale] of [
  ['Resumo', 'A1:F16', 'preview-resumo.png', 1.5],
  ['Famílias', 'A1:G20', 'preview-familias.png', 1.2],
  ['Armas', 'A1:J20', 'preview-armas.png', 1.0],
  ['Regras por conteúdo', 'A1:N20', 'preview-regras.png', 0.9],
]) {
  const preview = await workbook.render({ sheetName, range, scale, format: 'png' });
  await fs.writeFile(path.join(outputDir, filename), new Uint8Array(await preview.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(path.join(outputDir, 'catalogo-armas-albion.xlsx'));
console.log(JSON.stringify({ families: families.length, weapons: weaponRows.length, output: path.join(outputDir, 'catalogo-armas-albion.xlsx') }));
