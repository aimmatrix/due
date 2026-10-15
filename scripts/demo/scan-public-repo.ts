import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

// No matching content is ever printed, including in errors. Scan working contents
// of tracked files, not only HEAD; staged additions are included by git ls-files.
const files = [...new Set(execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean))];
let findings = 0;
function report(file: string, line: number, reason: string) {
  console.log(`${JSON.stringify(file)}:${line}: ${reason}`);
  findings++;
}
const secretPatterns: Array<[string, RegExp]> = [
  ['provider key-shaped secret', /\b(?:(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|rk_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{16,}|re_[A-Za-z0-9_-]{20,}|xi_[A-Za-z0-9_-]{20,}|sk_[A-Za-z0-9]{32,}|sk-ant-[A-Za-z0-9_-]{20,})\b/],
  ['private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
  ['ElevenLabs assigned key', /(?:ELEVENLABS_API_KEY|xi-api-key)["']?\s*[:=]\s*["']?[a-fA-F0-9]{32,}\b/i],
];
const reservedEmail = (domain: string) => /^(?:example\.(?:com|org|net)|localhost)$/i.test(domain) || /\.(?:example|test|invalid|localhost)$/i.test(domain);
for (const file of files) {
  const name = basename(file);
  if (name.startsWith('.env') && name !== '.env.example') report(file, 1, 'tracked environment file');
  if (/\.db(?:-(?:wal|shm|journal))?$/i.test(file)) report(file, 1, 'tracked SQLite database or sidecar');
  let bytes: Buffer;
  try { bytes = readFileSync(file); } catch { report(file, 1, 'tracked file unreadable'); continue; }
  // Latin-1 preserves ASCII secrets in binary files, too.
  const lines = bytes.toString('latin1').split('\n');
  for (const [index, line] of lines.entries()) {
    for (const [reason, pattern] of secretPatterns) if (pattern.test(line)) report(file, index + 1, reason);
    for (const email of line.matchAll(/\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@([A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,})\b/gi)) {
      if (!reservedEmail(email[1]!)) report(file, index + 1, 'non-reserved email address');
    }
    // Require at least ten digits. International +, domestic 0, US punctuation,
    // and bare 10–15 digit strings cover the common real-contact forms.
    for (const phone of line.matchAll(/(?:\+\d[\d ().-]{8,}\d|\b0[1-9][\d ().-]{8,}\d|\b\d{3}[-. ]\d{3}[-. ]\d{4}\b|\(\d{3}\)\s*\d{3}[-. ]?\d{4}|\b\d{10,15}\b)/g)) {
      const digits = phone[0].replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 15) continue;
      if (/^(?:44|0)7700900\d{3}$/.test(digits) || /^1?\d{3}55501\d{2}$/.test(digits)) continue;
      // A bare millisecond epoch is machine data, not a likely phone number.
      if (/^\d{13}$/.test(phone[0]) && /(?:timestamp|Date\.now|time|epoch)/i.test(line)) continue;
      report(file, index + 1, 'non-reserved phone-like number (inspect locally)');
    }
  }
}
console.log(`${findings ? 'FAIL' : 'PASS'} scan-public-repo: ${files.length} tracked files; ${findings} finding(s). Values redacted.`);
console.log('Scope: current tracked working files only; inspect untracked additions and Git history separately before publishing.');
process.exitCode = findings ? 1 : 0;
