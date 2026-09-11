'use strict';
const http=require('node:http');
const { createRouter }=require('./router');
const { createRestaurantRouter }=require('./restaurant-router');
const { createVerticalRouter }=require('./vertical-router');
function createLocalServer({runtime,host='127.0.0.1',port=4174,token='',bodyLimitBytes=1024*1024,allowedOrigins=[],requireTerminalAuth=false}={}){
  const restaurantHandler=createRestaurantRouter({runtime,installationToken:token,requireTerminalAuth});
  const verticalHandler=createVerticalRouter({runtime,installationToken:token,requireTerminalAuth});
  const handler=createRouter({runtime,installationToken:token,bodyLimitBytes,allowedOrigins,requireTerminalAuth});let server=null;
  async function route(req,res){let handled=await restaurantHandler(req,res);if(!handled)handled=await verticalHandler(req,res);if(!handled)await handler(req,res);}
  async function start(){if(server)throw new Error('Servidor local ja iniciado.');server=http.createServer((req,res)=>{Promise.resolve(route(req,res)).catch(error=>{if(!res.headersSent){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}else res.end();});});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});const address=server.address();return{host:typeof address==='object'&&address?address.address:host,port:typeof address==='object'&&address?address.port:port};}
  async function stop(){if(!server)return;const current=server;server=null;await new Promise((resolve,reject)=>current.close(error=>error?reject(error):resolve()));}
  return{start,stop,get running(){return Boolean(server);}};
}
module.exports={createLocalServer};
