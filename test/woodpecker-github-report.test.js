'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

async function loadModule() {
  return import('../scripts/lib/woodpecker-github-report.mjs');
}

test('summarizeRelease extracts failed step, exit code, error excerpt and installer', async () => {
  const { summarizeRelease } = await loadModule();
  const report = {
    status: 'blocked',
    failedStep: 'qa',
    steps: [
      { id: 'installer', status: 'pass', exitCode: 0, stdout: 'installer ok', stderr: '' },
      { id: 'qa', status: 'fail', exitCode: 1, stdout: 'Running tests', stderr: 'Expected 200\nReceived 500' },
    ],
  };

  const summary = summarizeRelease({
    report,
    logText: 'fallback log',
    installerPaths: ['dist/ArtiSys-PDV-1.3.2-x64-Setup.exe'],
  });

  assert.equal(summary.failedStep, 'qa');
  assert.equal(summary.exitCode, 1);
  assert.match(summary.errorExcerpt, /Received 500/);
  assert.equal(summary.installerFound, true);
  assert.equal(summary.installerPath, 'dist/ArtiSys-PDV-1.3.2-x64-Setup.exe');
});

test('summarizeRelease falls back to pipeline log when artisys report is absent', async () => {
  const { summarizeRelease } = await loadModule();
  const summary = summarizeRelease({ report: null, logText: 'environment check failed\nnode missing', installerPaths: [] });

  assert.equal(summary.failedStep, 'workflow');
  assert.equal(summary.exitCode, null);
  assert.match(summary.errorExcerpt, /node missing/);
  assert.equal(summary.installerFound, false);
});

test('publicPipelineUrl maps local Woodpecker links to ci.artisys.dev', async () => {
  const { publicPipelineUrl } = await loadModule();
  assert.equal(
    publicPipelineUrl('http://localhost:8000/repos/1/pipeline/11/1'),
    'https://ci.artisys.dev/repos/1/pipeline/11/1',
  );
});

test('buildFailureMarkdown produces a concise diagnostic report', async () => {
  const { buildFailureMarkdown } = await loadModule();
  const markdown = buildFailureMarkdown({
    repo: 'nutricionistaalmeidavh-spec/PDV-ARTISYS',
    sha: 'abcdef1234567890',
    branch: 'main',
    pipelineUrl: 'https://ci.artisys.dev/repos/1/pipeline/12/1',
    summary: {
      failedStep: 'qa',
      exitCode: 1,
      installerFound: true,
      installerPath: 'dist/ArtiSys-PDV-1.3.2-x64-Setup.exe',
      command: 'npm run qa:full',
      errorExcerpt: '4 tests failed',
    },
  });

  assert.match(markdown, /PDV-ARTISYS — Woodpecker falhou/);
  assert.match(markdown, /Step: `qa`/);
  assert.match(markdown, /Exit code: `1`/);
  assert.match(markdown, /ArtiSys-PDV-1\.3\.2-x64-Setup\.exe/);
  assert.match(markdown, /4 tests failed/);
});

test('publishGitHubFailure posts detailed status, commit comment and PR comment', async () => {
  const { publishGitHubFailure } = await loadModule();
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/pulls?')) {
      return { ok: true, status: 200, json: async () => [{ number: 16 }], text: async () => '' };
    }
    return { ok: true, status: 201, json: async () => ({}), text: async () => '' };
  };

  const result = await publishGitHubFailure({
    token: 'secret',
    repo: 'nutricionistaalmeidavh-spec/PDV-ARTISYS',
    sha: 'abcdef1234567890',
    branch: 'chore/woodpecker-pilot-phases-0-3',
    sourceBranch: 'chore/woodpecker-pilot-phases-0-3',
    pipelineUrl: 'http://localhost:8000/repos/1/pipeline/12/1',
    summary: {
      failedStep: 'qa',
      exitCode: 1,
      installerFound: true,
      installerPath: 'dist/ArtiSys-PDV-1.3.2-x64-Setup.exe',
      command: 'npm run qa:full',
      errorExcerpt: '4 tests failed',
    },
    fetchImpl: fakeFetch,
  });

  assert.equal(result.prNumber, 16);
  assert.ok(calls.some((call) => call.url.endsWith('/statuses/abcdef1234567890')));
  assert.ok(calls.some((call) => call.url.endsWith('/commits/abcdef1234567890/comments')));
  assert.ok(calls.some((call) => call.url.endsWith('/issues/16/comments')));
});

test('publishGitHubFailure keeps commit reporting when PR lookup is not authorized', async () => {
  const { publishGitHubFailure } = await loadModule();
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/pulls?')) {
      return { ok: false, status: 403, json: async () => ({}), text: async () => 'forbidden' };
    }
    return { ok: true, status: 201, json: async () => ({}), text: async () => '' };
  };

  const result = await publishGitHubFailure({
    token: 'secret',
    repo: 'nutricionistaalmeidavh-spec/PDV-ARTISYS',
    sha: 'abcdef1234567890',
    branch: 'main',
    pipelineUrl: 'http://localhost:8000/repos/1/pipeline/12/1',
    summary: {
      failedStep: 'test',
      exitCode: 1,
      installerFound: false,
      installerPath: null,
      command: 'npm test',
      errorExcerpt: '1 test failed',
    },
    fetchImpl: fakeFetch,
  });

  assert.equal(result.prNumber, null);
  assert.ok(calls.some((call) => call.url.endsWith('/statuses/abcdef1234567890')));
  assert.ok(calls.some((call) => call.url.endsWith('/commits/abcdef1234567890/comments')));
});
