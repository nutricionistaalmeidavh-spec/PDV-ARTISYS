'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RENDERER_DIR = path.resolve(__dirname, '../desktop/renderer');
const FORBIDDEN = [
  ['prompt', /(?:\b(?:window|root)\.)?\bprompt\s*\(/g],
  ['confirm', /(?:\b(?:window|root)\.)?\bconfirm\s*\(/g],
  ['alert', /(?:\b(?:window|root)\.)?\balert\s*\(/g],
];

test('desktop renderer does not use blocking browser dialogs', () => {
  const violations = [];
  const files = fs.readdirSync(RENDERER_DIR).filter(name => name.endsWith('.js')).sort();

  for (const file of files) {
    const source = fs.readFileSync(path.join(RENDERER_DIR, file), 'utf8');
    for (const [api, pattern] of FORBIDDEN) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const line = source.slice(0, match.index).split('\n').length;
        violations.push(`${file}:${line} uses ${api}()`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Blocking browser dialogs are unsupported in the Electron renderer. Use PdvUiDialog instead:\n${violations.join('\n')}`,
  );
});
