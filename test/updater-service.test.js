'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdaterService } = require('../desktop/updater-service.cjs');

function fakeUpdater() {
  const updater = new EventEmitter();
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = true;
  updater.checkCalls = 0;
  updater.downloadCalls = 0;
  updater.installCalls = 0;
  updater.checkForUpdates = async () => { updater.checkCalls += 1; };
  updater.downloadUpdate = async () => { updater.downloadCalls += 1; };
  updater.quitAndInstall = () => { updater.installCalls += 1; };
  updater.setFeedURL = (value) => { updater.feed = value; };
  return updater;
}

test('updater configures manual download and install-on-quit', () => {
  const autoUpdater = fakeUpdater();
  const service = createUpdaterService({ app:{getVersion:()=> '1.3.4',isPackaged:true}, autoUpdater, platform:'win32' });
  assert.equal(autoUpdater.autoDownload,false);
  assert.equal(autoUpdater.autoInstallOnAppQuit,true);
  assert.equal(autoUpdater.allowPrerelease,false);
  assert.equal(service.state().supported,true);
});

test('updater uses generic feed when an update URL is configured', () => {
  const autoUpdater = fakeUpdater();
  createUpdaterService({ app:{getVersion:()=> '1.3.4',isPackaged:true}, autoUpdater, platform:'win32', updateUrl:'https://updates.example/pdv' });
  assert.deepEqual(autoUpdater.feed,{provider:'generic',url:'https://updates.example/pdv'});
});

test('updater emits available, progress and downloaded states', () => {
  const autoUpdater = fakeUpdater();
  const states=[];
  const service = createUpdaterService({ app:{getVersion:()=> '1.3.4',isPackaged:true}, autoUpdater, platform:'win32', onState:(state)=>states.push(state) });
  autoUpdater.emit('update-available',{version:'1.3.5'});
  autoUpdater.emit('download-progress',{percent:42.4});
  autoUpdater.emit('update-downloaded',{version:'1.3.5'});
  assert.equal(states.at(-1).status,'downloaded');
  assert.equal(states.at(-1).availableVersion,'1.3.5');
  assert.equal(states.at(-1).progress,100);
});

test('updater supports check, download and install commands', async () => {
  const autoUpdater = fakeUpdater();
  const service = createUpdaterService({ app:{getVersion:()=> '1.3.4',isPackaged:true}, autoUpdater, platform:'win32' });
  await service.check();
  autoUpdater.emit('update-available',{version:'1.3.5'});
  await service.download();
  autoUpdater.emit('update-downloaded',{version:'1.3.5'});
  service.install();
  assert.equal(autoUpdater.checkCalls,1);
  assert.equal(autoUpdater.downloadCalls,1);
  assert.equal(autoUpdater.installCalls,1);
});

test('updater is unsupported outside packaged Windows', async () => {
  const autoUpdater = fakeUpdater();
  const service = createUpdaterService({ app:{getVersion:()=> '1.3.4',isPackaged:false}, autoUpdater, platform:'win32' });
  assert.equal(service.state().supported,false);
  assert.equal((await service.check()).status,'unsupported');
});
