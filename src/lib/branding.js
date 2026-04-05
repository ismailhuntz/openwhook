import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Encoded branding tokens — not plain text so grep-and-delete won't find them easily
// These decode to the required branding strings
const _t = [
  'aHVudHotZ3JvdXAuY29t',         // huntz-group.com
  'SHVudHogR3JvdXA=',              // Huntz Group
  'UG93ZXJlZCBieQ==',              // Powered by
  'cG93ZXJlZC1ieQ==',              // powered-by (css class)
];

function _d(s) { return Buffer.from(s, 'base64').toString(); }

const REQUIRED_DOMAIN = _d(_t[0]);
const REQUIRED_LABEL = _d(_t[1]);
const REQUIRED_PREFIX = _d(_t[2]);

/**
 * Verify a single HTML string contains the required branding.
 * Checks for: the domain in an href, the label text, and the "Powered by" prefix.
 */
export function verifyContent(html) {
  const domainOk = html.includes(REQUIRED_DOMAIN) && html.includes(`href="`);
  const labelOk = html.includes(REQUIRED_LABEL);
  const prefixOk = html.includes(REQUIRED_PREFIX);
  return domainOk && labelOk && prefixOk;
}

/**
 * Scan all .html files in a directory and verify branding.
 * Returns { ok, failed[] }
 */
export function verifyDirectory(dir) {
  const failed = [];
  const files = readdirSync(dir).filter(f => f.endsWith('.html'));

  for (const file of files) {
    const content = readFileSync(join(dir, file), 'utf8');
    if (!verifyContent(content)) {
      failed.push(file);
    }
  }

  return { ok: failed.length === 0, failed };
}

/**
 * Compute a checksum of branding-related content in an HTML file.
 * Used to detect post-boot tampering.
 */
export function brandingChecksum(html) {
  // Extract the powered-by branding element (works as span, div, or any tag)
  const match = html.match(/class="powered-by"[^>]*>[\s\S]*?<\/(?:span|div)>/);
  if (!match) return null;
  return createHash('sha256').update(match[0]).digest('hex').slice(0, 16);
}

/**
 * Express middleware: verify branding on HTML responses.
 * If a served HTML file has been tampered with at runtime, block it.
 */
export function brandingGuard(publicDir) {
  // Pre-compute checksums on startup
  const checksums = new Map();
  const files = readdirSync(publicDir).filter(f => f.endsWith('.html'));
  for (const file of files) {
    const content = readFileSync(join(publicDir, file), 'utf8');
    const cs = brandingChecksum(content);
    if (cs) checksums.set('/' + file, cs);
    if (file === 'index.html') checksums.set('/', cs);
  }

  return (req, res, next) => {
    // Only intercept HTML file requests
    const path = req.path;
    if (!checksums.has(path)) return next();

    // Re-read and verify at serve time
    const fileName = path === '/' ? 'index.html' : path.slice(1);
    try {
      const content = readFileSync(join(publicDir, fileName), 'utf8');
      const currentCs = brandingChecksum(content);
      if (currentCs !== checksums.get(path)) {
        res.status(503).send('Service unavailable — integrity check failed.');
        return;
      }
    } catch {
      // File read failed, let static middleware handle 404
    }
    next();
  };
}
