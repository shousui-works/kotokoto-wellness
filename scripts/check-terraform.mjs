import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, readdirSync, copyFileSync, cpSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const binary = process.env.KOTOKOTO_TERRAFORM_BIN || 'terraform';
const options = {
  cwd: ROOT,
  stdio: 'inherit',
  env: {...process.env, TF_INPUT: 'false', CHECKPOINT_DISABLE: '1'},
};

try {
  const version = JSON.parse(execFileSync(binary, ['version', '-json'], {...options, stdio: 'pipe', encoding: 'utf8'})).terraform_version;
  const [major, minor, patch] = version.split('.').map(Number);
  if (major !== 1 || minor < 13 || (minor === 13 && patch < 5)) throw new Error(`Terraform 1.13.5以降の1.xが必要です。現在: ${version}`);
  execFileSync(binary, ['fmt', '-check', '-recursive', 'infra/terraform'], options);
  for (const name of ['bootstrap', 'foundation', 'auth', 'data', 'app']) {
    // Never reuse the real backend metadata or ADC-backed state during offline checks.
    const dataDirectory = mkdtempSync(join(tmpdir(), 'kotokoto-tf-check-'));
    const source = join(ROOT, 'infra/terraform', name);
    const configDirectory = join(dataDirectory, 'config');
    mkdirSync(configDirectory);
    // Exclude real tfvars/backend files and local state, not just backend metadata.
    for (const file of readdirSync(source)) {
      if (file.endsWith('.tf') || file.endsWith('.rules') || file === '.terraform.lock.hcl') {
        copyFileSync(join(source, file), join(configDirectory, file));
      }
    }
    cpSync(join(source, 'tests'), join(configDirectory, 'tests'), {recursive: true});
    const directory = `-chdir=${configDirectory}`;
    const isolated = {...options, env: {...options.env, TF_DATA_DIR: join(dataDirectory, 'providers')}};
    const plugins = process.env.KOTOKOTO_TERRAFORM_PLUGIN_DIR;
    try {
      execFileSync(binary, [directory, 'init', '-backend=false', '-input=false', '-lockfile=readonly', '-no-color', ...(plugins ? [`-plugin-dir=${plugins}`] : [])], isolated);
      execFileSync(binary, [directory, 'validate', '-no-color'], isolated);
      execFileSync(binary, [directory, 'test', '-no-color'], isolated);
    } finally {
      rmSync(dataDirectory, {recursive: true, force: true});
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
