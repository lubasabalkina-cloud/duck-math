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
 join(d,room,'CT','d');await d.next(m=>m.type==='admission');join(c,room,'CT','full');assert.equal((await c.next(m=>m.type==='error')).code,'team_full');
 join(c,room,'T','c2');await c.next(m=>m.type==='admission');
 b.send({type:'leave'});const after=await a.next(m=>m.type==='roster'&&m.count===3&&!m.players.some(p=>p.id===bid));assert.equal(after.players.some(p=>p.id===bid),false);
 }finally{await relay.close();}
});
test('unknown room, malformed input and wrong origin are rejected',async()=>{
 const relay=createRelay();await new Promise(r=>relay.http.listen(0,'127.0.0.1',r));const url=`ws://127.0.0.1:${relay.http.address().port}/ws`;
 try{const a=await client(url);a.send({type:'join',room:'missing',team:'CT',map:'oasis',mode:'dm'});assert.equal((await a.next(m=>m.type==='error')).code,'not_found');a.ws.send('{');assert.equal((await a.next(m=>m.type==='error')).code,'invalid');
 await new Promise((resolve,reject)=>{const ws=new WebSocket(url,{origin:'https://unrelated.example'});ws.on('open',()=>{ws.terminate();reject(Error('Bad origin accepted'));});ws.on('error',e=>{assert.match(e.message,/403/);resolve();});});
 }finally{await relay.close();}
});
