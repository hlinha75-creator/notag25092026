const ids = require('./ids');

const groups = {
  createEvent: ['caller', 'staff', 'adm', 'recruiter'],
  approvePayment: ['staff', 'adm', 'treasurer'],
  importCsv: ['staff', 'adm', 'treasurer'],
  publishSeason: ['staff', 'adm'],
  withdrawBalance: ['staff', 'adm', 'treasurer'],
  approveRegistration: ['staff', 'adm', 'recruiter'],
  assumeEvent: ['staff', 'caller', 'treasurer', 'recruiter', 'adm']
};

function isOwner(member) {
  return member?.guild?.ownerId === member?.id;
}

function hasRole(member, roleName) {
  const roleId = ids.roles[roleName];
  return Boolean(roleId && member?.roles?.cache?.has(roleId));
}

function hasAnyRole(member, roleNames) {
  return isOwner(member) || roleNames.some((roleName) => hasRole(member, roleName));
}

function can(member, action) {
  return hasAnyRole(member, groups[action] || []);
}

module.exports = {
  can,
  groups,
  hasAnyRole,
  hasRole,
  isOwner
};
