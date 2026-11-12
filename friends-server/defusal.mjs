// Shared round authority for private 5v5 rooms. Positions/hits remain client supplied.
export class Defusal {
 constructor(){this.round=0;this.phase='waiting';this.clock=0;this.score={CT:0,T:0};this.people=new Map();this.sites=[];this.carrier=null;this.bomb=null;this.dropped=null;this.progress=0;this.defuseProgress=0;this.defuser=null;this.winner=null;this.reason='';this.rewards={CT:0,T:0};this.loss={CT:0,T:0};}
 configure(sites){if(this.sites.length||!Array.isArray(sites))return;this.sites=sites.slice(0,4).filter(s=>Array.isArray(s.boxes)&&s.boxes.length&&s.boxes.length<=128&&s.boxes.every(b=>Array.isArray(b)&&b.length===6&&b.every(n=>Number.isFinite(n)&&Math.abs(n)<2000))).map(s=>({name:String(s.name).slice(0,12),boxes:s.boxes}));}
 sync(entries){const ids=new Set(entries.map(e=>e.id));for(const id of this.people.keys())if(!ids.has(id)){if(this.carrier===id)this.drop(id);this.people.delete(id);}for(const e of entries){if(!this.people.has(e.id))this.people.set(e.id,{id:e.id,team:e.team,bot:!!e.bot,alive:this.phase==='waiting',seen:false,state:null});}}
 accept(id,s){const p=this.people.get(id);if(!p)return false;if(this.round&&s.round!==this.round)return false;p.seen=true;p.state=s;if(this.phase==='waiting')p.alive=s.alive;else if(p.alive&&!s.alive){p.alive=false;if(this.carrier===id)this.drop(id);}return true;}
 site(s){return this.sites.find(site=>site.boxes.some(b=>s.x+.4>b[0]&&s.x-.4<b[3]&&s.y+1.8>b[1]&&s.y<b[4]&&s.z+.4>b[2]&&s.z-.4<b[5]));}
 drop(id){const p=this.people.get(id);if(this.carrier!==id||!p?.state)return;this.dropped={x:p.state.x,y:p.state.y,z:p.state.z};this.carrier=null;this.progress=0;}
 next(){this.round++;this.phase='freeze';this.clock=15;this.bomb=null;this.dropped=null;this.defuser=null;this.progress=this.defuseProgress=0;this.winner=null;this.reason='';this.rewards={CT:0,T:0};for(const p of this.people.values()){p.alive=true;p.seen=false;}const ts=[...this.people.values()].filter(p=>p.team==='T');this.carrier=ts.length?ts[(this.round-1)%ts.length].id:null;}
 end(team,reason){if(['end','match_end'].includes(this.phase))return;this.phase='end';this.clock=5;this.score[team]++;this.winner=team;this.reason=reason;this.progress=this.defuseProgress=0;const loser=team==='CT'?'T':'CT';this.loss[team]=0;this.loss[loser]=Math.min(5,this.loss[loser]+1);this.rewards={[team]:reason==='Bomb defused'||reason==='Target destroyed'?3500:3250,[loser]:1400+(this.loss[loser]-1)*500};}
 tick(dt,ready=true){
  if(this.phase==='waiting'){if(ready&&this.sites.length&&this.people.size&&[...this.people.values()].every(p=>p.seen))this.next();return;}
  if(this.phase==='freeze'){// Loading a client must not consume its buy time.
   if(!ready||![...this.people.values()].every(p=>p.seen))return;
   this.clock-=dt;if(this.clock<=0){this.phase='live';this.clock=115;}return;
  }
  if(this.phase==='end'){this.clock-=dt;if(this.clock<=0){if(Math.max(this.score.CT,this.score.T)>=13){this.phase='match_end';this.clock=8;}else this.next();}return;}
  if(this.phase==='match_end'){this.clock=Math.max(0,this.clock-dt);return;}
  const alive=[...this.people.values()].filter(p=>p.alive),ct=alive.filter(p=>p.team==='CT'),ts=alive.filter(p=>p.team==='T');
  if(!ct.length){this.end('T','Counter-Terrorists eliminated');return;}
  if(!ts.length&&this.phase!=='planted'){this.end('CT','Terrorists eliminated');return;}
  this.clock-=dt;
  if(this.phase==='live'){
   if(this.clock<=0){this.end('CT','Time ran out');return;}
   if(this.dropped){const p=ts.find(p=>p.state&&Math.hypot(p.state.x-this.dropped.x,p.state.z-this.dropped.z)<1.5&&Math.abs(p.state.y-this.dropped.y)<2);if(p){this.carrier=p.id;this.dropped=null;}}
   const p=this.people.get(this.carrier),s=p?.state,site=s&&this.site(s);
   if(p?.alive&&site&&s.onGround&&s.use&&Math.hypot(s.vx,s.vz)<.3){this.progress+=dt/3.2;if(this.progress>=1){this.bomb={x:s.x,y:s.y,z:s.z,site:site.name};this.phase='planted';this.clock=40;this.carrier=null;this.progress=0;}}
   else this.progress=0;
  }else if(this.phase==='planted'){
   if(this.clock<=0){this.end('T','Target destroyed');return;}
   const can=p=>{const s=p.state;return s&&s.use&&s.onGround&&Math.hypot(s.vx,s.vz)<.3&&Math.hypot(s.x-this.bomb.x,s.z-this.bomb.z)<2.2&&Math.abs(s.y-this.bomb.y)<2;};
   const p=ct.find(p=>p.id===this.defuser&&can(p))||ct.find(can);
   if(p){if(this.defuser!==p.id)this.defuseProgress=0;this.defuser=p.id;this.defuseProgress+=dt/(p.state.kit?5:10);if(this.defuseProgress>=1)this.end('CT','Bomb defused');}else{this.defuser=null;this.defuseProgress=0;}
  }
 }
 snapshot(){return {round:this.round,phase:this.phase,clock:this.clock,score:this.score,carrier:this.carrier,bomb:this.bomb,dropped:this.dropped,progress:this.progress,defuseProgress:this.defuseProgress,defuser:this.defuser,winner:this.winner,reason:this.reason,rewards:this.rewards,people:[...this.people.values()].map(p=>({id:p.id,team:p.team,alive:p.alive}))};}
}
