'use strict';

function statusForError(error,{uniqueConflict=true}={}){
  const explicit=Number(error?.statusCode);
  if(Number.isInteger(explicit)&&explicit>=400&&explicit<=599)return explicit;
  if(error?.code==='MODULE_DISABLED')return 409;
  if(uniqueConflict&&/UNIQUE constraint failed/i.test(String(error?.message||'')))return 409;
  return 500;
}

module.exports={statusForError};
