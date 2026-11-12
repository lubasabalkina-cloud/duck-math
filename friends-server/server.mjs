import {createServer} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {WebSocketServer,WebSocket} from 'ws';

// Private, casual games. This relay does not claim authoritative anti-cheat.
export function createRelay({origins=['https://free-sever.vladimir-usa001.chatgpt.site','https://free-sever.shadyrice.chatgpt.site'],maxClients=128}={}) {
 const rooms=new Map(), clients=new Map();
 const http=createServer((req,res)=>{res.writeHead(req.url==='/health'?200:404,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(req.url==='/health'?{ok:true,protocol:2}:{error:'Not found'}));});
 const wss=new WebSocketServer({noServer:true,maxPayload:8192,perMessageDeflate:false});
 const send=(c,m)=>{if(c.ws.readyState===WebSocket.OPEN&&c.ws.bufferedAmount<65536)c.ws.send(JSON.stringify(m));};
 const members=r=>[...clients.values()].filter(c=>c.room===r.code);
 const syncBots=r=>{
  const humans=members(r),host=humans[0]?.id||'';
  if(host!==r.hostId){r.hostId=host;r.epoch=(r.epoch||0)+1;}
  r.bots||=new Map();
  const keep=new Set();
  if(r.botFill&&humans.length)for(const team of ['CT','T']){
   const count=2-humans.filter(p=>p.team===team).length;
   for(let i=0;i<count;i++){const id='bot:'+team+':'+i;keep.add(id);if(!r.bots.has(id))r.bots.set(id,{id,name:'BOT '+team+' '+(i+1),team,map:r.map,mode:'dm',bot:true,state:null});}
  }
  for(const id of r.bots.keys())if(!keep.has(id))r.bots.delete(id);
 };
 const summary=r=>{syncBots(r);const p=members(r), teamCounts={CT:p.filter(c=>c.team==='CT').length,T:p.filter(c=>c.team==='T').length};return {room:r.code,map:r.map,mode:r.mode,botFill:!!r.botFill,botCount:r.bots.size,hostId:r.hostId,epoch:r.epoch,players:p.length,teamCounts,roomLimit:4,teamLimit:2,ready:r.botFill?p.length>0:teamCounts.CT>0&&teamCounts.T>0};};
 const publicPlayer=c=>({id:c.id,name:c.name,team:c.team,map:rooms.get(c.room)?.map,mode:'dm',state:c.state});
 const broadcast=(r,m,except)=>{for(const c of members(r))if(c!==except)send(c,m);};
 const roster=r=>broadcast(r,{type:'roster',...summary(r),count:members(r).length,limit:4,players:[...members(r).map(publicPlayer),...r.bots.values()]});
 const leave=c=>{const r=rooms.get(c.room);c.room='';c.state=null;if(r){r.touched=Date.now();roster(r);}};
 const clean=s=>String(s||'').replace(/[<>&\u0000-\u001f\u007f]/g,'').trim().slice(0,24)||'Player';
 const finite=(v,min,max)=>Number.isFinite(v)?Math.min(max,Math.max(min,v)):0;
 const error=(c,m,code,message)=>send(c,{type:'error',requestId:m.requestId,code,message,room:m.room});
 function sanitizeState(s,r){const v={};
   for(const k of ['x','y','z'])v[k]=finite(s[k],-2000,2000);
   for(const k of ['vx','vy','vz'])v[k]=finite(s[k],-100,100);
   for(const k of ['yaw','pitch'])v[k]=finite(s[k],-1000,1000);
   for(const k of ['health','armor'])v[k]=finite(s[k],0,100);
   for(const k of ['kills','deaths','assists','hsKills','dmgDealt'])v[k]=Math.round(finite(s[k],0,99999));
   for(const k of ['alive','onGround','crouch'])v[k]=s[k]===true;
   v.weapon=/^[a-z0-9_]{1,24}$/.test(s.weapon)?s.weapon:'knife';v.money=finite(s.money,0,16000);
   v.assistsFor=Array.isArray(s.assistsFor)?s.assistsFor.filter(id=>members(r).some(p=>p.id===id)).slice(0,4):[];
return v;}
 function handle(c,m){
  if(!m||typeof m!=='object')return;
  if(m.type==='create'){
   if(Date.now()-c.createdAt<2000)return error(c,m,'rate_limit','Подождите перед созданием следующей комнаты.');
   if(rooms.size>=128)return error(c,m,'capacity','Сервер заполнен.');
   const code=randomBytes(6).toString('base64url').toLowerCase();
   const r={code,map:m.map==='dusker'?'dusker':'oasis',mode:'dm',botFill:m.botFill===true,bots:new Map(),hostId:'',epoch:0,touched:Date.now()};rooms.set(code,r);c.createdAt=Date.now();
   send(c,{type:'created',requestId:m.requestId,...summary(r)});return;
  }
  if(m.type==='room_status'){
   const codes=Array.isArray(m.rooms)?m.rooms.slice(0,8):[];
   send(c,{type:'room_status',rooms:codes.map(code=>rooms.has(code)?summary(rooms.get(code)):{room:code,exists:false,players:0,teamCounts:{CT:0,T:0},roomLimit:4,teamLimit:2,ready:false})});return;
  }
  if(m.type==='leave'){leave(c);return;}
  if(m.type==='join'){
   const r=rooms.get(m.room);if(!r)return error(c,m,'not_found','Комната не найдена или закрыта.');
   if(m.map!==r.map||m.mode!==r.mode)return error(c,m,'wrong_match','Карта или режим не совпадает с комнатой.');
   if(!['CT','T'].includes(m.team))return error(c,m,'team','Выберите команду.');
   const others=members(r).filter(p=>p!==c);
   if(others.length>=4)return error(c,m,'room_full','Комната заполнена.');
   if(others.filter(p=>p.team===m.team).length>=2)return error(c,m,'team_full','В команде уже два игрока.');
   if(c.room!==r.code)leave(c);
   c.room=r.code;c.team=m.team;c.name=clean(m.name);r.touched=Date.now();
   send(c,{type:'admission',requestId:m.requestId,id:c.id,...summary(r)});
   send(c,{type:'welcome',id:c.id,limit:4,...summary(r)});roster(r);return;
  }
  const r=rooms.get(c.room);if(!r)return;
  if(m.type==='state'&&m.state&&typeof m.state==='object'){
   if(Date.now()-c.stateAt<40)return;c.stateAt=Date.now();const v=sanitizeState(m.state,r);
   c.state=v;broadcast(r,{type:'state',id:c.id,team:c.team,map:r.map,mode:r.mode,state:v},c);return;
  }
  if(m.type==='bot_state'){
   if(c.id!==r.hostId||m.epoch!==r.epoch||!Array.isArray(m.bots))return;
   if(Date.now()-(c.botAt||0)<50)return;c.botAt=Date.now();
   for(const item of m.bots.slice(0,4)){const bot=r.bots.get(item.id);if(!bot||!item.state)continue;bot.state=sanitizeState(item.state,r);broadcast(r,{type:'state',...bot},c);}return;
  }
  if(m.type==='bot_shot'){
   const bot=r.bots.get(m.botId);
   if(c.id!==r.hostId||m.epoch!==r.epoch||!bot?.state?.alive)return;
   const frame={type:'shot',fromId:bot.id,weapon:bot.state.weapon};
   for(const k of ['ox','oy','oz','dx','dy','dz','ex','ey','ez']){if(!Number.isFinite(m[k]))return;frame[k]=finite(m[k],-2000,2000);}
   broadcast(r,frame,c);return;
  }
  if(m.type==='bot_hit'){
   if(c.id!==r.hostId||m.epoch!==r.epoch)return;
   const bot=r.bots.get(m.botId),target=clients.get(m.targetId);
   if(!bot?.state?.alive||!target?.state?.alive||target.room!==c.room||bot.team===target.team)return;
   send(target,{type:'hit',fromId:bot.id,targetId:target.id,damage:Math.round(finite(m.damage,0,200)),region:m.region==='head'?'head':'chest',weapon:bot.state.weapon,scoped:false});return;
  }
  if(m.type==='hit'){
   const bot=r.bots.get(m.targetId);
   if(bot){
    if(!c.state?.alive||!bot.state?.alive||c.team===bot.team)return;
    const frame={type:'bot_damage',epoch:r.epoch,fromId:c.id,targetId:bot.id,damage:Math.round(finite(m.damage,0,200)),region:m.region==='head'?'head':'chest',weapon:/^[a-z0-9_]{1,24}$/.test(m.weapon)?m.weapon:'knife'};
    const host=clients.get(r.hostId);if(host&&frame.damage>0){send(host,frame);send(c,{...frame,type:'hit'});}return;
   }
   const target=clients.get(m.targetId);if(!target||target===c||target.room!==c.room||target.team===c.team)return;
   if(!c.state?.alive||!target.state?.alive)return;
   const frame={type:'hit',fromId:c.id,targetId:target.id,damage:Math.round(finite(m.damage,0,200)),region:m.region==='head'?'head':'chest',weapon:/^[a-z0-9_]{1,24}$/.test(m.weapon)?m.weapon:'knife',scoped:m.scoped===true};
   if(frame.damage>0){send(target,frame);send(c,frame);}return;
  }
  if(m.type==='shot'){
   if(!c.state?.alive)return;const frame={type:'shot',fromId:c.id,weapon:/^[a-z0-9_]{1,24}$/.test(m.weapon)?m.weapon:'knife'};
   for(const k of ['ox','oy','oz','dx','dy','dz','ex','ey','ez']){if(!Number.isFinite(m[k]))return;frame[k]=finite(m[k],-2000,2000);}
   broadcast(r,frame,c);
  }
 }
 http.on('upgrade',(req,socket,head)=>{
  if(req.url!=='/ws'||!origins.includes(req.headers.origin)||clients.size>=maxClients){socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return;}
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
 });
 wss.on('connection',ws=>{
  const c={id:randomUUID(),ws,room:'',name:'Player',team:'',state:null,stateAt:0,createdAt:0,windowAt:Date.now(),count:0,alive:true};clients.set(c.id,c);send(c,{type:'hello',id:c.id});
  ws.on('pong',()=>{c.alive=true;});
  ws.on('message',raw=>{if(Date.now()-c.windowAt>1000){c.windowAt=Date.now();c.count=0;}if(++c.count>80){ws.close(1008,'Rate limit');return;}try{handle(c,JSON.parse(raw));}catch{send(c,{type:'error',code:'invalid',message:'Invalid message'});}});
  ws.on('error',()=>{});ws.on('close',()=>{leave(c);clients.delete(c.id);});
 });
 const timer=setInterval(()=>{
  for(const c of clients.values()){if(!c.alive){c.ws.terminate();continue;}c.alive=false;c.ws.ping();}
  for(const [code,r] of rooms)if(!members(r).length&&Date.now()-r.touched>300000)rooms.delete(code);
 },30000);timer.unref();
 return {http,close:async()=>{clearInterval(timer);for(const c of clients.values())c.ws.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>http.close(resolve));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const app=createRelay({origins:(process.env.ALLOWED_ORIGINS||'https://free-sever.vladimir-usa001.chatgpt.site,https://free-sever.shadyrice.chatgpt.site').split(',')});
 app.http.listen(Number(process.env.PORT)||8787,'0.0.0.0',()=>console.log('FREE SEVER friends relay listening'));
 process.on('SIGTERM',async()=>{await app.close();process.exit(0);});
}
