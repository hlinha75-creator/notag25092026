import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const projectRoot = "C:\\Users\\Lucas\\Documents\\bot notag";
const outputDir = path.join(projectRoot, "outputs", "01a04cdb-453d-7251-9c43-e279f83b1b3c");
const snapshotPath = path.join(projectRoot, "data", "season33", "snapshot-final.json");
const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));

const categoryLabels = {
  "Guild Challenge": "Guild Challenge",
  "PvE (Outlands and Roads)": "PvE Black",
  "Gathering (Outlands and Roads)": "Coleta Black",
  "Hideout Power Cores": "Power Cores",
  "Outlands Treasures": "Tesouros Black",
  "Keeper Uprising": "Keeper Uprising",
  Smugglers: "Contrabandistas",
  Hellgates: "Hellgates",
  "The Depths": "Profundezas",
  "Corrupted Dungeons": "Corrompidas",
  "Castles & Castle Outposts": "Castelos e Outposts",
};

const normalize = (value) => String(value || "").trim().toLocaleLowerCase("pt-BR");
const categoryRows = [];
const players = new Map();

for (const category of snapshot.categories) {
  for (const row of category.rows) {
    const estimated = category.totalAmount
      ? category.seasonPoints * row.amount / category.totalAmount
      : 0;
    categoryRows.push({
      category: category.name,
      categoryLabel: categoryLabels[category.name] || category.name,
      seasonPoints: category.seasonPoints,
      totalAmount: category.totalAmount,
      rank: row.rank,
      player: row.player,
      amount: row.amount,
      estimated,
    });
    const key = normalize(row.player);
    if (!players.has(key)) {
      players.set(key, { name: row.player, rawTotal: 0, seasonTotal: 0, categories: new Map() });
    }
    const player = players.get(key);
    player.rawTotal += row.amount;
    player.seasonTotal += estimated;
    player.categories.set(category.name, { amount: row.amount, estimated });
  }
}

const ranking = [...players.values()]
  .map((player) => {
    const main = [...player.categories.entries()]
      .sort((a, b) => b[1].estimated - a[1].estimated)[0];
    return {
      ...player,
      mainCategory: main ? categoryLabels[main[0]] || main[0] : "—",
    };
  })
  .sort((a, b) => b.seasonTotal - a.seasonTotal || a.name.localeCompare(b.name, "pt-BR"));

const rawRanking = [...ranking]
  .sort((a, b) => b.rawTotal - a.rawTotal || a.name.localeCompare(b.name, "pt-BR"));

const workbook = Workbook.create();
const summary = workbook.worksheets.add("Resumo");
const seasonSheet = workbook.worksheets.add("Ranking Season");
const rawSheet = workbook.worksheets.add("Pontos Brutos");
const categorySheet = workbook.worksheets.add("Categorias");
const sourceSheet = workbook.worksheets.add("Fonte e Método");

const gold = "#C8922F";
const dark = "#171717";
const cream = "#FFF7E6";
const lightGold = "#F4E3B2";
const muted = "#6B6254";

for (const sheet of [summary, seasonSheet, rawSheet, categorySheet, sourceSheet]) {
  sheet.showGridLines = false;
}

const styleTitle = (range) => {
  range.format = {
    fill: dark,
    font: { bold: true, color: "#FFFFFF", size: 16 },
    verticalAlignment: "center",
  };
  range.format.rowHeight = 30;
};

const styleHeader = (range) => {
  range.format = {
    fill: gold,
    font: { bold: true, color: "#FFFFFF" },
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "inside", style: "thin", color: "#E6D09B" },
  };
  range.format.rowHeight = 26;
};

summary.getRange("A1:H1").merge();
summary.getRange("A1:H1").values = [["NoTag · Pontuação da Season 33"]];
styleTitle(summary.getRange("A1:H1"));
summary.getRange("A3:B7").values = [
  ["Guilda", snapshot.guild],
  ["Data do levantamento", snapshot.capturedAt],
  ["Ranking oficial", snapshot.officialGuildRank],
  ["Pontos oficiais", snapshot.officialGuildPoints],
  ["Jogadores identificados", ranking.length],
];
summary.getRange("A3:A7").format = { fill: lightGold, font: { bold: true, color: dark } };
summary.getRange("B3:B7").format = { fill: cream, font: { color: dark } };
summary.getRange("B5:B7").format.numberFormat = "#,##0";

