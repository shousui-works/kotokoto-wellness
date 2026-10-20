// Notifications only: do not cache application files or intercept account/API requests.
self.addEventListener('push',event=>{
  let data={};try{data=event.data?.json()??{};}catch{}
  const text=(value,fallback,max)=>typeof value==='string'?value.slice(0,max):fallback;
  event.waitUntil(self.registration.showNotification(text(data.title,'こつこつ日和',60),{
    body:text(data.body,'おへやで待ってるよ。🐾',160),icon:'/icons/app-192.png',badge:'/icons/app-192.png',
    tag:text(data.tag,'kotokoto-message',80),data:{url:'/#room'},
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const url=new URL('/#room',self.location.origin).href;
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=windows.find(client=>new URL(client.url).origin===self.location.origin);
    if(existing){await existing.navigate(url);await existing.focus();}else await self.clients.openWindow(url);
  })());
});
