'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('pizza recipe schema belongs to an explicit migration, never service startup',()=>{
  const service=fs.readFileSync('js/domains/pizzeria/pizzeria-service.js','utf8');
  const runtime=fs.readFileSync('js/core/pdv-runtime.js','utf8');
  const migration=fs.readFileSync('js/core/database/pizzeria-recipe-migrations.js','utf8');
  const vertical=fs.readFileSync('js/core/database/vertical-migrations.js','utf8');

  assert.doesNotMatch(service,/ALTER TABLE|PRAGMA table_info|ensureCanonicalColumns/);
  assert.match(migration,/PIZZERIA_RECIPE_SCHEMA_VERSION=33/);
  assert.match(migration,/pizza_sizes/);
  assert.match(migration,/recipe_multiplier/);
  assert.match(migration,/pizza_flavors/);
  assert.match(migration,/recipe_product_id/);
  assert.match(migration,/pizza_crusts/);
  assert.match(runtime,/runPizzeriaRecipeMigrations\(db,now\)/);
  assert.doesNotMatch(vertical,/recipe_multiplier|recipe_product_id|pizza_recipe_composition_v9/);
});
