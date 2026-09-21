'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PACK_ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/i;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_RE = /^[a-f0-9]{64}$/i;
const ALLOWED_KINDS = new Set(['schemas', 'tables', 'parameters', 'rules']);
const ALLOWED_EXTENSIONS = new Set(['.json', '.xml', '.xsd', '.csv', '.txt', '.ini']);
const MAX_FILES = 2048;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PACK_BYTES = 100 * 1024 * 1024;

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function normalizePackRelativePath(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.includes('\0')) throw new Error('Fiscal Pack path invalido.');
  if (path.win32.isAbsolute(raw) || path.posix.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) {
    throw new Error('Fiscal Pack path deve ser relativo.');
  }
  const normalized = raw.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error('Fiscal Pack path contem traversal ou segmento invalido.');
  }
  const extension = path.posix.extname(normalized).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error(`Extensao de arquivo nao permitida em Fiscal Pack: ${extension || '(sem extensao)'}.`);
  }
  return normalized;
}

function resolveInside(root, relativePath) {
  const base = path.resolve(root);
  const target = path.resolve(base, ...relativePath.split('/'));
  const prefix = `${base}${path.sep}`;
  if (target !== base && !target.startsWith(prefix)) throw new Error('Fiscal Pack path escapou do diretorio permitido.');
  return target;
}

function readJson(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} invalido: ${error.message}`);
  }
  return parsed;
}

function validateFiscalPackManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Manifest Fiscal Pack invalido.');
  if (input.formatVersion !== 1) throw new Error('Fiscal Pack formatVersion nao suportado.');
  const id = String(input.id || '').trim();
  const version = String(input.version || '').trim();
  const createdAt = String(input.createdAt || '').trim();
  if (!PACK_ID_RE.test(id) || id === '.' || id === '..') throw new Error('Fiscal Pack id invalido.');
  if (!VERSION_RE.test(version)) throw new Error('Fiscal Pack version invalida; use SemVer x.y.z.');
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) throw new Error('Fiscal Pack createdAt invalido.');
  if (!Array.isArray(input.files) || input.files.length < 1 || input.files.length > MAX_FILES) {
    throw new Error(`Fiscal Pack files deve conter entre 1 e ${MAX_FILES} arquivos.`);
  }

  const seen = new Set();
  const files = input.files.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Fiscal Pack files[${index}] invalido.`);
    const kind = String(entry.kind || '').trim();
    if (!ALLOWED_KINDS.has(kind)) throw new Error(`Fiscal Pack kind nao permitido: ${kind || '(vazio)'}.`);
    const relativePath = normalizePackRelativePath(entry.path);
    if (!relativePath.startsWith(`${kind}/`)) throw new Error(`Fiscal Pack path ${relativePath} deve ficar sob ${kind}/.`);
    if (seen.has(relativePath)) throw new Error(`Fiscal Pack arquivo duplicado: ${relativePath}.`);
    seen.add(relativePath);
    const sha256 = String(entry.sha256 || '').trim().toLowerCase();
    if (!SHA256_RE.test(sha256)) throw new Error(`Fiscal Pack sha256 invalido: ${relativePath}.`);
    return { path:relativePath, kind, sha256 };
  });

  return {
    formatVersion:1,
    id,
    version,
    createdAt:new Date(createdAt).toISOString(),
    files
  };
}

