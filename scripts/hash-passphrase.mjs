// Generate an AUTH_PASSWORD_HASH for the single-user gate.
// Usage: npm run auth:hash -- "your chosen passphrase"
import { randomBytes, scryptSync } from 'node:crypto';

const passphrase = process.argv[2];
if (!passphrase) {
  console.error('Usage: npm run auth:hash -- "your passphrase"');
  process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(passphrase, salt, 64);
console.log(`scrypt:${salt.toString('hex')}:${hash.toString('hex')}`);
