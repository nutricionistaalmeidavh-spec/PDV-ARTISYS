const DEFAULT_API = 'https://api.github.com';
const DEFAULT_PUBLIC_CI = 'https://ci.artisys.dev';

function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\u001b\[[0-9;]*m/g, '').trim() : '';
}

export function tailLines(value, maxLines = 40, maxChars = 6000) {
  const text = cleanText(value);
  if (!text) return '';
  const lines = text.split(/\r?\n/).slice(-maxLines);
  const joined = lines.join('\n');
  return joined.length > maxChars ? joined.slice(joined.length - maxChars) : joined;
}

export function publicPipelineUrl(value, publicBase = DEFAULT_PUBLIC_CI) {
  const url = cleanText(value);
  if (!url) return publicBase;
  return url
    .replace(/^http:\/\/localhost:8000/i, publicBase)
    .replace(/^http:\/\/127\.0\.0\.1:8000/i, publicBase);
}

export function summarizeRelease({ report = null, logText = '', installerPaths = [] } = {}) {
  const failedStepId = report?.failedStep || 'workflow';
  const failedStep = Array.isArray(report?.steps)
    ? report.steps.find((step) => step?.id === failedStepId) ?? null
    : null;

  const stderr = cleanText(failedStep?.stderr);
  const stdout = cleanText(failedStep?.stdout);
  const fallback = cleanText(logText);
  const diagnostic = stderr || stdout || fallback || 'Falha sem saída capturada pelo artisys-release.';
  const installerPath = Array.isArray(installerPaths) && installerPaths.length ? installerPaths[0] : null;

  return {
    status: report?.status || 'failure',
    failedStep: failedStepId,
    exitCode: Number.isInteger(failedStep?.exitCode) ? failedStep.exitCode : null,
    command: cleanText(failedStep?.command) || null,
    errorExcerpt: tailLines(diagnostic),
    installerFound: Boolean(installerPath),
    installerPath,
  };
}

export function truncateDescription(value, max = 140) {
  const text = cleanText(value).replace(/\s+/g, ' ');
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function buildFailureMarkdown({ repo, sha, branch, pipelineUrl, summary }) {
  const shortSha = cleanText(sha).slice(0, 12) || 'desconhecido';
  const safeRepo = cleanText(repo) || 'repositorio-desconhecido';
  const product = safeRepo.split('/').pop() || safeRepo;
  const url = publicPipelineUrl(pipelineUrl);
  const installer = summary?.installerFound
    ? `SIM — \`${summary.installerPath}\``
    : 'NÃO';
  const exitCode = summary?.exitCode === null || summary?.exitCode === undefined ? 'indisponível' : String(summary.exitCode);
  const command = summary?.command ? `\n- Comando: \`${summary.command}\`` : '';
  const excerpt = cleanText(summary?.errorExcerpt) || 'Falha sem saída capturada.';

  return [
    `<!-- artisys-woodpecker-report:${shortSha} -->`,
    `## ${product} — Woodpecker falhou`,
    '',
    `- Commit: \`${shortSha}\``,
    `- Branch: \`${cleanText(branch) || 'desconhecida'}\``,
    `- Step: \`${cleanText(summary?.failedStep) || 'workflow'}\``,
    `- Exit code: \`${exitCode}\`${command}`,
    `- Instalador gerado: ${installer}`,
    `- Pipeline: ${url}`,
    '',
    '### Erro capturado',
    '```text',
    tailLines(excerpt, 40, 6000),
    '```',
    '',
    '_Relatório automático do PDV ArtiSys / Woodpecker._',
  ].join('\n');
}

async function githubRequest(url, { token, method = 'GET', body = null, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'artisys-woodpecker-reporter',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const detail = typeof response.text === 'function' ? await response.text() : '';
    throw new Error(`GitHub API ${method} ${url} falhou (${response.status}): ${detail}`);
  }
  return typeof response.json === 'function' ? response.json() : null;
}

export async function publishGitHubFailure({
  token,
  repo,
  sha,
  branch,
  sourceBranch = null,
  pipelineUrl,
  summary,
  fetchImpl = globalThis.fetch,
  apiBase = DEFAULT_API,
}) {
  if (!cleanText(token)) throw new Error('GITHUB_REPORT_TOKEN ausente.');
  if (!cleanText(repo) || !repo.includes('/')) throw new Error('CI_REPO invalido ou ausente.');
  if (!cleanText(sha)) throw new Error('CI_COMMIT_SHA ausente.');

  const [owner] = repo.split('/');
  const publicUrl = publicPipelineUrl(pipelineUrl);
  const markdown = buildFailureMarkdown({ repo, sha, branch, pipelineUrl: publicUrl, summary });
  const description = truncateDescription(
    `${summary?.failedStep || 'workflow'} falhou${summary?.exitCode === null || summary?.exitCode === undefined ? '' : ` (exit ${summary.exitCode})`}; installer ${summary?.installerFound ? 'gerado' : 'nao gerado'}`,
  );

  await githubRequest(`${apiBase}/repos/${repo}/statuses/${sha}`, {
    token,
    method: 'POST',
    body: {
      state: 'failure',
      target_url: publicUrl,
      description,
      context: 'ci/woodpecker/pdv-release-detail',
    },
    fetchImpl,
  });

  await githubRequest(`${apiBase}/repos/${repo}/commits/${sha}/comments`, {
    token,
    method: 'POST',
    body: { body: markdown },
    fetchImpl,
  });

  let prNumber = null;
  const headBranch = cleanText(sourceBranch) || cleanText(branch);
  if (headBranch) {
    try {
      const query = new URLSearchParams({ state: 'open', head: `${owner}:${headBranch}`, per_page: '10' });
      const pulls = await githubRequest(`${apiBase}/repos/${repo}/pulls?${query}`, {
        token,
        fetchImpl,
      });
      if (Array.isArray(pulls) && pulls.length) {
        prNumber = pulls[0].number;
        try {
          await githubRequest(`${apiBase}/repos/${repo}/issues/${prNumber}/comments`, {
            token,
            method: 'POST',
            body: { body: markdown },
            fetchImpl,
          });
        } catch (error) {
          console.warn(`[Woodpecker Reporter] Comentario no PR #${prNumber} nao publicado: ${error.message}`);
        }
      }
    } catch (error) {
      console.warn(`[Woodpecker Reporter] Consulta de PR ignorada: ${error.message}`);
    }
  }

  return { prNumber, markdown, description, pipelineUrl: publicUrl };
}
