#!/usr/bin/env node
/**
 * 生成 GitHub Actions 签名所需的 Secrets 设置命令。
 *
 * 用法（PowerShell / bash 均可）：
 *   $env:KEYSTORE_PASSWORD="..."; $env:KEY_ALIAS="no_gugu_scholar"; $env:KEY_PASSWORD="..."
 *   node tools/ci-secrets.mjs [keystore 路径]
 *
 * 输出里含有真实密钥材料，只在本机终端看，别贴到聊天/issue 里。
 */
import fs from 'node:fs';
import path from 'node:path';

const ks = process.argv[2] || path.resolve('android/app/happy-course.keystore');
if (!fs.existsSync(ks)) {
  console.error('找不到 keystore：' + ks);
  console.error('先把它放到工程外的私密目录，再把这个路径作为参数传进来。');
  process.exit(1);
}

const b64 = fs.readFileSync(ks).toString('base64');
const pw = process.env.KEYSTORE_PASSWORD || '';
const alias = process.env.KEY_ALIAS || 'no_gugu_scholar';
const keyPw = process.env.KEY_PASSWORD || pw;

if (!pw) {
  console.error('请先设置 KEYSTORE_PASSWORD（仓库密码）环境变量。');
  process.exit(1);
}

console.log('## 1. keystore（base64，单行）');
console.log(b64);
console.log('\n## 2. 用 gh 写入仓库 Secrets（在仓库根目录执行）');
console.log(`printf '%s' '${b64}' | gh secret set ANDROID_KEYSTORE_BASE64`);
console.log(`gh secret set ANDROID_KEYSTORE_PASSWORD --body '${pw}'`);
console.log(`gh secret set ANDROID_KEY_ALIAS --body '${alias}'`);
console.log(`gh secret set ANDROID_KEY_PASSWORD --body '${keyPw}'`);
console.log('\n## 3. 没有 gh CLI 时');
console.log('到 GitHub → Settings → Secrets and variables → Actions 手动新建上面四个 Secret。');
console.log('\n⚠️ 上面的输出包含真实密钥，别复制到聊天记录或公开仓库。');
