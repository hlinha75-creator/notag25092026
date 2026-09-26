function runTask(task, logger = console) {
  return Promise.resolve()
    .then(task.run)
    .catch((error) => logger.error(task.errorMessage, error));
}

function runTasks(tasks, logger = console) {
  return Promise.all(tasks.map((task) => runTask(task, logger)));
}

function scheduleTaskGroups(groups, options = {}) {
  const setIntervalFn = options.setIntervalFn || setInterval;
  const logger = options.logger || console;

  return groups.map((group, index) => {
    let running = false;
    return setIntervalFn(() => {
      if (running) {
        logger.warn?.(`[AGENDADOR] Grupo ${group.name || index + 1} ainda está em execução; ciclo ignorado.`);
        return;
      }
      running = true;
      void runTasks(group.tasks, logger).finally(() => {
        running = false;
      });
    }, group.intervalMs);
  });
}

module.exports = {
  runTask,
  runTasks,
  scheduleTaskGroups
};
