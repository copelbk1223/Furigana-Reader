#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const pkgPath = path.join(rootDir, 'package.json');
const gradlePath = path.join(rootDir, 'android', 'app', 'build.gradle');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const currentVersion = pkg.version || '1.0.0';

const arg = process.argv[2] || 'patch';

let newVersion = '';
if (/^\d+\.\d+\.\d+/.test(arg)) {
  newVersion = arg.replace(/^v/, '');
} else {
  const parts = currentVersion.split('.').map(n => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);

  if (arg === 'major') {
    parts[0] += 1;
    parts[1] = 0;
    parts[2] = 0;
  } else if (arg === 'minor') {
    parts[1] += 1;
    parts[2] = 0;
  } else {
    // default: patch
    parts[2] += 1;
  }
  newVersion = parts.join('.');
}

console.log(`Bumping version: ${currentVersion} -> ${newVersion}`);

// 1. Update package.json
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`✓ Updated package.json version to ${newVersion}`);

// 2. Update build.gradle
if (fs.existsSync(gradlePath)) {
  let gradleContent = fs.readFileSync(gradlePath, 'utf8');
  gradleContent = gradleContent.replace(/versionCode\s+(\d+)/, (match, code) => {
    const nextCode = parseInt(code, 10) + 1;
    console.log(`✓ Updated build.gradle versionCode: ${code} -> ${nextCode}`);
    return `versionCode ${nextCode}`;
  });
  gradleContent = gradleContent.replace(/versionName\s+["'][^"']+["']/, (match) => {
    console.log(`✓ Updated build.gradle versionName to "${newVersion}"`);
    return `versionName "${newVersion}"`;
  });
  fs.writeFileSync(gradlePath, gradleContent, 'utf8');
}

console.log(`\n🎉 Successfully bumped to v${newVersion}!`);
console.log(`\nCommands to commit and push release:`);
console.log(`  git add .`);
console.log(`  git commit -m "chore(release): v${newVersion}"`);
console.log(`  git tag v${newVersion}`);
console.log(`  git push origin main --tags`);
