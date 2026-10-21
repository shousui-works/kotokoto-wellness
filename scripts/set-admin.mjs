// Local operator command only. Never exposed as an application endpoint.
import {parseArgs} from 'node:util';
import {initializeApp,applicationDefault,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
const {values}=parseArgs({options:{project:{type:'string'},email:{type:'string'},grant:{type:'boolean',default:false}}});
if(values.project!=='kotokoto-biyori'||!values.email)throw Error('Explicit --project=kotokoto-biyori and --email required');
process.env.GOOGLE_CLOUD_QUOTA_PROJECT=values.project;
const app=initializeApp({projectId:values.project,credential:applicationDefault()});
try{const user=await getAuth(app).getUserByEmail(values.email);if(user.disabled||!user.emailVerified||!user.providerData.some(p=>p.providerId==='google.com'))throw Error('A verified active Google account is required');
 if(values.grant){const ref=getFirestore(app,'kotokoto-wellness').collection('adminRoles').doc(user.uid);await ref.set({enabled:true,role:'owner',grantedAt:new Date().toISOString()},{merge:true});}
 console.log(JSON.stringify({verifiedGoogleAccount:true,adminGranted:values.grant,uid:user.uid}));
}finally{await deleteApp(app);}
