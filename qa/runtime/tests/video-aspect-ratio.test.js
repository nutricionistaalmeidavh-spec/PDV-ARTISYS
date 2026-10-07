import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFrameSequenceArgs } from '../src/video.js';

test('frame recorder preserves aspect ratio when viewport changes during a tutorial',()=>{
  const args=buildFrameSequenceArgs('/tmp/%06d.png','/tmp/out.mp4',{
    effectiveFps:8,
    canvasWidth:1440,
    canvasHeight:900
  });
  const vf=args[args.indexOf('-vf')+1];
  assert.match(vf,/scale=1440:900:force_original_aspect_ratio=decrease/);
  assert.match(vf,/pad=1440:900:\(ow-iw\)\/2:\(oh-ih\)\/2:black/);
});
