// Network bomb mode: reuse existing movement, weapons, bot objectives and HUD;
// only the relay decides round transitions, bomb ownership and objectives.
class FreeSeverDefusal extends H_ {
 constructor(game){super(game);this._networkRound=0;this._rewardRound=0;this._first=true;this._lastConfig=0;this.state='freeze';this.freezeT=15;this.hasHalftime=false;this.maxRounds=25;this.modeName='Закладка бомбы 5v5';}
 startMatch(){const g=this.game;window.FreeSeverBots.install(g,window.ClutcherMultiplayer);g.player.money=800;g.player.armor=0;g.player.helmet=false;this.playerKit=false;g.respawnAllowed=false;g.frozen=true;this.attackSite=g.map.bombsites[0];g.hud.announce('Ожидание игроков и загрузки карты…',3000);}
 nextRound(){} // The relay owns all transitions.
 onKill(){}
 roundEnd(){}
 halftime(){}
 _safeNextRound(){}
 dropBomb(entity){if(entity===this.game.player&&this.carrier===entity){window.ClutcherMultiplayer.send({type:'bomb_drop'});return true;}return false;}
 buyTimeOk(){return this._networkRound>0&&(this.state==='freeze'||this.state==='live'&&this.roundClock>95);}
 buyTimeLeft(){return this.state==='freeze'?this.freezeT+20:this.state==='live'?Math.max(0,this.roundClock-95):0;}
 botBuy(bot,previous){const result=super.botBuy(bot,previous);result.armor=false;result.helmet=false;bot.hasKit=false;return result;}
 entity(id){const mp=window.ClutcherMultiplayer;if(id===mp.selfId)return this.game.player;return this.game.hittableEntities().find(e=>e._friendsBotId===id||e._networkPlayerId===id)||null;}
 resetRound(s){const g=this.game,wasAlive=g.player.alive;this.playerSurvived=!this._first&&wasAlive;
  if(this._first){g.player.money=800;for(const b of g.botMgr.bots)b.money=800;this.playerSurvived=false;}
  this.roundNum=s.round-1;super.nextRound();this._networkRound=s.round;this._first=false;
  g.player.armor=0;g.player.helmet=false;this.playerKit=false;
  for(const b of g.botMgr.bots){b.armor=0;b.helmet=false;b.hasKit=false;}
  this.cleanupBomb();this._bombKey='';g.hud.updateMoney();g.hud.updateHealth();
 }
 bombVisual(s){const g=this.game,kind=s.bomb?'planted':s.dropped?'dropped':'',pos=s.bomb||s.dropped,key=kind+(pos?':'+pos.x+':'+pos.y+':'+pos.z:'');
  if(key!==this._bombKey){this.cleanupBomb();this._bombKey=key;if(pos){const mesh=B_(),floor=g.physics.groundHeight(pos.x,pos.y+.5,pos.z),y=floor>-50&&Math.abs(floor-pos.y)<3?floor:pos.y;mesh.position.set(pos.x,y+.02,pos.z);g.scene.add(mesh);const obj={...pos,y,mesh};if(s.bomb){this.planted=obj;this.bombMesh=mesh;g.audio.play('planted',{pos:obj});g.hud.announce('Бомба установлена на '+pos.site,2500);}else this.dropped=obj;}}
 }
 update(dt){const g=this.game,mp=window.ClutcherMultiplayer,s=mp?.roundState;
  this._netUse=!!(this.useHeld||this.plantHeld)&&(!this.planted||g.player.team!=='CT'||this.bombUseReach(g.player,true));this.plantHeld=false;g.respawnAllowed=false;
  if(mp?.isHost&&performance.now()-this._lastConfig>1000){this._lastConfig=performance.now();mp.send({type:'bomb_config',sites:g.map.bombsites.map(b=>({name:b.name,boxes:b.boxes?Array.from(b.boxes,box=>Array.from(box)):[[b.minX,-100,b.minZ,b.maxX,100,b.maxZ]]}))});}
  if(!s||s.room!==mp.matchRoom){g.frozen=true;return;}
  if(s.round&&s.round!==this._networkRound)this.resetRound(s);
  const old=this.state;this.state=s.phase==='waiting'?'freeze':s.phase;this.roundNum=s.round;this.score={...s.score};this.freezeT=s.phase==='freeze'?s.clock:15;this.roundClock=s.phase==='live'?s.clock:115;this.bombT=s.phase==='planted'?s.clock:0;this.endT=s.clock;this.lastWinner=s.winner;g.roundActive=['freeze','live','planted'].includes(s.phase);g.frozen=!mp.connected||!['live','planted'].includes(s.phase);
  this.bombVisual(s);this.carrier=this.entity(s.carrier);this.defuser=this.entity(s.defuser);this.plantProgress=s.progress;this.defuseProgress=s.defuseProgress;
  for(const e of g.hittableEntities())e.hasBomb=e===this.carrier;
  const owns=this.carrier===g.player;
  if(owns){g.weapons.slots[5]='c4';g.weapons.states.c4||={ammo:1,reserve:0};}else if(g.weapons.slots[5]==='c4'){g.weapons.slots[5]=null;if(g.weapons.current==='c4')g.weapons.equip(g.weapons.slots[1]||g.weapons.slots[2]||'knife');}
  for(const p of s.people){const e=this.entity(p.id);if(e&&p.alive===false&&e.alive){e.alive=false;e.health=0;if(e===g.player){g.hud.announce('Следующее появление — в новом раунде',2500);g.hud.updateHealth();}}}
  if(s.phase==='end'&&this._rewardRound!==s.round){this._rewardRound=s.round;g.player.money=Math.min(16000,(g.player.money||0)+(s.rewards[g.player.team]||0));for(const b of g.botMgr.bots)b.money=Math.min(16000,(b.money||0)+(s.rewards[b.team]||0));if(s.reason==='Target destroyed'&&this.planted){const b=this.planted;g.audio.play('c4_boom',{pos:b});g.effects.c4Detonate?.(b.x,b.y,b.z,{detail:0});}this.roundLog.push({w:s.winner,how:s.reason==='Bomb defused'?'defuse':s.reason==='Target destroyed'?'bomb':'elim'});g.hud.announce((s.winner==='CT'?'Спецназ':'Террористы')+' победили — '+s.reason,4500);g.audio.play(s.winner===g.player.team?'win_round':'lose_round');g.hud.updateMoney();}
  if(old==='freeze'&&this.state==='live')g.hud.announce('Раунд начался!',1200);
  g.viewmodel.action=owns&&this.plantProgress>0?'plant':this.defuser===g.player&&this.defuseProgress>0?'defuse':null;g.player.forceCrouch=!!g.viewmodel.action;
  if(this.state==='planted'&&this.planted){this.beepT-=dt;if(this.beepT<=0){this.beepT=.12+Math.max(.06,this.bombT/40)*.95;g.audio.play(this.bombT<10?'beep_fast':'beep',{pos:this.planted});g.effects.bombBlink?.(this.planted.x,this.planted.y,this.planted.z);}}
  if(s.phase==='match_end'&&s.clock<=0)g.toMenu();
 }
}
