import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, '../cache/proofs');

// Ensure cache directory exists
if (!existsSync(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true });
}

function cacheKey(params, features) {
  const data = JSON.stringify({ params, features });
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Get a cached proof by params and features.
 */
export function getCachedProof(params, features) {
  const key = cacheKey(params, features);
  const filePath = resolve(CACHE_DIR, `${key}.json`);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

/**
 * Cache a proof result.
 */
export function cacheProof(params, features, result) {
  const key = cacheKey(params, features);
  const filePath = resolve(CACHE_DIR, `${key}.json`);
  writeFileSync(filePath, JSON.stringify(result, null, 2));
  return filePath;
}

/**
 * Get a pre-generated scenario proof by name (normal, tampered_amount, tampered_recipient).
 */
export function getScenarioProof(name) {
  const filePath = resolve(CACHE_DIR, `${name}.json`);
  if (!existsSync(filePath)) {
    throw new Error(`No cached proof for scenario "${name}". Run: npm run generate-cache`);
  }
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}
