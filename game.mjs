import { randomBytes } from 'node:crypto';
export const W=1600,H=1000,COLORS=['#49f2ff','#c17bff','#ff6caa','#ffd166','#65ffb4','#ff934f','#8aabff','#edff75'];
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const rand=(a,b)=>a+Math.random()*(b-a);
const uid=()=>randomBytes(16).toString('hex');
export class Arena {
 constructor({duration=180000,grace=30000}={}) {this.rooms=new Map();this.duration=duration;this.grace=grace;}
 create(name,now=Date.now()) {
  if(this.rooms.size>=100) throw Error('The arena is busy. Please try again shortly.');
  let code;do{code=Array.from(randomBytes(6),x=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x%32]).join('');}while(this.rooms.has(code));
  const room={code,players:[],host:null,phase:'lobby',crystals:[],asteroids:[],pulses:[],events:[],endAt:0,created:now,emptyAt:0,last:now};
  this.rooms.set(code,room);return this.join(code,name,null,now);
 }
 join(code,name,token,now=Date.now()) {
  const room=this.rooms.get(code);if(!room)throw Error('Room not found. Check the code or ask your friend for a new invite.');
  let p=token&&room.players.find(p=>p.token===token);
  if(p){p.lastSeen=now;p.connected=true;return {room,p};}
  if(room.phase!=='lobby')throw Error('This match has started. Ask your friends to return to the lobby after the match.');
  if(room.players.length>=8)throw Error('This room is full (8 players).');
  name=String(name||'').trim().replace(/[\x00-\x1f\x7f]/g,'').slice(0,18);if(!name)throw Error('Enter a nickname first.');
  p={id:uid(),token:uid(),name,color:COLORS.find(c=>!room.players.some(p=>p.color===c)),score:0,ready:false,vote:false,connected:true,lastSeen:now,x:0,y:0,angle:0,input:{x:0,y:0,angle:0,fire:false},stunUntil:0,respawnAt:0,shieldUntil:0,lastFire:0,lastSeq:0};
  room.players.push(p);if(!room.host)room.host=p.id;this.spawn(p,room,now);return {room,p};
 }
 auth(code,token){const room=this.rooms.get(code),p=room?.players.find(p=>p.token===token);if(!p)throw Error('Your room session expired. Join the room again.');return {room,p};}
 spawn(p,room,now){let spot;for(let i=0;i<20;i++){spot={x:rand(100,W-100),y:rand(100,H-100)};if(!room.asteroids.some(a=>dist(a,spot)<a.r+100)&&!room.players.some(q=>q!==p&&dist(q,spot)<100))break;}Object.assign(p,spot,{respawnAt:0,stunUntil:0,shieldUntil:now+1800,input:{x:0,y:0,angle:0,fire:false}});}
 start(room,p,now=Date.now()) {
  if(room.host!==p.id)throw Error('Only the host can launch the match.');
  const online=room.players.filter(p=>p.connected);
  if(room.phase!=='lobby'||online.length<2||online.some(p=>!p.ready))throw Error('At least two connected pilots must be ready.');
  room.phase='playing';room.endAt=now+this.duration;room.last=now;room.crystals=[];room.pulses=[];room.events=[];
  room.asteroids=Array.from({length:9},(_,i)=>({id:i,x:rand(70,W-70),y:rand(70,H-70),vx:rand(-85,85),vy:rand(-85,85),r:rand(23,43),rot:rand(0,6)}));
  for(let i=0;i<55;i++)this.crystal(room);for(const p of room.players){p.score=0;p.vote=false;this.spawn(p,room,now);}
 }
 crystal(room,x=rand(30,W-30),y=rand(30,H-30),availableAt=0){if(room.crystals.length<110)room.crystals.push({id:uid().slice(0,12),x:clamp(x,18,W-18),y:clamp(y,18,H-18),availableAt});}
 drop(room,p,now){const n=Math.min(p.score,Math.max(1,Math.ceil(p.score*.3)));p.score-=n;for(let i=0;i<n;i++)this.crystal(room,p.x+rand(-65,65),p.y+rand(-65,65),now+1000);}
 action(room,p,data,now=Date.now()) {
  p.lastSeen=now;p.connected=true;
  switch(data.type){
   case 'input': {
    if(!Number.isSafeInteger(data.seq)||data.seq<=p.lastSeq)return;
    p.lastSeq=data.seq;
    p.input={x:clamp(Number(data.x)||0,-1,1),y:clamp(Number(data.y)||0,-1,1),angle:Number.isFinite(data.angle)?data.angle:0,fire:data.fire===true};break;
   }
   case 'ready': if(room.phase==='lobby')p.ready=data.ready===true;break;
   case 'start':this.start(room,p,now);break;
   case 'rematch':if(room.phase==='results'){p.vote=true;this.rematch(room);}break;
   case 'leave':this.leave(room,p);break;
   default:throw Error('Unknown game action.');
  }
 }
 rematch(room){const live=room.players.filter(p=>p.connected);if(live.length>=2&&live.every(p=>p.vote)){room.phase='lobby';room.pulses=[];for(const p of room.players){p.ready=false;p.vote=false;}}}
 leave(room,p){room.players=room.players.filter(q=>q!==p);this.elect(room);if(room.phase==='results')this.rematch(room);}
 elect(room){if(!room.players.some(p=>p.id===room.host&&p.connected))room.host=room.players.find(p=>p.connected)?.id||null;}
 step(now=Date.now()) {
  for(const room of this.rooms.values()){
   for(const p of [...room.players]){
    if(now-p.lastSeen>4500)p.connected=false;
    if(!p.connected)p.input={x:0,y:0,angle:p.angle,fire:false};
    if(now-p.lastSeen>this.grace)this.leave(room,p);
   }
   this.elect(room);if(room.phase==='results')this.rematch(room);
   if(!room.players.length){if(!room.emptyAt)room.emptyAt=now;if(now-room.emptyAt>60000)this.rooms.delete(room.code);continue;}room.emptyAt=0;
   const dt=clamp((now-room.last)/1000,0,.1);room.last=now;
   room.events=room.events.filter(e=>now-e.at<700);
   if(room.phase!=='playing')continue;
   if(now>=room.endAt){room.phase='results';room.pulses=[];continue;}
   for(const a of room.asteroids){a.x+=a.vx*dt;a.y+=a.vy*dt;if(a.x<a.r||a.x>W-a.r){a.vx*=-1;a.x=clamp(a.x,a.r,W-a.r);}if(a.y<a.r||a.y>H-a.r){a.vy*=-1;a.y=clamp(a.y,a.r,H-a.r);}a.rot+=dt*.25;}
   for(const p of room.players){
    if(p.respawnAt){if(now>=p.respawnAt)this.spawn(p,room,now);else continue;}
    if(!p.connected)continue;
    p.angle=p.input.angle;
    if(now>=p.stunUntil){const len=Math.max(1,Math.hypot(p.input.x,p.input.y));p.x=clamp(p.x+p.input.x/len*275*dt,18,W-18);p.y=clamp(p.y+p.input.y/len*275*dt,18,H-18);
     if(p.input.fire&&now-p.lastFire>=450){p.lastFire=now;room.pulses.push({id:uid().slice(0,12),owner:p.id,x:p.x+Math.cos(p.angle)*24,y:p.y+Math.sin(p.angle)*24,vx:Math.cos(p.angle)*720,vy:Math.sin(p.angle)*720,expires:now+1300,color:p.color});room.events.push({id:uid(),type:'fire',x:p.x,y:p.y,at:now});}
    }
    if(now>=p.shieldUntil&&room.asteroids.some(a=>dist(a,p)<a.r+16)){this.drop(room,p,now);p.respawnAt=now+900;room.events.push({id:uid(),type:'hit',x:p.x,y:p.y,at:now});continue;}
    room.crystals=room.crystals.filter(c=>{if(now>=c.availableAt&&dist(c,p)<28){p.score++;room.events.push({id:uid(),type:'collect',player:p.id,x:c.x,y:c.y,at:now});return false;}return true;});
   }
   room.pulses=room.pulses.filter(b=>{
    const start={x:b.x,y:b.y};b.x+=b.vx*dt;b.y+=b.vy*dt;
    if(now>b.expires||b.x<0||b.y<0||b.x>W||b.y>H)return false;
    // Segment distance prevents fast pulses tunneling through ships and rocks.
    const segmentDistance=q=>{const dx=b.x-start.x,dy=b.y-start.y;const t=clamp(((q.x-start.x)*dx+(q.y-start.y)*dy)/(dx*dx+dy*dy||1),0,1);return Math.hypot(q.x-start.x-dx*t,q.y-start.y-dy*t);};
    if(room.asteroids.some(a=>segmentDistance(a)<a.r+4))return false;
    const victim=room.players.find(p=>p.id!==b.owner&&p.connected&&!p.respawnAt&&now>=p.shieldUntil&&segmentDistance(p)<22);
    if(victim){this.drop(room,victim,now);victim.stunUntil=now+650;victim.shieldUntil=now+1400;room.events.push({id:uid(),type:'hit',x:victim.x,y:victim.y,at:now});return false;}return true;
   });
   while(room.crystals.length<55)this.crystal(room);
  }
 }
 snapshot(room,now=Date.now()){return {code:room.code,phase:room.phase,host:room.host,serverNow:now,endAt:room.endAt,width:W,height:H,players:room.players.map(({token,input,lastSeq,lastSeen,...p})=>p),crystals:room.crystals,asteroids:room.asteroids,pulses:room.pulses,events:room.events};}
}
