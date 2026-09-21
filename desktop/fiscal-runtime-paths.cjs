'use strict';

const path = require('node:path');

function resolveFiscalRuntimePaths({
  isPackaged = false,
  resourcesPath = process.resourcesPath,
  projectRoot = path.join(__dirname, '..')
} = {}) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  if (isPackaged && !resourcesPath) throw new Error('resourcesPath obrigatorio para runtime fiscal empacotado.');

  const runtimeRoot = isPackaged
    ? path.join(path.resolve(resourcesPath), 'fiscal')
    : path.join(resolvedProjectRoot, 'fiscal-runtime');

  return Object.freeze({
    runtimeRoot,
    sidecarEntry: isPackaged
      ? path.join(runtimeRoot, 'sidecar', 'entry.js')
      : path.join(resolvedProjectRoot, 'server', 'fiscal-sidecar', 'entry.js'),
    acbrRoot: path.join(runtimeRoot, 'acbr'),
    configsRoot: path.join(runtimeRoot, 'configs'),
    schemasRoot: path.join(runtimeRoot, 'schemas'),
    manifestPath: path.join(runtimeRoot, 'manifest.json')
  });
}

module.exports = { resolveFiscalRuntimePaths };
