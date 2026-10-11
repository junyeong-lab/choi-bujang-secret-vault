import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deploymentIdentity } from './deployment-identity.mjs';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'public', 'data.json');
const config = JSON.parse(await readFile(resolve(root, 'aleph.config.json'), 'utf8'));
if (!Number.isInteger(config.step) || config.step < 1 || config.step > 12) {
  throw new Error('올바른 단계 번호가 필요합니다.');
}
await mkdir(resolve(root, 'public'), { recursive: true });
if (config.step === 1) {
  const data = JSON.parse(await readFile(resolve(root, 'data.json'), 'utf8'));
  if (!Array.isArray(data.notes)) throw new Error('공개 자료 형식이 잘못되었습니다.');
  // 1단계일 때만 사용합니다.
  await writeFile(output, JSON.stringify(data, null, 2) + '\n');
} else {
  await rm(output, { force: true });
  console.log('2단계 이상: public/data.json을 생성하지 않습니다.');
}
if (!process.argv.includes('--local')) {
  const identity = deploymentIdentity(process.env, config);
  await writeFile(resolve(root, 'public', 'aleph.json'),
    `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
  console.log('배포 저장소·커밋·주소를 public/aleph.json에 기록했습니다.');
}
