'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MOBILE_DIR = path.resolve(__dirname, '..');
const DEFAULT_REPO_ROOT = path.resolve(DEFAULT_MOBILE_DIR, '..', '..');
const DEFAULT_COMMON_DIR = path.join(DEFAULT_REPO_ROOT, 'packages', 'common');
const DEFAULT_MANIFEST = path.join(DEFAULT_COMMON_DIR, 'mobile-runtime-manifest.json');

function inside(base, candidate) {
  const rel = path.relative(base, candidate);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

function readManifest(manifestPath) {
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!parsed || !Array.isArray(parsed.files) || !parsed.files.length) {
    throw new Error('Mobile common runtime manifest is empty or invalid.');
  }
  if (new Set(parsed.files).size !== parsed.files.length) {
    throw new Error('Mobile common runtime manifest contains duplicate paths.');
  }
  return parsed;
}

function stageCommon(options = {}) {
  const mobileDir = path.resolve(options.mobileDir || DEFAULT_MOBILE_DIR);
  const commonDir = path.resolve(options.commonDir || DEFAULT_COMMON_DIR);
  const manifestPath = path.resolve(options.manifestPath || DEFAULT_MANIFEST);
  const manifest = readManifest(manifestPath);
  const staged = [];

  for (const relativePath of manifest.files) {
    if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
      throw new Error('Unsafe common runtime path: ' + String(relativePath));
    }
    const source = path.resolve(commonDir, relativePath);
    const target = path.resolve(mobileDir, relativePath);
    if (!inside(commonDir, source) || !inside(mobileDir, target)) {
      throw new Error('Common runtime path escaped its allowed directory: ' + relativePath);
    }
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      throw new Error('Missing packages/common runtime file: ' + relativePath);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });

    if (fs.existsSync(target)) {
      const current = fs.readFileSync(target);
      const canonical = fs.readFileSync(source);
      if (!current.equals(canonical)) {
        throw new Error('Refusing to overwrite a different Mobile source file: ' + relativePath);
      }
    } else {
      fs.copyFileSync(source, target);
    }
    staged.push(relativePath);
  }

  return { count: staged.length, files: staged };
}

if (require.main === module) {
  const result = stageCommon();
  process.stdout.write('Staged ' + result.count + ' Mobile common runtime files from packages/common.\n');
}

module.exports = { readManifest, stageCommon };
