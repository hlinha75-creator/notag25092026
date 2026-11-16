const fs = require('node:fs');
const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const current = new Map((await readStdin()).split(/\r?\n/).filter(Boolean).map((line) => {
    const [id = '', roleList = ''] = line.split('\t');
    return [id, new Set(roleList.split('.').filter(Boolean))];
  }));
  const remaining = [];
  for (const member of plan.members) {
    const currentRoles = current.get(member.id) || new Set();
    const roles = member.roles.filter((role) => currentRoles.has(role.id));
    if (roles.length) remaining.push({ id: member.id, username: member.username, displayName: member.displayName, roles });
  }
  const result = {
    plannedMembers: plan.targets,
    completedMembers: plan.targets - remaining.length,
    remainingMembers: remaining.length,
    remainingRoles: remaining.reduce((sum, member) => sum + member.roles.length, 0),
    remaining
  };
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify({ ...result, remaining: undefined }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
