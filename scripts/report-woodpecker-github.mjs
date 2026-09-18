#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  publishGitHubFailure,
  summarizeRelease,
} from './lib/woodpecker-github-report.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function readTextIfExists(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

async function findInstallers() {
  const dist = path.join(repoRoot, 'dist');
  try {
    const entries = await readdir(dist, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^ArtiSys-PDV-.*-Setup\.exe$/i.test(entry.name))
      .map((entry) => path.posix.join('dist', entry.name))
      .sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function main() {
  const reportPath = path.join(repoRoot, 'artifacts', 'artisys-release-report.json');
  const logPath = path.join(repoRoot, 'artifacts', 'woodpecker-release.log');
  const [report, logText, installerPaths] = await Promise.all([
    readJsonIfExists(reportPath),
    readTextIfExists(logPath),
    findInstallers(),
  ]);

  const summary = summarizeRelease({ report, logText, installerPaths });
  const result = await publishGitHubFailure({
    token: process.env.GITHUB_REPORT_TOKEN,
    repo: process.env.CI_REPO,
    sha: process.env.CI_COMMIT_SHA,
    branch: process.env.CI_COMMIT_BRANCH,
    sourceBranch: process.env.CI_COMMIT_SOURCE_BRANCH,
    pipelineUrl: process.env.CI_PIPELINE_URL,
    summary,
  });

  console.log(`[Woodpecker Reporter] Status detalhado publicado para ${process.env.CI_COMMIT_SHA}.`);
  console.log(`[Woodpecker Reporter] Commit comment publicado. PR: ${result.prNumber ?? 'nenhum PR aberto encontrado'}.`);
  console.log(`[Woodpecker Reporter] Pipeline publico: ${result.pipelineUrl}`);
}

main().catch((error) => {
  console.error(`[Woodpecker Reporter] ${error.stack || error.message}`);
  process.exitCode = 1;
});
