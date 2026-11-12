import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('./multiplayer-client.js',import.meta.url),'utf8');
const hook=readFileSync(new URL('./bot-engine-hook.js',import.meta.url),'utf8');
function harness(id){
 const tasks=[],sent=[];let sock,now=1000;
 class WS{static OPEN=1;static CONNECTING=0;constructor(){sock=this;this.readyState=1;this.listeners={};}addEventListener(k,fn){this.listeners[k]=fn;}send(s){sent.push(JSON.parse(s));}close(){} }
 const game={state:'playing',map:{id:'oasis'},mode:'dm',player:{team:'CT',alive:true,health:100,x:0,y:0,z:0},weapons:{current:'ak47'},hud:{buildAvatars(){}},scene:{remove(){}},allEntities(){return [this.player,...this.botMgr.bots];},displayEntities(){return [...this.allEntities(),...this.botMgr.networkPlayers];},dealDamage(target,amount){target.health-=amount;if(target.health<=0)target.alive=false;},fireBullet(){}};
 game.botMgr={bots:[],networkPlayers:[],addNetworkPlayer(id,p){const b={...p,_networkPlayerId:id,isNetworkPlayer:true};this.networkPlayers.push(b);return b;},removeNetworkPlayer(id){this.networkPlayers=this.networkPlayers.filter(p=>p._networkPlayerId!==id);}};
 class Bot{constructor(g,team,name){this.team=team;this.name=name;this.health=100;this.alive=true;this.weapon='ak47';this.x=this.y=this.z=0;}spawn(){this.alive=true;}}
 const window={game,FREE_SEVER_FRIENDS_ENDPOINT:'wss://test/ws',addEventListener(){},dispatchEvent(){}};
 const ctx=vm.createContext({window,document:{createElement:()=>({style:{}}),body:{appendChild(){}}},location:{search:''},localStorage:{getItem(){return null;},setItem(){}},URLSearchParams,WebSocket:WS,performance:{now:()=>now},setInterval:(fn,ms)=>tasks.push({fn,ms}),setTimeout:()=>1,clearTimeout(){},console,CustomEvent:class{},$h:Bot,hh:[],Tm(){},V:{ak47:{},knife:{}}});
 vm.runInContext(hook,ctx);vm.runInContext(code,ctx);
 const receive=m=>sock.listeners.message({data:JSON.stringify(m)});
 sock.listeners.open();receive({type:'hello',id});
 const tick=()=>{now+=100;for(const t of tasks)if(t.ms<100)t.fn();};tick();
 window.ClutcherMultiplayer.setMatchContext({kind:'multiplayer',room:'room0001',map:'oasis',mode:'dm'});
 return {game,sent,receive,tick,mp:window.ClutcherMultiplayer,disconnect:()=>sock.listeners.close()};
}
const human=(id,team)=>({id,team,name:id,map:'oasis',mode:'dm',state:{alive:true,health:100,x:0,y:0,z:0}});
const bot=(team,i)=>({...human('bot:'+team+':'+i,team),bot:true});
const roster=(hostId,epoch,players)=>({type:'roster',room:'room0001',hostId,epoch,players,count:players.filter(p=>!p.bot).length,limit:4,teamLimit:2,teamCounts:{CT:1,T:0},ready:true});
test('actual client runs AI only on elected host, replaces bots and cleans up',()=>{
 const h=harness('a');h.receive(roster('a',1,[human('a','CT'),bot('CT',0),bot('T',0),bot('T',1)]));h.tick();
 assert.equal(h.game.botMgr.bots.length,3);assert.equal(h.game.botMgr.networkPlayers.length,0);assert.equal(h.sent.findLast(m=>m.type==='bot_state').bots.length,3);
 h.receive(roster('a',1,[human('a','CT'),human('b','T'),bot('CT',0),bot('T',0)]));h.tick();assert.equal(h.game.botMgr.bots.length,2);assert.equal(h.game.botMgr.networkPlayers.length,1);
 const target=h.game.botMgr.networkPlayers[0],attacker=h.game.botMgr.bots.find(b=>b.team==='CT');h.game.dealDamage(target,20,attacker,false,{},'chest');assert.equal(h.sent.at(-1).type,'bot_hit');assert.equal(h.sent.at(-1).botId,attacker._friendsBotId);
 h.receive({type:'bot_damage',epoch:1,targetId:attacker._friendsBotId,fromId:'b',damage:25,weapon:'ak47',region:'chest'});assert.equal(attacker.health,75);
 h.mp.clearMatchContext();assert.equal(h.game.botMgr.bots.length,0);assert.equal(h.game.botMgr.networkPlayers.length,0);
});
test('guest renders replicas, then takes over last bot state on host departure',()=>{
 const h=harness('b'),entry=bot('CT',0);entry.state.x=17;entry.state.health=63;
 h.receive(roster('a',1,[human('a','CT'),human('b','T'),entry,bot('T',0)]));h.tick();assert.equal(h.game.botMgr.bots.length,0);assert.equal(h.game.botMgr.networkPlayers.length,3);
 h.receive(roster('b',2,[human('b','T'),entry,bot('CT',1),bot('T',0)]));h.tick();assert.equal(h.game.botMgr.bots.length,3);assert.equal(h.game.botMgr.networkPlayers.length,0);
 const restored=h.game.botMgr.bots.find(b=>b._friendsBotId===entry.id);assert.equal(restored.x,17);assert.equal(restored.health,63);
 h.disconnect();assert.equal(h.game.botMgr.bots.length,0);
});
