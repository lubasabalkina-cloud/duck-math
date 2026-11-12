import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {createRelay} from './server.mjs';
const origin='https://free-sever.vladimir-usa001.chatgpt.site';
function client(url){return new Promise((resolve,reject)=>{const ws=new WebSocket(url,{origin}), inbox=[],waiters=[];ws.on('error',reject);ws.on('message',data=>{const m=JSON.parse(data);const i=waiters.findIndex(x=>x.filter(m));if(i>=0){const w=waiters.splice(i,1)[0];clearTimeout(w.timer);w.resolve(m);}else inbox.push(m);});const c={ws,inbox,send:m=>ws.send(JSON.stringify(m)),next:filter=>{const i=inbox.findIndex(filter);if(i>=0)return Promise.resolve(inbox.splice(i,1)[0]);return new Promise((resolve,reject)=>{const w={filter,resolve,timer:setTimeout(()=>reject(Error('Message timeout')),2000)};waiters.push(w);});}};ws.once('open',()=>resolve(c));});}
test('two real WebSocket clients: invitation, roster, movement, damage, room isolation, limits, leave',async()=>{
 const relay=createRelay();await new Promise(r=>relay.http.listen(0,'127.0.0.1',r));const url=`ws://127.0.0.1:${relay.http.address().port}/ws`;
 try{
 const a=await client(url),b=await client(url),c=await client(url),d=await client(url);
 const aid=(await a.next(m=>m.type==='hello')).id,bid=(await b.next(m=>m.type==='hello')).id;
 a.send({type:'create',map:'oasis'});const room=(await a.next(m=>m.type==='created')).room;assert.match(room,/^[a-z0-9_-]{8}$/);
 const join=(p,code,team,requestId)=>p.send({type:'join',room:code,map:'oasis',mode:'dm',team,name:'Friend',requestId});
 join(a,room,'CT','a');assert.equal((await a.next(m=>m.type==='admission')).requestId,'a');
 join(b,room,'T','b');assert.equal((await b.next(m=>m.type==='admission')).ready,true);
 const roster=await a.next(m=>m.type==='roster'&&m.count===2);assert.equal(roster.players.length,2);
 a.send({type:'state',id:'forged',state:{x:12,y:2,z:3,alive:true,health:100,weapon:'ak47'}});
 const state=await b.next(m=>m.type==='state');assert.equal(state.id,aid);assert.equal(state.state.x,12);
 b.send({type:'state',state:{x:15,y:2,z:3,alive:true,health:100,weapon:'ak47'}});await a.next(m=>m.type==='state');
 a.send({type:'hit',fromId:'forged',targetId:bid,damage:24,region:'head',weapon:'ak47'});
 const hit=await b.next(m=>m.type==='hit');assert.equal(hit.fromId,aid);assert.equal(hit.damage,24);
 c.send({type:'create',map:'oasis'});const other=(await c.next(m=>m.type==='created')).room;join(c,other,'CT','c');await c.next(m=>m.type==='admission');
 c.send({type:'state',state:{alive:true,health:100}});c.send({type:'hit',targetId:bid,damage:100});
 // A status request is a processing barrier for all of C's earlier frames.
 c.send({type:'room_status',rooms:[other]});await c.next(m=>m.type==='room_status');
 assert.equal(b.inbox.some(m=>m.type==='hit'),false);
 join(d,room,'CT','d');await d.next(m=>m.type==='admission');for(let i=0;i<3;i++){const extra=await client(url);join(extra,room,'CT','extra'+i);await extra.next(m=>m.type==='admission');}join(c,room,'CT','full');assert.equal((await c.next(m=>m.type==='error')).code,'team_full');
 join(c,room,'T','c2');await c.next(m=>m.type==='admission');
 b.send({type:'leave'});const after=await a.next(m=>m.type==='roster'&&m.count===6&&!m.players.some(p=>p.id===bid));assert.equal(after.players.some(p=>p.id===bid),false);
 }finally{await relay.close();}
});
test('unknown room, malformed input and wrong origin are rejected',async()=>{
 const relay=createRelay();await new Promise(r=>relay.http.listen(0,'127.0.0.1',r));const url=`ws://127.0.0.1:${relay.http.address().port}/ws`;
 try{const a=await client(url);a.send({type:'join',room:'missing',team:'CT',map:'oasis',mode:'dm'});assert.equal((await a.next(m=>m.type==='error')).code,'not_found');a.ws.send('{');assert.equal((await a.next(m=>m.type==='error')).code,'invalid');
 await new Promise((resolve,reject)=>{const ws=new WebSocket(url,{origin:'https://unrelated.example'});ws.on('open',()=>{ws.terminate();reject(Error('Bad origin accepted'));});ws.on('error',e=>{assert.match(e.message,/403/);resolve();});});
 }finally{await relay.close();}
});
test('shared bots fill vacant team slots, route damage and transfer authority',async()=>{
 const relay=createRelay();await new Promise(r=>relay.http.listen(0,'127.0.0.1',r));const url=`ws://127.0.0.1:${relay.http.address().port}/ws`;
 try{
  const a=await client(url),b=await client(url),c=await client(url),d=await client(url);
  const aid=(await a.next(m=>m.type==='hello')).id,bid=(await b.next(m=>m.type==='hello')).id;
  a.send({type:'create',map:'oasis',botFill:true});const room=(await a.next(m=>m.type==='created')).room;
  const join=(p,team)=>p.send({type:'join',room,map:'oasis',mode:'dm',team});
  join(a,'CT');const solo=await a.next(m=>m.type==='roster'&&m.count===1);
  assert.equal(solo.botCount,9);assert.equal(solo.players.length,10);assert.equal(solo.hostId,aid);assert.equal(solo.ready,true);
  join(b,'T');const duo=await a.next(m=>m.type==='roster'&&m.count===2);
  assert.equal(duo.botCount,8);assert.equal(duo.players.filter(p=>p.team==='CT').length,5);
  const bot=duo.players.find(p=>p.bot&&p.team==='CT');
  a.send({type:'state',state:{alive:true,health:100}});await b.next(m=>m.type==='state'&&m.id===aid);
  b.send({type:'state',state:{alive:true,health:100}});await a.next(m=>m.type==='state'&&m.id===bid);
  a.send({type:'bot_state',epoch:duo.epoch,bots:[{id:bot.id,state:{x:10,alive:true,health:100,weapon:'ak47'}}]});
  const snap=await b.next(m=>m.type==='state'&&m.id===bot.id);assert.equal(snap.state.x,10);
  b.send({type:'hit',targetId:bot.id,damage:25,weapon:'ak47'});
  assert.equal((await a.next(m=>m.type==='bot_damage')).fromId,bid);
  a.send({type:'bot_hit',epoch:duo.epoch,botId:bot.id,targetId:bid,damage:20});
  assert.equal((await b.next(m=>m.type==='hit'&&m.fromId===bot.id)).damage,20);
  b.send({type:'bot_state',epoch:duo.epoch,bots:[{id:bot.id,state:{x:999,alive:true,health:100}}]});
  b.send({type:'room_status',rooms:[room]});await b.next(m=>m.type==='room_status');
  assert.equal(a.inbox.some(m=>m.type==='state'&&m.id===bot.id),false);
  join(c,'CT');const trio=await a.next(m=>m.type==='roster'&&m.count===3);assert.equal(trio.botCount,7);
  join(d,'T');await d.next(m=>m.type==='admission');for(let i=0;i<6;i++){const extra=await client(url);join(extra,i%2===0?'CT':'T');await extra.next(m=>m.type==='admission');}const full=await a.next(m=>m.type==='roster'&&m.count===10);assert.equal(full.botCount,0);assert.equal(full.players.length,10);const overflow=await client(url);join(overflow,'CT');assert.equal((await overflow.next(m=>m.type==='error')).code,'room_full');
  a.send({type:'leave'});const migrated=await b.next(m=>m.type==='roster'&&m.count===9&&m.hostId===bid);
  assert.equal(migrated.botCount,1);assert.ok(migrated.epoch>duo.epoch);
  const fresh=migrated.players.find(p=>p.bot);
  b.send({type:'bot_state',epoch:migrated.epoch,bots:[{id:fresh.id,state:{alive:true,health:100,x:42}}]});
  assert.equal((await c.next(m=>m.type==='state'&&m.id===fresh.id)).state.x,42);
 }finally{await relay.close();}
});
