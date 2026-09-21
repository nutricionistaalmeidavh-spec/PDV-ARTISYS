'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createFiscalPackService } = require('../js/domains/fiscal/fiscal-pack-store');

test('P21: versioned repository example is a valid importable local Fiscal Pack', () => {
  const example = path.join(__dirname, '..', 'fiscal-packs', 'examples', 'br-core-2026.09.0');
  const service = createFiscalPackService({ storeRoot:path.join(__dirname, '.unused-fiscal-pack-store') });
  const validation = service.validate(example);
  assert.equal(validation.valid, true);
  assert.equal(validation.manifest.id, 'br-core-example');
  assert.equal(validation.manifest.version, '2026.09.0');
  assert.equal(validation.files.length, 1);
});
