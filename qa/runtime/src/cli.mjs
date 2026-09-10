#!/usr/bin/env node
import path from 'node:path';
import { loadQaManifest, resolveEnvironment, resolveFlow, resolveViewport, resolveDemo, resolveDemoProfile } from './manifest.js';
import { loadDemoAdapter } from './adapters.js';
import { prepareDemoProfile, resetDemoProfile, getDemoProfileStatus } from './demo-profile.js';
import { runQaFlow } from './runner.js';
import { runDemoFlow } from './demo.js';

function parseArgs(argv) {
  const [command = 'run', ...rest] = argv;
  const args = { command, positional: [] };
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) { args.positional.push(token); continue; }
    const key = token.slice(2);
    const value = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
    args[key] = value;
  }
  return args;
}

function usage() {
  console.log(`ArtiSys QA\n\nCommands:\n  validate --config qa/artisys-qa.config.json\n  list --config qa/artisys-qa.config.json\n  run --config qa/artisys-qa.config.json [--flow name] [--profile default] [--environment name] [--viewport desktop|tablet|mobile] [--output qa-artifacts]\n  demo --config qa/artisys-qa.config.json [--demo quick-30s] [--profile default] [--preset reels-9x16] [--environment name] [--output qa-artifacts]\n  demo-profile prepare|reset|status --config qa/artisys-qa.config.json [--profile default] [--environment name]`);
}

async function resolveProfileRuntime(manifest, rootDir, requestedProfile) {
  const profile = resolveDemoProfile(manifest, requestedProfile, rootDir);
  if (!profile) return { demoProfile: null, demoAdapter: null };
  return { demoProfile: profile, demoAdapter: await loadDemoAdapter(profile.adapterPath) };
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args.command === 'help') { usage(); process.exit(0); }
if (!args.config) { console.error('Missing --config'); usage(); process.exit(2); }

try {
  const { manifest, rootDir } = await loadQaManifest(args.config);
  if (args.command === 'validate') {
    console.log(`valid ${manifest.systemId} (${manifest.mode})`);
  } else if (args.command === 'list') {
    const profileNames = manifest.demoProfiles ? Object.keys(manifest.demoProfiles) : manifest.demoProfile ? [manifest.demoProfile.id || 'default'] : [];
    console.log(JSON.stringify({ systemId: manifest.systemId, mode: manifest.mode, environments: Object.keys(manifest.environments), flows: Object.keys(manifest.flows || {}), demos: Object.keys(manifest.demos || {}), demoProfiles: profileNames, viewports: ['desktop', 'tablet', 'mobile'], demoPresets: ['landscape-16x9', 'square-1x1', 'reels-9x16'] }, null, 2));
  } else if (args.command === 'demo-profile') {
    const operation = args.positional[0] || 'status';
    if (!['prepare', 'reset', 'status'].includes(operation)) throw new Error(`Unknown demo-profile operation: ${operation}`);
    const profile = resolveDemoProfile(manifest, args.profile, rootDir);
    if (!profile) throw new Error('No demo profile configured');
    const adapter = await loadDemoAdapter(profile.adapterPath);
    const { name: environmentName, environment } = resolveEnvironment(manifest, args.environment);
    const context = { manifest, rootDir, environmentName, environment };
    let result;
    if (operation === 'prepare') result = (await prepareDemoProfile({ profile, adapter, env: process.env, context })).metadata;
    else if (operation === 'reset') result = await resetDemoProfile({ profile, adapter, env: process.env, context });
    else result = await getDemoProfileStatus({ profile, adapter, env: process.env, context });
    console.log(JSON.stringify(result, null, 2));
  } else if (args.command === 'run') {
    const { name: environmentName, environment } = resolveEnvironment(manifest, args.environment);
    const { name: flowName, file: flowFile } = resolveFlow(manifest, args.flow, rootDir);
    const viewport = resolveViewport(manifest, args.viewport);
    const profileRuntime = await resolveProfileRuntime(manifest, rootDir, args.profile);
    const result = await runQaFlow({ manifest, rootDir, environmentName, environment, flowName, flowFile, viewport, outputRoot: args.output ? path.resolve(args.output) : path.resolve('qa-artifacts'), ...profileRuntime });
    console.log(JSON.stringify(result.summary, null, 2));
    console.log(`ARTISYS_QA_OUTPUT=${result.outputDir}`);
  } else if (args.command === 'demo') {
    const { name: environmentName, environment } = resolveEnvironment(manifest, args.environment);
    const demo = resolveDemo(manifest, args.demo, rootDir);
    const profileRuntime = await resolveProfileRuntime(manifest, rootDir, args.profile);
    const result = await runDemoFlow({ manifest, rootDir, environmentName, environment, demoName: demo.name, demoFile: demo.file, presetName: args.preset || demo.preset, durationTargetSec: demo.durationTargetSec, captureViewport: demo.captureViewport, outputRoot: args.output ? path.resolve(args.output) : path.resolve('qa-artifacts'), ...profileRuntime });
    console.log(JSON.stringify(result.summary, null, 2));
    console.log(`ARTISYS_QA_OUTPUT=${result.outputDir}`);
  } else throw new Error(`Unknown command: ${args.command}`);
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
}
