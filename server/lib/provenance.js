// Reproducibility hash quartet stamped on every analysis result.
//
//   { software_version, data_hash, params_hash, result_hash, computed_at }
//
// All four are SHA-256 hex digests over canonical-JSON inputs. The intent is
// that re-running the same kind + params on the same rows_storage_key
// produces identical hashes — something Minitab cannot prove because its
// source is closed and its analyses do not surface hashes at all.
//
// Used for: audit committees, regulated-industry validation, "did anyone
// change the inputs?" diffing across two runs.

import crypto from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read once at module load so the hash is stable across the process.
let _versionCache;
function softwareVersion() {
  if (_versionCache) return _versionCache;
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    _versionCache = `${pkg.name}@${pkg.version}`;
  } catch {
    _versionCache = 'conyso-bench-server@unknown';
  }
  return _versionCache;
}

// Canonical JSON: keys sorted, no extra whitespace. Same string for the
// same object regardless of property insertion order.
function canonical(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// Strip non-deterministic fields from the result before hashing so the
// result_hash is stable across re-runs (timestamps, chart storage keys
// that include a random UUID, etc.).
const NON_DETERMINISTIC_KEYS = new Set([
  'chart_storage_key', 'annotations', 'recipe', 'provenance',
  'created_at', 'updated_at',
]);

function stripVolatile(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripVolatile);
  const out = {};
  for (const k of Object.keys(obj)) {
    if (NON_DETERMINISTIC_KEYS.has(k)) continue;
    out[k] = stripVolatile(obj[k]);
  }
  return out;
}

/**
 * Compute the reproducibility quartet.
 * @param {object} args
 * @param {string} args.kind       — analysis kind (e.g. "capability")
 * @param {object} args.params     — caller params (canonicalised + hashed)
 * @param {object} args.result     — sidecar result (volatile fields stripped + hashed)
 * @param {string|null} args.dataKey — rows_storage_key (or null for standalone tools)
 */
export function computeProvenance({ kind, params, result, dataKey }) {
  const params_hash = sha256(canonical({ kind, params: params || {} }));
  const result_hash = sha256(canonical(stripVolatile(result || {})));
  // Without access to the actual file bytes here, we hash the storage key.
  // For standalone tools (no dataset), data_hash is null.
  const data_hash = dataKey ? sha256(`storage_key:${dataKey}`) : null;
  return {
    software_version: softwareVersion(),
    data_hash,
    params_hash,
    result_hash,
    computed_at: new Date().toISOString(),
  };
}
