'use strict';

function createDeviceAccessService({mobileDevices}={}){
  if(!mobileDevices)throw new TypeError('mobileDevices is required.');

  function principalForDevice(device){
    if(!device?.id||!device?.surface)return null;
    return {
      kind:'device',
      id:String(device.id),
      surface:String(device.surface),
      userId:device.userId?String(device.userId):null
    };
  }

  function authenticate(deviceId,credential){
    const auth=mobileDevices.authenticate(deviceId,credential);
    if(!auth.ok)return auth;
    return {
      ok:true,
      device:auth.device,
      principal:principalForDevice(auth.device),
      scope:auth.device.scope||null
    };
  }

  return Object.freeze({authenticate,principalForDevice});
}

module.exports={createDeviceAccessService};
