import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

export function buildPlan({project, region = 'asia-northeast1', app = 'kotokoto-biyori', release}) {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project ?? '')) {
    throw new Error('--projectにGCPプロジェクトIDを明示してください。');
  }
  if (!/^[a-z]+-[a-z]+[0-9]+$/.test(region)) throw new Error('Invalid region');
  if (!/^[a-z][a-z0-9-]{1,18}[a-z0-9]$/.test(app)) throw new Error('Invalid app name');
  if (!/^[a-z0-9_][a-z0-9_.-]{0,127}$/.test(release ?? '')) throw new Error('Invalid release tag');

  const image = `${region}-docker.pkg.dev/${project}/${app}/app`;
  const imageTag = `${image}:${release}`;
  return {
    project,
    region,
    image,
    imageTag,
    program: 'gcloud',
    args: [
      'builds', 'submit', '.',
      '--project', project,
      '--region', region,
      '--config', 'cloudbuild.yaml',
      '--service-account', `projects/${project}/serviceAccounts/${app}-build@${project}.iam.gserviceaccount.com`,
      '--gcs-source-staging-dir', `gs://${project}-${app}-builds/source`,
      '--substitutions', `_IMAGE_URI=${image},_RELEASE_TAG=${release}`,
      '--format=json',
      '--suppress-logs',
      '--quiet',
    ],
  };
}

export function imageFromBuild(plan, result) {
  if (result.status !== 'SUCCESS') throw new Error(`Cloud Build did not succeed: ${result.status ?? 'unknown'}`);
  const image = result.results?.images?.find(candidate => candidate.name === plan.imageTag);
  if (!/^sha256:[0-9a-f]{64}$/.test(image?.digest ?? '')) {
    throw new Error('Cloud Buildからイメージのダイジェストを取得できませんでした。');
  }
  return `${plan.image}@${image.digest}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const {values} = parseArgs({
      options: {
        project: {type: 'string'},
        region: {type: 'string'},
        app: {type: 'string'},
        release: {type: 'string'},
        'dry-run': {type: 'boolean', default: false},
      },
    });
    const release = values.release ?? `r${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${randomBytes(3).toString('hex')}`;
    const plan = buildPlan({...values, release});
    if (values['dry-run']) {
      console.log(JSON.stringify(plan, null, 2));
    } else {
      const result = JSON.parse(execFileSync(plan.program, plan.args, {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'inherit'],
      }));
      const image = imageFromBuild(plan, result);
      const outputDirectory = resolve(ROOT, '.gcp-build');
      await mkdir(outputDirectory, {recursive: true});
      const outputFile = resolve(outputDirectory, 'release.auto.tfvars.json');
      await writeFile(outputFile, `${JSON.stringify({container_image: image}, null, 2)}\n`);
      console.log(`Built: ${image}`);
      console.log(`Terraform variable file: ${outputFile}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
