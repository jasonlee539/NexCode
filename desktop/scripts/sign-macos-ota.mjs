import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const publicPath = resolve(root, 'desktop/macos/UpdateSigningPublicKey.txt');
const args = process.argv.slice(2);
if (args[0] === '--init-key') {
  if (!args[1]) throw new Error('Usage: --init-key <private-key-path>');
  const privatePath = resolve(args[1]);
  const pair = generateKeyPairSync('ed25519');
  await mkdir(dirname(privatePath), { recursive: true, mode: 0o700 });
  await writeFile(privatePath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  const raw = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url');
  await writeFile(publicPath, raw.toString('base64') + '\n', { flag: 'wx' });
  console.log('Created macOS OTA key pair. Keep the private key outside version control and back it up securely.');
} else {
  const [archivePath, privatePath, expectedVersion, sourceCommit] = args;
  if (!archivePath || !privatePath || !expectedVersion || !/^[0-9a-f]{40}$/.test(sourceCommit ?? '')) {
    throw new Error('Usage: sign-macos-ota.mjs <archive> <private-key-path> <version> <source-commit>');
  }
  const packageVersion = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
  if (expectedVersion !== packageVersion || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(expectedVersion)) {
    throw new Error('Version must match package.json and be a stable semantic version.');
  }
  if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !== sourceCommit
      || execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim()) {
    throw new Error('Commit all release sources before signing; sourceCommit must equal the clean HEAD.');
  }
  const archive = resolve(archivePath);
  const match = /(?:^|\/)Mac-Ota-Updata-(arm64|x86_64)\.zip$/.exec(archive);
  if (!match) throw new Error('Unexpected macOS OTA archive name.');
  const file = `Mac-Ota-Updata-${match[1]}.zip`;
  const size = (await stat(archive)).size;
  if (size <= 0 || size > 1024 ** 3) throw new Error('Invalid archive size.');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  const sha256 = hash.digest('hex');
  const manifest = Buffer.from(JSON.stringify({ version: expectedVersion, file, size, sha256,
    platform: 'macos', arch: match[1], sourceCommit }) + '\n');
  const packed = name => execFileSync('/usr/bin/unzip', ['-p', archive, `NexCode.app/Contents/${name}`]);
  const plist = packed('Info.plist');
  const packedVersion = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', '-'],
    { input: plist, encoding: 'utf8' }).trim();
  const embeddedKey = Buffer.from((await readFile(publicPath, 'utf8')).trim(), 'base64');
  if (packedVersion !== expectedVersion || packed('Resources/SourceCommit.txt').toString().trim() !== sourceCommit
      || !packed('Resources/UpdateSigningPublicKey.bin').equals(embeddedKey)) {
    throw new Error('Packaged version, source commit or public key does not match the release checkout.');
  }
  // Read the key only after all compiler/package/dependency processes are finished.
  const key = createPrivateKey(await readFile(resolve(privatePath)));
  const publicKey = createPublicKey(key);
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  if (!raw.equals(embeddedKey)) {
    throw new Error('Private signing key does not match the embedded macOS public key.');
  }
  const signature = sign(null, manifest, key);
  if (!verify(null, manifest, publicKey, signature)) throw new Error('Signature self-check failed.');
  const output = archive.slice(0, -4);
  for (const [path, data] of [[archive + '.sha256', `${sha256}  ${file}\n`],
    [output + '.json', manifest], [output + '.sig', signature.toString('base64') + '\n']]) {
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, data, { flag: 'wx' });
    await rename(temporary, path);
  }
  console.log(`Signed macOS ${match[1]} OTA assets for ${expectedVersion}.`);
}
