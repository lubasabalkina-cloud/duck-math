import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,existsSync} from 'node:fs';
const mainURL=new URL('../../dist/games/clutcher/src-decompiled/main.js',import.meta.url);
test('real game controller: synchronized rounds, money, bomb, no local round transitions',{skip:!existsSync(mainURL)},()=>{
 const main=readFileSync(mainURL,'utf8'),base=main.slice(main.indexOf('H_=class'),main.indexOf('},U_=',main.indexOf('H_=class'))+1);
 const noop=()=>{};class Weapons{constructor(){this.slots={};this.states={};}give(id){this.slots[2]=id;this.states[id]={ammo:20,reserve:120};}redeploy(){}equip(id){this.current=id;}}
 const player={team:'T',isPlayer:true,alive:true,money:16000,spawnAt(p){Object.assign(this,p,{alive:true,health:100});}};
 const game={player,scene:{add:noop,remove:noop},map:{spawnsT:[{x:1,y:0,z:1}],spawnsCT:[{x:2,y:0,z:2}],bombsites:[{name:'A',cx:5,cz:5,boxes:[[0,-2,0,10,4,10]]}]},weapons:new Weapons(),botMgr:{bots:[],networkPlayers:[]},allEntities(){return [player];},hittableEntities(){return [player];},hud:new Proxy({},{get:()=>noop}),audio:{play:noop},effects:{},physics:{groundHeight:()=>0},viewmodel:{},clearDrops:noop,grenadeMgr:{reset:noop},_clearDeathCam:noop};
 const mp={selfId:'t',matchRoom:'r',connected:true,isHost:false,send:noop};const ctx=vm.createContext({window:{ClutcherMultiplayer:mp,FreeSeverBots:{install:noop}},performance:{now:()=>2000},X:{maxRounds:25,halftime:false},Rg:115,Pg:15,Jm:()=> 'glock',V:{glock:{mag:20,reserve:120},c4:{mag:Infinity,reserve:0}},B_:()=>({position:{set:noop}}),console,Math});
 vm.runInContext('var '+base+';\n'+readFileSync(new URL('./defusal-engine-hook.js',import.meta.url),'utf8')+'\nthis.Mode=FreeSeverDefusal;',ctx);
 const ctl=new ctx.Mode(game);game.modeCtl=ctl;ctl.startMatch();assert.equal(player.money,800);assert.equal(game.respawnAllowed,false);
 mp.roundState={room:'r',round:1,phase:'freeze',clock:15,score:{CT:0,T:0},carrier:'t',people:[{id:'t',alive:true}],progress:0,defuseProgress:0};ctl.update(.1);assert.equal(ctl.roundNum,1);assert.equal(game.weapons.slots[5],'c4');assert.equal(player.money,800);assert.equal(ctl.canBuy(),true);
 mp.roundState={...mp.roundState,phase:'live',clock:114};ctl.update(.1);assert.equal(game.frozen,false);assert.equal(ctl.displayClock(),114);
 ctl.onKill(player);ctl.roundEnd('CT','fake');assert.equal(ctl.state,'live');assert.equal(ctl.score.CT,0);
 mp.roundState={...mp.roundState,phase:'end',clock:5,score:{CT:1,T:0},carrier:null,rewards:{CT:3250,T:1400},winner:'CT',reason:'Time ran out'};ctl.update(.1);ctl.update(.1);assert.equal(player.money,2200);assert.equal(game.respawnAllowed,false);assert.equal(ctl.canBuy(),false);
 mp.roundState={...mp.roundState,round:2,phase:'freeze',clock:15,carrier:'t'};ctl.update(.1);assert.equal(player.money,2200);assert.equal(ctl.roundNum,2);
 const start=main.indexOf('tryBuy(e7,t2={})'),end=main.indexOf('_throwPurchase(',start+25); // first mention is inside function; select next method boundary instead
 const method=main.slice(start,main.indexOf('}_throwPurchase(',start)+1);
 ctx.Zm=()=>true;ctx.Mo={};ctx.V={awp:{price:4750},ak47:{price:2700}};const buyer=vm.runInContext('({'+method+'})',ctx);let denied=0;const fake={player:{team:'T',money:800,alive:true},modeCtl:{buyTimeOk:()=>true,inBuyZone:()=>true},_buyLogRoll:noop,deny(){denied++;}};
 buyer.tryBuy.call(fake,'awp');buyer.tryBuy.call(fake,'ak47');assert.equal(denied,2);assert.equal(fake.player.money,800);
});
