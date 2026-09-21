'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFiscalCredentialStore, validatePfxBuffer } = require('../desktop/fiscal-credential-store.cjs');

function fakeSafeStorage() {
  return {
    isEncryptionAvailable:() => true,
    encryptString:value => Buffer.from(`enc:${Buffer.from(value,'utf8').toString('base64')}`,'utf8'),
    decryptString:buffer => {
      const text=Buffer.from(buffer).toString('utf8');
      if(!text.startsWith('enc:')) throw new Error('cipher invalido');
      return Buffer.from(text.slice(4),'base64').toString('utf8');
    }
  };
}

test('P3 keeps PFX password and CSC encrypted and never returns them in public status', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-fiscal-cred-'));
  try {
    const app={getPath:()=>dir};
    const store=createFiscalCredentialStore({
      app,
      safeStorage:fakeSafeStorage(),
      inspectPfx:({pfx,password}) => {
        assert.equal(Buffer.from(pfx).toString('utf8'),'TEST-PFX');
        assert.equal(password,'senha-super-secreta');
        return {
          fingerprint:'AA:BB:CC', subject:'CN=EMPRESA TESTE', serialNumber:'1234',
          validFrom:'2026-01-01T00:00:00.000Z', validTo:'2027-01-01T00:00:00.000Z', cnpj:'AB123456789CDE'
        };
      },
      now:()=>new Date('2026-09-20T18:00:00-03:00')
    });

    const publicStatus=store.save({
      pfxBase64:Buffer.from('TEST-PFX').toString('base64'),
      password:'senha-super-secreta',
      csc:'CSC-SEGREDO-123',
      cscId:'1',
      certificateName:'empresa.pfx'
    });
    assert.equal(publicStatus.configured,true);
    assert.equal(publicStatus.expired,false);
    assert.equal(publicStatus.certificate.fingerprint,'AA:BB:CC');
    assert.equal('password' in publicStatus,false);
    assert.equal('csc' in publicStatus,false);
    assert.equal('pfxBase64' in publicStatus,false);

    const raw=fs.readFileSync(store.filePath,'utf8');
    for(const secret of ['senha-super-secreta','CSC-SEGREDO-123','TEST-PFX']) assert.equal(raw.includes(secret),false);

    const internal=store.readSecret();
    assert.equal(internal.password,'senha-super-secreta');
    assert.equal(internal.csc,'CSC-SEGREDO-123');
    assert.equal(Buffer.from(internal.pfxBase64,'base64').toString('utf8'),'TEST-PFX');
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('P3 marks expired A1 as unusable and invalid PFX fails closed', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-fiscal-cred-expired-'));
  try {
    const app={getPath:()=>dir};
    const store=createFiscalCredentialStore({
      app,
      safeStorage:fakeSafeStorage(),
      inspectPfx:() => ({
        fingerprint:'EXPIRED', subject:'CN=EXPIRADO', serialNumber:'9',
        validFrom:'2024-01-01T00:00:00.000Z', validTo:'2025-01-01T00:00:00.000Z', cnpj:null
      }),
      now:()=>new Date('2026-09-20T18:00:00-03:00')
    });
    const status=store.save({
      pfxBase64:Buffer.from('EXPIRED-PFX').toString('base64'), password:'senha', csc:'csc', cscId:'1', certificateName:'expirado.pfx'
    });
    assert.equal(status.expired,true);
    assert.throws(() => store.assertUsable(), /expirado|vencido/i);
    assert.throws(() => validatePfxBuffer({pfx:Buffer.from('nao-e-pfx'),password:'x'}), /PFX|PKCS|certificado/i);
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
