// Cloud Run Job only; no public dispatch endpoint and no OpenAI key.
import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {createPushRuntime} from './push-runtime.mjs';
if(!process.env.GOOGLE_CLOUD_PROJECT||!process.env.FIRESTORE_DATABASE_ID)throw Error('Missing push project/database');
const app=initializeApp({credential:applicationDefault(),projectId:process.env.GOOGLE_CLOUD_PROJECT});
const push=createPushRuntime(getFirestore(app,process.env.FIRESTORE_DATABASE_ID));
console.log(JSON.stringify({event:'push_dispatch',...await push.dispatch()}));
