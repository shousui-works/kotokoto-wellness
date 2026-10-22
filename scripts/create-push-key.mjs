// Generate only when creating the first version. Never print or write the private key locally.
import {execFileSync} from 'node:child_process';
import webpush from 'web-push';
const project=process.argv[2];
if(project!=='kotokoto-biyori')throw Error('Pass the explicit kotokoto-biyori project');
const secret='kotokoto-biyori-web-push-vapid';
const old=JSON.parse(execFileSync('gcloud',['secrets','versions','list',secret,'--project',project,'--format=json'],{encoding:'utf8'}));
if(old.length)throw Error('A push key version already exists. Reuse it; do not rotate subscriptions accidentally.');
const keys=webpush.generateVAPIDKeys();
const result=JSON.parse(execFileSync('gcloud',['secrets','versions','add',secret,'--project',project,'--data-file=-','--format=json'],{input:JSON.stringify(keys),encoding:'utf8',stdio:['pipe','pipe','pipe']}));
console.log(JSON.stringify({version:result.name,state:result.state}));
