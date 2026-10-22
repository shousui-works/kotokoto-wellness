import webpush from 'web-push';
import {createPushService,FirestorePushStore} from './push.mjs';
export function createPushRuntime(db,env=process.env){
  if(!env.WEB_PUSH_VAPID)return createPushService({store:new FirestorePushStore(db)});
  let keys;try{keys=JSON.parse(env.WEB_PUSH_VAPID);}catch{throw Error('Invalid push configuration');}
  if(!keys?.publicKey||!keys.privateKey||!env.WEB_PUSH_SUBJECT)throw Error('Invalid push configuration');
  return createPushService({store:new FirestorePushStore(db),publicKey:keys.publicKey,send:(subscription,payload,options={})=>webpush.sendNotification(subscription,payload,{vapidDetails:{subject:env.WEB_PUSH_SUBJECT,publicKey:keys.publicKey,privateKey:keys.privateKey},TTL:options.TTL??3600,urgency:'normal',timeout:10000})});
}
