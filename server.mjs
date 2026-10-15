import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Arena} from './game.mjs';
const root=new URL('./',import.meta.url);
export function createGameServer({arena=new Arena()}={}){
 const streams=new Map(),limits=new Map();
 const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'");
  const url=new URL(req.url,'http://localhost');
  try{
   if(url.pathname==='/health'){json(res,200,{ok:true});return;}
   if(url.pathname==='/api/events'&&req.method==='GET'){
    // Tokens travel in the first POST; a short-lived HttpOnly cookie authenticates SSE.
    const code=url.searchParams.get('room'),token=parseCookie(req.headers.cookie,`neon_${code}`);
    const {room,p}=arena.auth(code,token);
    if(streams.size>=800&&!streams.has(p.id))throw Error('The arena is busy. Please retry.');
    streams.get(p.id)?.end();
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
    streams.set(p.id,res);p.lastSeen=Date.now();p.connected=true;
    res.write(`data: ${JSON.stringify(arena.snapshot(room))}\n\n`);
    req.on('close',()=>{if(streams.get(p.id)===res){streams.delete(p.id);p.connected=false;p.input={x:0,y:0,angle:p.angle,fire:false};}});return;
   }
   if(url.pathname.startsWith('/api/')&&req.method==='POST'){
    if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host){json(res,403,{error:'Requests must come from this game site.'});return;}
    const ip=req.socket.remoteAddress,now=Date.now();let limit=limits.get(ip);if(!limit||now-limit.at>1000){limit={at:now,n:0};limits.set(ip,limit);}if(++limit.n>400){json(res,429,{error:'Too many requests. Please pause and retry.'});return;}
    let body='';for await(const chunk of req){body+=chunk;if(body.length>4096){json(res,413,{error:'Request is too large.'});return;}}
    const data=JSON.parse(body||'{}');let session;
    if(url.pathname==='/api/create')session=arena.create(data.name);
    else if(url.pathname==='/api/join')session=arena.join(String(data.code||'').trim().toUpperCase(),data.name,data.token);
    else if(url.pathname==='/api/action'){const {room,p}=arena.auth(data.code,data.token);arena.action(room,p,data);json(res,200,{ok:true});return;}
    else{json(res,404,{error:'Unknown endpoint.'});return;}
    const {room,p}=session;
    const secure=req.socket.encrypted||req.headers['x-forwarded-proto']==='https';
    res.setHeader('Set-Cookie',`neon_${room.code}=${p.token}; HttpOnly; SameSite=Strict; Path=/api/events; Max-Age=86400${secure?'; Secure':''}`);
    json(res,200,{code:room.code,id:p.id,token:p.token,state:arena.snapshot(room)});return;
   }
   const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/favicon.svg':'favicon.svg'};
   if(req.method!=='GET'||!files[url.pathname]){json(res,404,{error:'Not found.'});return;}
   const filename=files[url.pathname],content=await readFile(new URL(filename,root));
   res.writeHead(200,{'Content-Type':filename.endsWith('.html')?'text/html; charset=utf-8':filename.endsWith('.js')?'text/javascript; charset=utf-8':filename.endsWith('.svg')?'image/svg+xml':'text/css; charset=utf-8','Cache-Control':'no-cache'});res.end(content);
  }catch(e){json(res,400,{error:e instanceof SyntaxError?'Invalid request. Please retry.':e.message});}
 });
 const interval=setInterval(()=>{
  const now=Date.now();arena.step(now);
  for(const room of arena.rooms.values()){
   let payload;for(const p of room.players){const res=streams.get(p.id);if(!res)continue;if(res.writableLength>256000){res.destroy();continue;}p.lastSeen=now;payload??=`data: ${JSON.stringify(arena.snapshot(room,now))}\n\n`;res.write(payload);}
  }
  for(const [id,res] of streams){if(![...arena.rooms.values()].some(r=>r.players.some(p=>p.id===id))){res.end();streams.delete(id);}}
  for(const [ip,l] of limits)if(now-l.at>60000)limits.delete(ip);
 },50);
 server.on('close',()=>clearInterval(interval));
 return {server,arena,close:()=>{clearInterval(interval);for(const res of streams.values())res.end();server.closeAllConnections();return new Promise(resolve=>server.close(resolve));}};
}
function parseCookie(cookie,key){return String(cookie||'').split(';').map(s=>s.trim().split('=')).find(([k])=>k===key)?.[1];}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const {server}=createGameServer();server.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log(`Neon Arena listening on http://localhost:${server.address().port}`));
}
