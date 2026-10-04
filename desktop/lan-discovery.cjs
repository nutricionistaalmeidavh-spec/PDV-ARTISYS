'use strict';
const {createHash}=require('node:crypto');
const {lookup}=require('node:dns').promises;
const {lanAddresses}=require('./public-network.cjs');

function stableHostname(identity){return `artisys-${createHash('sha256').update(String(identity)).digest('hex').slice(0,10)}.local`;}
function createLanDiscovery({identity,port,interfaces,resolve=lookup,bonjourFactory}={}){
  const hostname=stableHostname(identity);let bonjour=null,service=null,signature='',ready=false,closed=false;
  function refresh(){
    if(closed)return;
    const addresses=lanAddresses(interfaces?.());const next=addresses.join(',');
    if(next===signature&&service)return;
    signature=next;ready=false;
    service?.stop();service=null;
    if(!addresses.length)return;
    try{
      bonjour ||= bonjourFactory?bonjourFactory():new (require('bonjour-service').Bonjour)({},()=>{ready=false;});
      bonjour.server?.mdns?.on('error',()=>{ready=false;});
      service=bonjour.publish({name:hostname.replace('.local',''),host:hostname,type:'http',port,disableIPv6:true,txt:{product:'ArtiSys',path:'/customer-menu'}});
      const original=service.records.bind(service);
      service.records=()=>original().filter(record=>record.type!=='A'&&record.type!=='AAAA').concat(addresses.map(address=>({name:hostname,type:'A',ttl:30,data:address})));
      const published=service;
      service.on('up',()=>{if(service===published)ready=true;});
      service.on('error',()=>{ready=false;});
    }catch{ready=false;}
  }
  refresh();const timer=setInterval(refresh,5000);timer.unref?.();
  async function state(){
    refresh();if(!ready)return '';
    try{const result=await Promise.race([resolve(hostname,{all:true,family:4}),new Promise((_,reject)=>{const timeout=setTimeout(()=>reject(new Error('DNS timeout')),1500);timeout.unref?.();})]);const valid=lanAddresses(interfaces?.());return result.length&&result.every(row=>valid.includes(row.address))?hostname:'';}catch{return '';}
  }
  function stop(){closed=true;clearInterval(timer);service?.stop();bonjour?.destroy();service=null;ready=false;}
  return {hostname,state,refresh,stop};
}
module.exports={stableHostname,createLanDiscovery};
