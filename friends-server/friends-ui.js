export function installFriendsUI(game,endpoint,clientScript,options={}) {
 if(!/^wss:\/\//.test(endpoint))throw Error('Нужен опубликованный сервер WSS.');
 const panel=document.createElement('dialog');
 panel.innerHTML='<form method="dialog"><button aria-label="Закрыть" style="float:right">×</button></form><h2>Играть с друзьями</h2><p>Командный бой: до четырёх игроков, по двое в команде.</p><label>Карта <select><option value="oasis">Oasis</option><option value="dusker">Dune</option></select></label><p><label><input data-bots type="checkbox" checked> Заполнить свободные места ботами</label></p><p><button data-create>Создать комнату</button></p><label>Код комнаты <input maxlength="8" autocomplete="off" spellcheck="false"></label><button data-join>Найти комнату</button><section hidden data-room><p>Код для друга: <strong data-code></strong></p><button data-copy>Скопировать код</button><button data-enter>Войти в матч</button><p>Выберите разные команды, чтобы играть друг против друга.</p></section><p role="status" aria-live="polite"></p>';
 panel.style.cssText='background:#171d29;color:white;border:1px solid #f88d32;border-radius:16px;padding:24px;max-width:90vw;max-height:90dvh;overflow:auto;font:16px/1.5 system-ui';
 document.body.append(panel);
 const launch=document.createElement('button');launch.textContent='С друзьями';launch.onclick=()=>{document.exitPointerLock?.();if(!panel.open)panel.showModal();};
 (document.querySelector('#free-sever-controls')||document.body).append(launch);
 const status=panel.querySelector('[role=status]'),input=panel.querySelector('input[maxlength]');
 let busy=false,loaded,selectedRoom;
 function showRoom(r){selectedRoom=r;input.value=r.room;panel.querySelector("[data-room]").hidden=false;panel.querySelector("[data-code]").textContent=r.room;status.textContent="Комната готова · игроков: "+r.players+"/4"+(r.botFill?" · свободные места займут боты":" · только друзья");}
 const request=message=>new Promise((resolve,reject)=>{
  let settled=false;const ws=new WebSocket(endpoint),timer=setTimeout(()=>{ws.close();reject(Error('Сервер не ответил. Попробуйте через минуту.'));},70000);
  const done=(value,error)=>{if(settled)return;settled=true;clearTimeout(timer);ws.close();error?reject(error):resolve(value);};
  ws.onclose=()=>{if(!settled)done(null,Error("Соединение закрыто. Повторите попытку."));};
  ws.onopen=()=>ws.send(JSON.stringify(message));
  ws.onerror=()=>done(null,Error('Не удалось подключиться к серверу.'));
  ws.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch{return;}
   if(m.type==='error')done(null,Error(m.message));
   if(m.type==='created')done(m);
   if(m.type==='room_status'){const r=m.rooms?.[0];r&&r.exists!==false?done(r):done(null,Error('Комната не найдена или уже закрыта.'));}
  };
 });
 async function load(){
  if(!loaded){window.FREE_SEVER_FRIENDS_ENDPOINT=endpoint;loaded=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=clientScript;s.onload=resolve;s.onerror=()=>reject(Error('Не загрузился сетевой модуль.'));document.head.append(s);});}
  await loaded;
  await new Promise((resolve,reject)=>{const start=Date.now(),timer=setInterval(()=>{if(window.ClutcherMultiplayer?.connected){clearInterval(timer);resolve();}else if(Date.now()-start>70000){clearInterval(timer);reject(Error('Сервер недоступен.'));}},100);});
 }
 async function enter(r){
  if(options.navigateRoom){options.navigateRoom(r);return;}
  if(game.state==="playing"||game._starting)throw Error("Сначала выйдите из матча в меню.");
  await load();const mp=window.ClutcherMultiplayer;mp.setRoom(r.room);mp.watchRooms([r.room]);
  // startGame resets match context synchronously; set it after that reset and
  // before the asynchronous map load reaches team selection.
  const loading=game.startGame(r.map,0,1,'dm');
  mp.setMatchContext({kind:'multiplayer',room:r.room,map:r.map,mode:'dm'});
  panel.close();await loading;
 }
 async function run(fn){if(busy)return;busy=true;status.textContent='Подключение…';try{await fn();}catch(e){status.textContent=e.message;if(!panel.open)panel.showModal();}finally{busy=false;}}
 panel.querySelector('[data-create]').onclick=()=>run(async()=>showRoom(await request({type:'create',map:panel.querySelector('select').value,botFill:panel.querySelector('[data-bots]').checked})));
 panel.querySelector('[data-join]').onclick=()=>run(async()=>{const code=input.value.trim().toLowerCase();if(!/^[a-z0-9_-]{8}$/.test(code))throw Error('Введите код из восьми символов.');showRoom(await request({type:'room_status',rooms:[code]}));});
 panel.querySelector('[data-copy]').onclick=async()=>{if(!selectedRoom)return;try{await navigator.clipboard.writeText(selectedRoom.room);status.textContent='Код скопирован — отправь его другу.';}catch{input.focus();input.select();status.textContent='Скопируйте выделенный код.';}};
 panel.querySelector('[data-enter]').onclick=()=>run(async()=>{if(selectedRoom)await enter(await request({type:'room_status',rooms:[selectedRoom.room]}));});
 if(game){const toMenu=game.toMenu;game.toMenu=function(...args){window.ClutcherMultiplayer?.clearMatchContext();return toMenu.apply(this,args);};}
 const initial=new URLSearchParams(location.search).get('friendRoom');
 if(initial&&/^[a-z0-9_-]{8}$/.test(initial)){input.value=initial;panel.showModal();panel.querySelector('[data-join]').click();}
 return {panel,launch};
}
