'use strict';

const path = require('node:path');
const { createPdvRuntime } = require('../js/core/pdv-runtime');
const { createLocalServer } = require('./local-server');

function resolveServerConfig(env = process.env, cwd = process.cwd()) {
  const host = String(env.PDV_HOST || '127.0.0.1').trim();
  const port = Number(env.PDV_PORT || 4174);
  const token = String(env.PDV_INSTALL_TOKEN || '').trim();
  const dbPath = path.resolve(env.PDV_DB_PATH || path.join(cwd, 'data', 'pdv-artisys.sqlite'));
  const allowedOrigins = String(env.PDV_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PDV_PORT deve ser um inteiro entre 1 e 65535.');
  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!isLoopback && !token) throw new Error('PDV_INSTALL_TOKEN e obrigatorio quando o servidor aceita conexoes LAN.');
  return { host, port, token, dbPath, allowedOrigins, requireTerminalAuth:!isLoopback };
}

function createServerFromEnvironment(env = process.env, cwd = process.cwd()) {
  const config = resolveServerConfig(env, cwd);
  const runtime = createPdvRuntime({ dbPath: config.dbPath, appVersion:env.PDV_APP_VERSION || '1.0.0', serverVersion:env.PDV_APP_VERSION || '1.0.0' });
  const server = createLocalServer({ runtime, host: config.host, port: config.port, token: config.token, allowedOrigins: config.allowedOrigins, requireTerminalAuth:config.requireTerminalAuth });
  return { config, runtime, server, async start(){return server.start();}, async stop(){try{await server.stop();}finally{runtime.close();}} };
}

async function main() {
  const service = createServerFromEnvironment();const address = await service.start();console.log(`PDV ArtiSys Local Server: http://${address.host}:${address.port}/api/v1/health`);
  let stopping=false;const shutdown=async()=>{if(stopping)return;stopping=true;try{await service.stop();process.exitCode=0;}catch(error){console.error(error);process.exitCode=1;}};
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={resolveServerConfig,createServerFromEnvironment};
