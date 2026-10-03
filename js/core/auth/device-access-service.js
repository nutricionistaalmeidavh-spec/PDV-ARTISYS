'use strict';

function principalForDevice(device){
  if(!device?.id||!device?.surface)return null;
  const principal={
    kind:'device',
    id:String(device.id),
    surface:String(device.surface),
    userId:device.userId?String(device.userId):null
  };
  if(device.scope)principal.scope={type:String(device.scope.type),id:device.scope.id==null?null:String(device.scope.id)};
  return principal;
}

function deviceResourcePolicy({principal,resource}={}){
  if(principal?.kind!=='device')return true;
  const scope=principal.scope||null;
  if(!scope||scope.type==='establishment')return true;
  if(scope.type==='table'){
    return Boolean(resource&&String(resource.type||'').toLowerCase()==='table'&&String(resource.id||'')===String(scope.id||''));
  }
  return false;
}

function createDeviceAccessService({mobileDevices}={}){
  if(!mobileDevices)throw new TypeError('mobileDevices is required.');

  function authenticate(deviceId,credential){
    if(typeof mobileDevices.authenticatePrincipal==='function'){
      const auth=mobileDevices.authenticatePrincipal(deviceId,credential);
      if(!auth.ok)return auth;
      return {...auth,scope:auth.device.scope||auth.principal.scope||null};
    }
    const auth=mobileDevices.authenticate(deviceId,credential);
    if(!auth.ok)return auth;
    const principal=principalForDevice(auth.device);
    return {ok:true,device:auth.device,principal,scope:auth.device.scope||null};
  }

  return Object.freeze({authenticate,principalForDevice});
}

module.exports={createDeviceAccessService,principalForDevice,deviceResourcePolicy};
