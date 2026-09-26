const { execFileSync } = require('node:child_process');

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .map((file) => file.replace(/\\/g, '/'));

const forbidden = tracked.filter((file) => (
  /(^|\/)\.env$/i.test(file)
  || /\.sqlite(?:-(?:wal|shm))?$/i.test(file)
  || /\.zip$/i.test(file)
  || /^data\/campaign-/i.test(file)
  || /^data\/reports\//i.test(file)
  || /^resources\/season32\//i.test(file)
  || /^reports\//i.test(file)
));

if (forbidden.length) {
  console.error('Arquivos sensíveis ou operacionais estão rastreados pelo Git:');
  for (const file of forbidden) console.error(`- ${file}`);
  process.exit(1);
}

console.log(`Repositório seguro: ${tracked.length} arquivos rastreados, nenhum arquivo proibido.`);