summary.getRange("A9:E9").values = [["Categoria", "Pontos Season", "% da guilda", "Pontos brutos", "Linhas"]];
styleHeader(summary.getRange("A9:E9"));
const summaryCategoryRows = snapshot.categories.map((category, index) => [
  categoryLabels[category.name] || category.name,
  category.seasonPoints,
  null,
  category.totalAmount,
  category.rows.length,
]);
summary.getRange(`A10:E${9 + summaryCategoryRows.length}`).values = summaryCategoryRows;
for (let index = 0; index < summaryCategoryRows.length; index += 1) {
  const row = 10 + index;
  summary.getRange(`C${row}`).formulas = [[`=B${row}/$B$6`]];
}
summary.getRange(`B10:B${9 + summaryCategoryRows.length}`).format.numberFormat = "#,##0";
summary.getRange(`C10:C${9 + summaryCategoryRows.length}`).format.numberFormat = "0.0%";
summary.getRange(`D10:E${9 + summaryCategoryRows.length}`).format.numberFormat = "#,##0";

summary.getRange("G3:H3").values = [["Top", "Jogador / pontos"]];
styleHeader(summary.getRange("G3:H3"));
summary.getRange("G4:H13").values = ranking.slice(0, 10).map((player, index) => [
  index + 1,
  `${player.name} · ${player.seasonTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
]);
summary.getRange("G4:G13").format.numberFormat = "0";

summary.getRange("A3:A20").format.columnWidth = 29;
summary.getRange("B3:B20").format.columnWidth = 18;
summary.getRange("C3:C20").format.columnWidth = 14;
summary.getRange("D3:D20").format.columnWidth = 19;
summary.getRange("E3:E20").format.columnWidth = 12;
summary.getRange("F3:F20").format.columnWidth = 3;
summary.getRange("G3:G13").format.columnWidth = 8;
summary.getRange("H3:H13").format.columnWidth = 32;

categorySheet.getRange("A1:G1").merge();
categorySheet.getRange("A1:G1").values = [["Fonte detalhada por categoria"]];
styleTitle(categorySheet.getRange("A1:G1"));
categorySheet.getRange("A3:G3").values = [[
  "Categoria",
  "Pontos Season da categoria",
  "Total bruto da categoria",
  "Rank na categoria",
  "Jogador",
  "Pontos brutos",
  "Season Points estimados",
]];
styleHeader(categorySheet.getRange("A3:G3"));
categorySheet.getRange(`A4:F${3 + categoryRows.length}`).values = categoryRows.map((row) => [
  row.categoryLabel,
  row.seasonPoints,
  row.totalAmount,
  row.rank,
  row.player,
  row.amount,
]);
for (let index = 0; index < categoryRows.length; index += 1) {
  const row = 4 + index;
  categorySheet.getRange(`G${row}`).formulas = [[`=IF(C${row}=0,0,F${row}/C${row}*B${row})`]];
}
categorySheet.getRange(`B4:F${3 + categoryRows.length}`).format.numberFormat = "#,##0";
categorySheet.getRange(`G4:G${3 + categoryRows.length}`).format.numberFormat = "#,##0.00";
categorySheet.getRange(`A3:G${3 + categoryRows.length}`).format.borders = { preset: "inside", style: "thin", color: "#E8E0D2" };
categorySheet.getRange(`A4:G${3 + categoryRows.length}`).format.fill = "#FFFCF5";
categorySheet.freezePanes.freezeRows(3);
categorySheet.getRange("A:A").format.columnWidth = 25;
categorySheet.getRange("B:C").format.columnWidth = 18;
categorySheet.getRange("D:D").format.columnWidth = 14;
categorySheet.getRange("E:E").format.columnWidth = 24;
categorySheet.getRange("F:G").format.columnWidth = 20;

seasonSheet.getRange("A1:D1").merge();
seasonSheet.getRange("A1:D1").values = [["Ranking estimado da Season 33"]];
styleTitle(seasonSheet.getRange("A1:D1"));
seasonSheet.getRange("A3:D3").values = [["Rank", "Jogador", "Season Points estimados", "Principal categoria"]];
styleHeader(seasonSheet.getRange("A3:D3"));
seasonSheet.getRange(`B4:B${3 + ranking.length}`).values = ranking.map((player) => [player.name]);
seasonSheet.getRange(`D4:D${3 + ranking.length}`).values = ranking.map((player) => [player.mainCategory]);
const categoryLastRow = 3 + categoryRows.length;
for (let index = 0; index < ranking.length; index += 1) {
  const row = 4 + index;
  seasonSheet.getRange(`C${row}`).formulas = [[`=SUMIF('Categorias'!$E$4:$E$${categoryLastRow},B${row},'Categorias'!$G$4:$G$${categoryLastRow})`]];
  seasonSheet.getRange(`A${row}`).formulas = [[`=RANK.EQ(C${row},$C$4:$C$${3 + ranking.length},0)`]];
}
seasonSheet.getRange(`A4:A${3 + ranking.length}`).format.numberFormat = "0";
seasonSheet.getRange(`C4:C${3 + ranking.length}`).format.numberFormat = "#,##0.00";
seasonSheet.getRange(`A3:D${3 + ranking.length}`).format.borders = { preset: "inside", style: "thin", color: "#E8E0D2" };
seasonSheet.freezePanes.freezeRows(3);
seasonSheet.getRange("A:A").format.columnWidth = 10;
seasonSheet.getRange("B:B").format.columnWidth = 25;
seasonSheet.getRange("C:C").format.columnWidth = 22;
seasonSheet.getRange("D:D").format.columnWidth = 24;

const rawHeaders = ["Rank bruto", "Jogador", "Total bruto", ...snapshot.categories.map((category) => categoryLabels[category.name] || category.name)];
const rawLastColumn = String.fromCharCode(64 + rawHeaders.length);
rawSheet.getRange(`A1:${rawLastColumn}1`).merge();
rawSheet.getRange(`A1:${rawLastColumn}1`).values = [["Pontos brutos por jogador e categoria"]];
styleTitle(rawSheet.getRange(`A1:${rawLastColumn}1`));
rawSheet.getRange(`A3:${rawLastColumn}3`).values = [rawHeaders];
styleHeader(rawSheet.getRange(`A3:${rawLastColumn}3`));
rawSheet.getRange(`B4:B${3 + rawRanking.length}`).values = rawRanking.map((player) => [player.name]);
for (let index = 0; index < rawRanking.length; index += 1) {
  const row = 4 + index;
  rawSheet.getRange(`C${row}`).formulas = [[`=SUMIF('Categorias'!$E$4:$E$${categoryLastRow},B${row},'Categorias'!$F$4:$F$${categoryLastRow})`]];
  rawSheet.getRange(`A${row}`).formulas = [[`=RANK.EQ(C${row},$C$4:$C$${3 + rawRanking.length},0)`]];
  snapshot.categories.forEach((category, categoryIndex) => {
    const column = String.fromCharCode(68 + categoryIndex);
    const label = categoryLabels[category.name] || category.name;
    rawSheet.getRange(`${column}${row}`).formulas = [[`=SUMIFS('Categorias'!$F$4:$F$${categoryLastRow},'Categorias'!$E$4:$E$${categoryLastRow},B${row},'Categorias'!$A$4:$A$${categoryLastRow},${column}$3)`]];
  });
}
rawSheet.getRange(`A4:A${3 + rawRanking.length}`).format.numberFormat = "0";
rawSheet.getRange(`C4:${rawLastColumn}${3 + rawRanking.length}`).format.numberFormat = "#,##0";
rawSheet.getRange(`A3:${rawLastColumn}${3 + rawRanking.length}`).format.borders = { preset: "inside", style: "thin", color: "#E8E0D2" };
rawSheet.freezePanes.freezeRows(3);
rawSheet.freezePanes.freezeColumns(2);
rawSheet.getRange("A:A").format.columnWidth = 11;
rawSheet.getRange("B:B").format.columnWidth = 25;
rawSheet.getRange(`C:${rawLastColumn}`).format.columnWidth = 18;

sourceSheet.getRange("A1:D1").merge();
sourceSheet.getRange("A1:D1").values = [["Fonte, método e controles"]];
styleTitle(sourceSheet.getRange("A1:D1"));
sourceSheet.getRange("A3:B10").values = [
  ["Campo", "Valor"],
  ["Pasta-fonte", snapshot.sourceFolder],
  ["Quantidade de imagens", 106],
  ["Capturado em", snapshot.capturedAt],
  ["Fórmula", "Pontos da categoria × contribuição do jogador ÷ total bruto da categoria"],
  ["Pontos oficiais conciliados", snapshot.officialGuildPoints],
  ["Soma das categorias", snapshot.categories.reduce((sum, category) => sum + category.seasonPoints, 0)],
  ["Observação", "Rankings extraídos por OCR e revisados por continuidade de rank, ordem decrescente e totais exibidos no jogo."],
];
styleHeader(sourceSheet.getRange("A3:B3"));
sourceSheet.getRange("A4:A10").format = { fill: lightGold, font: { bold: true, color: dark } };
sourceSheet.getRange("B4:B10").format = { fill: cream, font: { color: muted }, wrapText: true };
sourceSheet.getRange("A:A").format.columnWidth = 29;
sourceSheet.getRange("B:B").format.columnWidth = 88;
sourceSheet.getRange("4:10").format.rowHeight = 30;

await fs.mkdir(outputDir, { recursive: true });

for (const [sheetName, range] of [
  ["Resumo", "A1:H20"],
  ["Ranking Season", "A1:D18"],
  ["Pontos Brutos", `A1:${rawLastColumn}15`],
  ["Categorias", "A1:G18"],
  ["Fonte e Método", "A1:B10"],
]) {
  const preview = await workbook.render({ sheetName, range, scale: 1.2, format: "png" });
  const safeName = sheetName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "-").toLowerCase();
  await fs.writeFile(path.join(outputDir, `preview-${safeName}.png`), new Uint8Array(await preview.arrayBuffer()));
}

const workbookOutput = await SpreadsheetFile.exportXlsx(workbook);
await workbookOutput.save(path.join(outputDir, "pontuacao-season33-29082026.xlsx"));

const csvEscape = (value) => {
  const text = String(value ?? "");
  return /[";,\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const csv = (rows) => `\uFEFF${rows.map((row) => row.map(csvEscape).join(";")).join("\r\n")}\r\n`;

const seasonCsvRows = [
  ["rank", "player", "season_points_estimado", "categoria_principal"],
  ...ranking.map((player, index) => [index + 1, player.name, player.seasonTotal.toFixed(6), player.mainCategory]),
];
await fs.writeFile(path.join(outputDir, "ranking-season33-29082026.csv"), csv(seasonCsvRows), "utf8");

const rawCsvRows = [
  ["rank_pontos_brutos", "player", "pontos_brutos_total", ...snapshot.categories.map((category) => categoryLabels[category.name] || category.name)],
  ...rawRanking.map((player, index) => [
    index + 1,
    player.name,
    player.rawTotal,
    ...snapshot.categories.map((category) => player.categories.get(category.name)?.amount || 0),
  ]),
];
await fs.writeFile(path.join(outputDir, "pontos-brutos-season33-29082026.csv"), csv(rawCsvRows), "utf8");

const inspect = await workbook.inspect({
  kind: "table",
  range: "Resumo!A1:H20",
  include: "values,formulas",
  tableMaxRows: 20,
  tableMaxCols: 8,
});
console.log(inspect.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

console.log(JSON.stringify({
  workbook: path.join(outputDir, "pontuacao-season33-29082026.xlsx"),
  seasonCsv: path.join(outputDir, "ranking-season33-29082026.csv"),
  rawCsv: path.join(outputDir, "pontos-brutos-season33-29082026.csv"),
  players: ranking.length,
  categoryRows: categoryRows.length,
}));
