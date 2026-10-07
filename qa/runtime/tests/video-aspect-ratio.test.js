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



test('frame sequence rounds odd capture canvas dimensions up for yuv420 video',()=>{
  const args=buildFrameSequenceArgs('/tmp/%06d.png','/tmp/out.mp4',{
    effectiveFps:8,
    canvasWidth:412,
    canvasHeight:915
  });
  const vf=args[args.indexOf('-vf')+1];
  assert.match(vf,/scale=412:916:force_original_aspect_ratio=decrease/);
  assert.match(vf,/pad=412:916:\(ow-iw\)\/2:\(oh-ih\)\/2:black/);
});
