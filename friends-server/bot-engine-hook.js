// Appended inside the game's ESM scope: reuses original AI, models and damage.
window.FreeSeverBots = {
 create(game,entry){
  const bot=new $h(game,entry.team,entry.name,1);
  bot._friendsBotId=entry.id;
  game.botMgr.bots.push(bot);bot.spawn();
  if(entry.state){const s=entry.state;for(const k of ['x','y','z','vx','vy','vz','yaw','pitch','health','armor','alive','onGround','weapon','kills','deaths','assists'])if(s[k]!==undefined)bot[k]=s[k];if(!bot.alive)bot.respawnT=3.5;}
  return bot;
 },
 remove(game,bot){
  const i=game.botMgr.bots.indexOf(bot);if(i>=0)game.botMgr.bots.splice(i,1);
  for(let j=hh.length-1;j>=0;j--)if(hh[j].bot===bot)hh.splice(j,1);
  bot._networkRemoved=true;game.scene.remove(bot.mesh);game.scene.remove(bot.shadow);
  if(bot.cs2Agent){game.scene.remove(bot.cs2Agent.root);Tm(bot.team,bot.cs2Agent);bot.cs2Agent=null;}
 },
 damage(game,bot,message){const attacker=game.botMgr.networkPlayers.find(p=>p._networkPlayerId===message.fromId)||null;game.dealDamage(bot,message.damage,attacker,message.region==='head',V[message.weapon]||V.knife,message.region);},
 install(game,mp){
  if(game._friendsBotHooks)return;game._friendsBotHooks=true;
  const damage=game.dealDamage;
  game.dealDamage=function(target,amount,attacker,head,weapon,region,...rest){
   if(mp.multiplayerActive&&attacker?._friendsBotId&&target.isNetworkPlayer){
    mp.send({type:'bot_hit',epoch:mp.botEpoch,botId:attacker._friendsBotId,targetId:target._networkPlayerId,damage:amount,region:head?'head':region,weapon:attacker.weapon});return;
   }
   return damage.call(this,target,amount,attacker,head,weapon,region,...rest);
  };
  const fire=game.fireBullet;
  game.fireBullet=function(shooter,x,y,z,dx,dy,dz,weapon){
   const result=fire.apply(this,arguments);
   if(mp.multiplayerActive&&shooter._friendsBotId&&performance.now()-(shooter._friendsShotAt||0)>200){
    shooter._friendsShotAt=performance.now();
    mp.send({type:'bot_shot',epoch:mp.botEpoch,botId:shooter._friendsBotId,ox:x,oy:y,oz:z,dx,dy,dz,ex:x+dx*40,ey:y+dy*40,ez:z+dz*40});
   }
   return result;
  };
  const all=game.allEntities;
  game.allEntities=function(){const list=all.call(this);return mp.multiplayerActive?[...list,...this.botMgr.networkPlayers]:list;};
  const display=game.displayEntities;
  game.displayEntities=function(){return mp.multiplayerActive?this.allEntities():display.call(this);};
 }
};
