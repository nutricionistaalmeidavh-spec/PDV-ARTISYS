export function monthStartPtBr(date=new Date()){
  if(!(date instanceof Date)||!Number.isFinite(date.getTime()))throw TypeError('Data QA inválida');
  const month=String(date.getMonth()+1).padStart(2,'0');
  return '01/'+month+'/'+String(date.getFullYear());
}
