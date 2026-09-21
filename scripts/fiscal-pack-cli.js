#!/usr/bin/env node
'use strict';

const os = require('node:os');
const path = require('node:path');
const { createFiscalPackService } = require('../js/domains/fiscal/fiscal-pack-service');

function parse(argv) {
  const args = [...argv];
  const command = args.shift();
  let storeRoot = process.env.ARTISYS_FISCAL_PACK_STORE || path.join(os.homedir(), '.artisys', 'fiscal-packs');
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--store') {
      storeRoot = args[i + 1];
      i += 1;
    } else {
      positional.push(args[i]);
    }
  }
  return { command, storeRoot, positional };
}

function usage() {
  console.error('Uso: fiscal-pack-cli.js validate|import <diretorio-pack> [--store <diretorio>] | list [--store <diretorio>]');
}

function main() {
  const { command, storeRoot, positional } = parse(process.argv.slice(2));
  if (!command || !storeRoot) {
    usage();
    process.exitCode = 2;
    return;
  }
  const service = createFiscalPackService({ storeRoot });
  if (command === 'validate') {
    if (!positional[0]) throw new Error('Diretorio do Fiscal Pack obrigatorio.');
    const result = service.validate(positional[0]);
    console.log(`VALID ${result.manifest.id}@${result.manifest.version} (${result.files.length} arquivos)`);
    return;
  }
  if (command === 'import') {
    if (!positional[0]) throw new Error('Diretorio do Fiscal Pack obrigatorio.');
    const result = service.importPack(positional[0]);
    if (result.alreadyInstalled) console.log(`already installed ${result.id}@${result.version} -> ${result.installPath}`);
    else console.log(`importado ${result.id}@${result.version} -> ${result.installPath}`);
    return;
  }
  if (command === 'list') {
    const installed = service.listInstalled();
    if (!installed.length) console.log('Nenhum Fiscal Pack instalado.');
    else installed.forEach(pack => console.log(`${pack.id}@${pack.version}\t${pack.installPath}`));
    return;
  }
  usage();
  process.exitCode = 2;
}

try {
  main();
} catch (error) {
  console.error(error?.message || String(error));
  process.exitCode = 1;
}
