function shouldRestartGateway({
  production,
  pendingTasks,
  autoRestartStaleGateway,
  restartWithPendingTasks = false,
}) {
  if (production) return true;
  return autoRestartStaleGateway === true && (
    Number(pendingTasks) === 0 || restartWithPendingTasks === true
  );
}

module.exports = { shouldRestartGateway };
