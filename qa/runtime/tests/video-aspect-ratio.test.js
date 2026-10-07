import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildFrameSequenceArgs, createFrameRecorder } from '../src/video.js';

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


test('frame recorder survives one transient screenshot failure and keeps recording',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'artisys-video-transient-'));
  let calls=0;
  const page={
    async screenshot({path:file}){
      calls+=1;
      if(calls===2)throw new Error('transient screenshot failure');
      await fs.writeFile(file,'frame');
    }
  };
  const recorder=createFrameRecorder(page,{dir,fps:20,captureTimeoutMs:100,canvasWidth:100,canvasHeight:100});
  await recorder.start();
  try{
    await new Promise(resolve=>setTimeout(resolve,180));
    const entries=await fs.readdir(dir);
    assert.ok(entries.filter(name=>name.endsWith('.png')).length>=2,'recorder should resume after one failed frame');
    assert.equal(entries.includes('VIDEO_CAPTURE_DISABLED.txt'),false,'one transient failure must not disable the whole video');
  }finally{
    await recorder.stop(path.join(dir,'out.mp4'));
    await fs.rm(dir,{recursive:true,force:true});
  }
});
