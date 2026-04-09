#!/usr/bin/env node
/**
 * jama DB encryption migration
 * ─────────────────────────────────────────────────────────────────────────────
 * Converts an existing plain SQLite database to SQLCipher (AES-256 encrypted).
 *
 * Run ONCE before upgrading to a jama version that includes DB_KEY support.
 * The container must be STOPPED before running this script.
 *
 * Usage (run on the Docker host, not inside the container):
 *
 *   node encrypt-db.js --db /path/to/jama.db --key YOUR_DB_KEY
 *
 * Or using env vars:
 *
 *   DB_PATH=/path/to/jama.db DB_KEY=yourkey node encrypt-db.js
 *
 * To find your Docker volume path:
 *   docker volume inspect jama_jama_db
 *   (look for the "Mountpoint" field)
 *
 * The script will:
 *   1. Verify the source file is a plain (unencrypted) SQLite database
 *   2. Create an encrypted copy at <original>.encrypted
 *   3. Back up the original to <original>.plaintext-backup
 *   4. Move the encrypted copy into place as <original>
 *
 * If anything goes wrong, restore with:
 *   cp jama.db.plaintext-backup jama.db
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// Parse CLI args --db and --key
const args = process.argv.slice(2);
const argDb  = args[args.indexOf('--db')  + 1];
const argKey = args[args.indexOf('--key') + 1];

const DB_PATH = argDb  || process.env.DB_PATH || '/app/data/jama.db';
const DB_KEY  = argKey || process.env.DB_KEY  || '';

// ── Validation ────────────────────────────────────────────────────────────────

if (!DB_KEY) {
  console.error('ERROR: No DB_KEY provided.');
  console.error('Usage: node encrypt-db.js --db /path/to/jama.db --key YOUR_KEY');
  console.error('   or: DB_KEY=yourkey node encrypt-db.js');
  process.exit(1);
}

if (!fs.existsSync(DB_PATH)) {
  console.error(`ERROR: Database file not found: ${DB_PATH}`);
  process.exit(1);
}

// Check it looks like a plain SQLite file (magic bytes: "SQLite format 3\000")
const MAGIC = 'SQLite format 3\0';
const fd = fs.openSync(DB_PATH, 'r');
const header = Buffer.alloc(16);
fs.readSync(fd, header, 0, 16, 0);
fs.closeSync(fd);

if (header.toString('ascii') !== MAGIC) {
  console.error('ERROR: The database does not appear to be a plain (unencrypted) SQLite file.');
  console.error('It may already be encrypted, or the path is wrong.');
  process.exit(1);
}

// ── Migration ─────────────────────────────────────────────────────────────────

let Database;
try {
  Database = require('better-sqlite3-multiple-ciphers');
} catch (e) {
  console.error('ERROR: better-sqlite3-sqlcipher is not installed.');
  console.error('Run: npm install better-sqlite3-sqlcipher');
  process.exit(1);
}

const encPath    = DB_PATH + '.encrypted';
const backupPath = DB_PATH + '.plaintext-backup';

console.log(`\njama DB encryption migration`);
console.log(`────────────────────────────`);
console.log(`Source:  ${DB_PATH}`);
console.log(`Backup:  ${backupPath}`);
console.log(`Output:  ${DB_PATH} (encrypted)\n`);

try {
  // Open the plain DB (no key)
  console.log('Step 1/4  Opening plain database...');
  const plain = new Database(DB_PATH);

  // Create encrypted copy using sqlcipher_export via ATTACH
  console.log('Step 2/4  Encrypting to temporary file...');
  const safeKey = DB_KEY.replace(/'/g, "''");
  plain.exec(`ATTACH DATABASE '${encPath}' AS encrypted KEY '${safeKey}'`);
  plain.exec(`SELECT sqlcipher_export('encrypted')`);
  plain.exec(`DETACH DATABASE encrypted`);
  plain.close();

  // Verify the encrypted file opens correctly with cipher settings
  console.log('Step 3/4  Verifying encrypted database...');
  const enc = new Database(encPath);
  enc.pragma(`cipher='sqlcipher'`);
  enc.pragma(`legacy=4`);
  enc.pragma(`key='${safeKey}'`);
  const count = enc.prepare("SELECT COUNT(*) as n FROM sqlite_master").get();
  enc.close();
  console.log(`          OK — ${count.n} objects found in encrypted DB`);

  // Swap files: backup plain, move encrypted into place
  console.log('Step 4/4  Swapping files...');
  fs.renameSync(DB_PATH, backupPath);
  fs.renameSync(encPath, DB_PATH);

  console.log(`\n✓ Migration complete!`);
  console.log(`  Encrypted DB: ${DB_PATH}`);
  console.log(`  Plain backup: ${backupPath}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Set DB_KEY=${DB_KEY} in your .env file`);
  console.log(`  2. Start jama — it will open the encrypted database`);
  console.log(`  3. Once confirmed working, delete the plain backup:`);
  console.log(`     rm ${backupPath}\n`);

} catch (err) {
  console.error(`\n✗ Migration failed: ${err.message}`);
  // Clean up any partial encrypted file
  if (fs.existsSync(encPath)) fs.unlinkSync(encPath);
  console.error('No changes were made to the original database.');
  process.exit(1);
}
