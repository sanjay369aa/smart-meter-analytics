import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const blueprintPath = path.resolve(process.cwd(), 'firebase-blueprint.json');
const rulesContent = fs.readFileSync(rulesPath, 'utf-8');
const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf-8'));

test('firestore.rules enforces Pillar 0 default-deny global catch-all', () => {
  assert.match(rulesContent, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
});

test('firestore.rules enforces verified Google Auth on all write operations', () => {
  assert.match(rulesContent, /function isVerified\(\)/);
  assert.match(rulesContent, /request\.auth\.token\.email_verified == true/);
  assert.match(rulesContent, /allow create: if isVerified\(\)/);
  assert.match(rulesContent, /allow update: if isVerified\(\)/);
  assert.match(rulesContent, /allow delete: if isVerified\(\)/);
});

test('firestore.rules enforces strict schema whitelisting and serverTimestamp immutability', () => {
  assert.match(rulesContent, /data\.keys\(\)\.hasAll\(/);
  assert.match(rulesContent, /data\.keys\(\)\.hasOnly\(/);
  assert.match(rulesContent, /incoming\(\)\.createdAt == request\.time/);
  assert.match(rulesContent, /incoming\(\)\.updatedAt == request\.time/);
  assert.match(rulesContent, /incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasOnly\(\['filename', 'updatedAt'\]\)/);
});

test('firestore.rules enforces Master Gate parent ownership and existsAfter/getAfter atomicity on chunks', () => {
  assert.match(rulesContent, /existsAfter\(\/databases\/\$\(database\)\/documents\/datasets\/\$\(datasetId\)\)/);
  assert.match(rulesContent, /getAfter\(\/databases\/\$\(database\)\/documents\/datasets\/\$\(datasetId\)\)\.data\.ownerId == request\.auth\.uid/);
  assert.match(rulesContent, /allow update: if false;/); // immutable chunks
});

test('firestore.rules avoids O(n) get() inside list rules and denies userSettings enumeration', () => {
  const listBlocks = [...rulesContent.matchAll(/allow list:[\s\S]*?;/g)].map((m) => m[0]);
  assert.ok(listBlocks.length >= 3);
  for (const block of listBlocks) {
    assert.equal(block.includes('get('), false, `List rule must not use get(): ${block}`);
  }
  assert.match(rulesContent, /match \/userSettings\/\{userId\}[\s\S]*?allow list: if false;/);
});

test('firebase-blueprint.json matches all collections declared in firestore.rules', () => {
  const declaredPaths = Object.keys(blueprint.firestore);
  assert.deepEqual(declaredPaths.sort(), [
    '/datasets/{datasetId}',
    '/datasets/{datasetId}/chunks/{chunkId}',
    '/userSettings/{userId}',
  ]);
});
