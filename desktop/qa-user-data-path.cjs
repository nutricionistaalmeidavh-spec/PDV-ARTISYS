'use strict';
// CI-only Electron userData override. APPDATA alone does not guarantee isolation
// on Windows because known-folder APIs may ignore process environment changes.
const path=require('node:path');
function resolveQaUserDataPath(env=process.env){
 if(!['true','1'].includes(String(env.CI||'').toLowerCase())||env.ARTISYS_QA!=='1')
  return null;
 const target=String(env.ARTISYS_QA_USERDATA_DIR||'');
 if(!path.isAbsolute(target))return null;
 const normalized=path.normalize(target);
 if(normalized===path.parse(normalized).root)return null;
 return normalized;
}
module.exports={resolveQaUserDataPath};
