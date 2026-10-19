import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildPlan, imageFromBuild} from '../scripts/build-cloud-run.mjs';

const plan = buildPlan({project: 'example-project', release: 'r-test-1'});

test('build explicitly targets the project, dedicated identity and staging bucket', () => {
  assert.ok(plan.args.includes('example-project'));
  assert.ok(plan.args.includes('projects/example-project/serviceAccounts/kotokoto-biyori-build@example-project.iam.gserviceaccount.com'));
  assert.ok(plan.args.includes('gs://example-project-kotokoto-biyori-builds/source'));
  assert.equal(plan.args.includes('deploy'), false);
});

test('requires a project and rejects unexpected CLI input before calling gcloud', () => {
  assert.throws(() => buildPlan({release: 'r1'}), /project/);
  assert.throws(() => buildPlan({project: 'example-project', release: 'x,OTHER=value'}), /release/);
  assert.throws(() => buildPlan({project: 'example-project', release: 'r1', region: '../other'}), /region/);
});

test('takes the immutable digest only from a successful build for the expected image', () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  assert.equal(imageFromBuild(plan, {status: 'SUCCESS', results: {images: [{name: plan.imageTag, digest}]}}), `${plan.image}@${digest}`);
  assert.throws(() => imageFromBuild(plan, {status: 'FAILURE'}), /did not succeed/);
  assert.throws(() => imageFromBuild(plan, {status: 'SUCCESS', results: {images: [{name: 'other-image', digest}]}}), /ダイジェスト/);
});
