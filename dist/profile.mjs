export const PROFILE_STORAGE='kotokoto-profile-v1';
export function normalizeNickname(value){
  if(typeof value!=='string')throw Error('呼ばれたい名前を入力してね。');
  const name=value.trim();
  if(Array.from(name).length>20||/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(name))throw Error('名前は改行なしの20文字以内で入力してね。');
  return name;
}
export function loadProfile(storage){
  const raw=storage.getItem(PROFILE_STORAGE);
  if(raw===null)return {version:1,nickname:''};
  try{
    const value=JSON.parse(raw);
    if(value?.version!==1)throw Error('Invalid profile');
    return {version:1,nickname:normalizeNickname(value.nickname),petName:normalizeNickname(value.petName??'こむぎ')||'こむぎ',namesConfigured:value.namesConfigured===true};
  }catch{throw Error('保存した名前を読み込めませんでした。元のデータは上書きしません。');}
}
export function saveProfile(storage,nickname,petName){
  const previous=loadProfile(storage); // Do not overwrite corrupt or newer data silently.
  const profile={...previous,version:1,nickname:normalizeNickname(nickname),petName:normalizeNickname(petName??previous.petName??'こむぎ')||'こむぎ'};
  storage.setItem(PROFILE_STORAGE,JSON.stringify(profile));
  return profile;
}
export const addressCompanionLine=(text,nickname)=>nickname?text.replaceAll('きみ',()=>nickname):text;

export function normalizeNames(nickname,petName){
  const own=normalizeNickname(nickname),dog=normalizeNickname(petName);
  if(!own||!dog)throw Error('自分の呼ばれたい名前と犬の名前を、両方教えてね。');
  return {version:1,nickname:own,petName:dog,namesConfigured:true};
}
// Capture only original interface text, never user messages or saved conversation bodies.
export function createPetNameLabels(root=document){
  const text=[],attrs=[],walker=root.createTreeWalker(root.documentElement,4);
  for(let node;node=walker.nextNode();)if(node.nodeValue.includes('こむぎ')&&!node.parentElement.closest('script,style,textarea'))text.push([node,node.nodeValue]);
  for(const node of root.querySelectorAll('[aria-label],[title],[placeholder],[alt]'))for(const key of ['aria-label','title','placeholder','alt']){const value=node.getAttribute(key);if(value?.includes('こむぎ'))attrs.push([node,key,value]);}
  return name=>{for(const [node,value]of text)if(node.isConnected)node.nodeValue=value.replaceAll('こむぎ',()=>name);for(const [node,key,value]of attrs)if(node.isConnected)node.setAttribute(key,value.replaceAll('こむぎ',()=>name));};
}
