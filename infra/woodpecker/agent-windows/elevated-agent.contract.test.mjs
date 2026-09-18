import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

test('elevated launcher uses isolated local backend identity', () => {
  const script = read('start-elevated-agent.ps1');
  assert.match(script, /ServerEnvPath/);
  assert.match(script, /agent-elevated\.conf/i);
  assert.doesNotMatch(script, /Join-Path\s+\$InstallDir\s+['"]agent\.conf['"]/i);
  assert.match(script, /WOODPECKER_BACKEND\s*=\s*'local'/);
  assert.match(script, /repo=nutricionistaalmeidavh-spec\/OBRANAMAOCOMERCIAL/i);
  assert.match(script, /!privilege=elevated/i);
  assert.match(script, /owner=artisys/);
  assert.match(script, /ARTISYS_AGENT_PRIVILEGE\s*=\s*'elevated'/);
  assert.match(script, /ARTISYS_AGENT_OWNER\s*=\s*'artisys'/);
  assert.match(script, /ARTISYS_AGENT_PLATFORM\s*=\s*'windows\/amd64'/);
  assert.match(script, /woodpecker-work-elevated/i);
  assert.match(script, /WOODPECKER_MAX_WORKFLOWS\s*=\s*'1'/);
  assert.match(script, /artisys-windows-ci/i);
});

test('installer registers a persistent separate highest interactive task without replacing the normal agent', () => {
  const script = read('install-elevated-agent.ps1');
  assert.match(script, /ArtiSys Woodpecker Agent Elevated/);
  assert.match(script, /RunLevel\s+Highest/);
  assert.match(script, /LogonType\s+Interactive/);
  assert.match(script, /USERNAME/);
  assert.match(script, /start-elevated-agent\.ps1/i);
  assert.match(script, /start-woodpecker-agent-elevated\.ps1/i);
  assert.match(script, /Copy-Item[^\n]*launcher/i);
  assert.match(script, /run-woodpecker-agent\.ps1/i);
  assert.match(script, /ServerEnvPath/);
  assert.match(script, /utilidades-elevated/i);
  assert.doesNotMatch(script, /Unregister-ScheduledTask[^\n]*ArtiSys Woodpecker Agent['"]/i);
  assert.doesNotMatch(script, /ServiceAccount|UserId\s+['"]SYSTEM['"]/i);
});