function validatePackDirectory(packDirectory) {
  const packRoot = path.resolve(packDirectory);
  const rootStat = fs.lstatSync(packRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Fiscal Pack deve ser um diretorio local real.');
  const manifestPath = path.join(packRoot, 'manifest.json');
  const manifestStat = fs.lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error('Fiscal Pack manifest.json invalido.');
  const manifest = validateFiscalPackManifest(readJson(manifestPath, 'Fiscal Pack manifest.json'));

  let totalBytes = 0;
  const files = manifest.files.map(entry => {
    const filePath = resolveInside(packRoot, entry.path);
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Fiscal Pack arquivo invalido: ${entry.path}.`);
    if (stat.size > MAX_FILE_BYTES) throw new Error(`Fiscal Pack arquivo excede limite: ${entry.path}.`);
    totalBytes += stat.size;
    if (totalBytes > MAX_PACK_BYTES) throw new Error('Fiscal Pack excede o limite total permitido.');
    const actual = sha256File(filePath);
    if (actual !== entry.sha256) throw new Error(`Fiscal Pack checksum SHA256 divergente: ${entry.path}.`);
    return { ...entry, filePath, size:stat.size };
  });

  return { valid:true, packRoot, manifest, files, totalBytes };
}

function canonicalManifest(manifest) {
  return JSON.stringify(validateFiscalPackManifest(manifest));
}

function manifestsEqual(left, right) {
  return canonicalManifest(left) === canonicalManifest(right);
}

function createFiscalPackService({ storeRoot } = {}) {
  if (!storeRoot) throw new Error('Fiscal Pack storeRoot obrigatorio.');
  const root = path.resolve(storeRoot);

  function validate(packDirectory) {
    return validatePackDirectory(packDirectory);
  }

  function existingResult(destination, manifest) {
    if (!fs.existsSync(destination)) return null;
    const installed = validatePackDirectory(destination);
    if (!manifestsEqual(installed.manifest, manifest)) {
      throw new Error(`Fiscal Pack ${manifest.id}@${manifest.version} ja existe com conteudo diferente.`);
    }
    return {
      installed:false,
      alreadyInstalled:true,
      id:manifest.id,
      version:manifest.version,
      installPath:destination,
      manifest:installed.manifest
    };
  }

  function importPack(packDirectory) {
    const source = validatePackDirectory(packDirectory);
    const destination = path.join(root, source.manifest.id, source.manifest.version);
    const previous = existingResult(destination, source.manifest);
    if (previous) return previous;

    fs.mkdirSync(path.dirname(destination), { recursive:true });
    const staging = path.join(root, `.staging-${source.manifest.id}-${source.manifest.version}-${crypto.randomBytes(8).toString('hex')}`);
    fs.mkdirSync(staging, { recursive:false });
    try {
      for (const entry of source.files) {
        const target = resolveInside(staging, entry.path);
        fs.mkdirSync(path.dirname(target), { recursive:true });
        fs.copyFileSync(entry.filePath, target, fs.constants.COPYFILE_EXCL);
      }
      fs.writeFileSync(path.join(staging, 'manifest.json'), `${JSON.stringify(source.manifest, null, 2)}\n`, { flag:'wx' });
      validatePackDirectory(staging);
      try {
        fs.renameSync(staging, destination);
      } catch (error) {
        if (fs.existsSync(destination)) {
          const raced = existingResult(destination, source.manifest);
          if (raced) return raced;
        }
        throw error;
      }
    } finally {
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive:true, force:true });
    }

    return {
      installed:true,
      alreadyInstalled:false,
      id:source.manifest.id,
      version:source.manifest.version,
      installPath:destination,
      manifest:source.manifest
    };
  }

  function listInstalled() {
    if (!fs.existsSync(root)) return [];
    const results = [];
    for (const idEntry of fs.readdirSync(root, { withFileTypes:true })) {
      if (!idEntry.isDirectory() || idEntry.name.startsWith('.staging-')) continue;
      const idRoot = path.join(root, idEntry.name);
      for (const versionEntry of fs.readdirSync(idRoot, { withFileTypes:true })) {
        if (!versionEntry.isDirectory()) continue;
        const installed = validatePackDirectory(path.join(idRoot, versionEntry.name));
        results.push({
          id:installed.manifest.id,
          version:installed.manifest.version,
          installPath:installed.packRoot,
          manifest:installed.manifest
        });
      }
    }
    return results.sort((a, b) => `${a.id}@${a.version}`.localeCompare(`${b.id}@${b.version}`));
  }

  return Object.freeze({ storeRoot:root, validate, importPack, listInstalled });
}

module.exports = {
  createFiscalPackService,
  validateFiscalPackManifest,
  normalizePackRelativePath,
  validatePackDirectory,
  sha256File
};
