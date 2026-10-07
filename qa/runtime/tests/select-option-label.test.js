import test from 'node:test';
import assert from 'node:assert/strict';
import { executeStep } from '../src/steps.js';

test('selectOption can choose by visible label for generated ids',async()=>{
  const calls=[];
  const page={locator:()=>({selectOption:async value=>{calls.push(value);}})};
  await executeStep({
    page,
    step:{action:'selectOption',selector:'#pizza-size',optionLabel:'Grande'},
    index:0,
    screenshotsDir:'/tmp',
    runtimeContext:{vars:{}}
  });
  assert.deepEqual(calls,[{label:'Grande'}]);
});
