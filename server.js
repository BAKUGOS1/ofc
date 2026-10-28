import express from 'express';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import { player, room, action, tick, view, GameError } from './lib/game.js';

export function createGameServer() {
  const app = express(); const http = createServer(app);
  const io = new Server(http, {
    maxHttpBufferSize: 4096,
    allowRequest: (req, done) => {
      // Native clients have no Origin; browser clients must come from this host.
      try { done(null, !req.headers.origin || new URL(req.headers.origin).host === req.headers.host); }
      catch { done(null, false); }
    }
  });
  const rooms = new Map();
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    next();
  });
  app.get('/health',(_req,res)=>res.json({ok:true}));
  app.get('/qr',async(req,res)=>{
    const code=String(req.query.room||'');
    if(!/^[A-Z2-9]{6}$/.test(code)||!rooms.has(code)) return res.sendStatus(404);
    const base=process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    try { res.type('svg').send(await QRCode.toString(`${base}/?room=${code}`,{type:'svg',margin:2,width:220})); }
    catch { res.sendStatus(500); }
  });
  app.use(express.static(fileURLToPath(new URL('./public',import.meta.url))));
  function broadcast(r) {
    for(const p of r.players) if(p.socketId) io.to(p.socketId).emit('state',view(r,p.id));
  }
  const leave = (socket, permanent=false) => {
    const r=rooms.get(socket.data.code); if(!r)return;
    const p=r.players.find(p=>p.id===socket.data.playerId); if(!p||p.socketId!==socket.id)return;
    if(permanent && r.phase!=='lobby') throw new GameError('Leave after the game, or ask the host to end it.');
    p.connected=false; p.socketId=null;
    if(permanent) r.players=r.players.filter(x=>x!==p);
    if(r.hostId===p.id) r.hostId=r.players.find(x=>x.connected)?.id || r.players[0]?.id;
    r.updated=Date.now(); broadcast(r);
    if(permanent) {socket.data={}; if(!r.players.length)rooms.delete(r.code);}
  };
  io.on('connection',socket=>{
    let windowStart=Date.now(), requests=0;
    socket.on('command',(payload,ack)=>{
      if(typeof ack!=='function')return;
      try {
        if(Date.now()-windowStart>10000){windowStart=Date.now();requests=0;}
        if(++requests>60)throw new GameError('Slow down a little and try again.');
        if(!payload||typeof payload!=='object'||typeof payload.type!=='string')throw new GameError('Invalid request.');
        const {type}=payload; const data=payload.data && typeof payload.data==='object'?payload.data:{};
        let r, p;
        if(type==='create'||type==='join'||type==='resume') {
          if(socket.data.code)throw new GameError('You are already in a room.');
          if(type==='resume') {
            r=rooms.get(String(data.code)); p=r?.players.find(p=>p.token===data.token);
            if(!p)throw new GameError('This session has expired. Join a new room.');
            if(p.socketId) {const old=io.sockets.sockets.get(p.socketId); if(old){old.data={};old.emit('replaced');old.disconnect(true);}}
          } else {
            if(type==='create') {
              if(rooms.size>=500)throw new GameError('Server is full. Try again later.');
              let code; const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
              do {code=Array.from({length:6},()=>alphabet[randomInt(alphabet.length)]).join('');}while(rooms.has(code));
              p=player(data.name); r=room(code,p); rooms.set(code,r);
            } else {
              r=rooms.get(String(data.code||'').toUpperCase().trim());
              if(!r)throw new GameError('Room not found. Check the six-character code.');
              if(r.phase!=='lobby')throw new GameError('Game in progress. Join when the next lobby opens.');
              if(r.players.length>=10)throw new GameError('This room is full (10 players).');
              p=player(data.name);
              if(r.players.some(x=>x.name.toLowerCase()===p.name.toLowerCase()))throw new GameError('That name is taken. Try a different one.');
              r.players.push(p);
            }
          }
          p.connected=true; p.socketId=socket.id; socket.data.code=r.code; socket.data.playerId=p.id;
          if(!r.players.some(x=>x.id===r.hostId&&x.connected))r.hostId=p.id;
          r.updated=Date.now(); ack({ok:true,session:{code:r.code,token:p.token}}); broadcast(r); return;
        }
        r=rooms.get(socket.data.code); if(!r)throw new GameError('Join a room first.');
        if(type==='leave'){leave(socket,true);ack({ok:true});return;}
        if(type==='kick') {
          if(socket.data.playerId!==r.hostId||r.phase!=='lobby')throw new GameError('Only the host can remove players in the lobby.');
          const target=r.players.find(p=>p.id===data.target);
          if(!target||target.id===r.hostId)throw new GameError('Choose another player.');
          r.players=r.players.filter(p=>p!==target);
          const targetSocket=io.sockets.sockets.get(target.socketId);
          if(targetSocket){targetSocket.data={};targetSocket.emit('removed');}
          broadcast(r);ack({ok:true});return;
        }
        action(r,socket.data.playerId,type,data); broadcast(r); ack({ok:true});
      }catch(e){if(!(e instanceof GameError))console.error(e);ack({ok:false,error:e instanceof GameError?e.message:'Something went wrong. Please try again.'});}
    });
    socket.on('disconnect',()=>leave(socket));
  });
  const timer=setInterval(()=>{
    for(const [code,r] of rooms){
      if(!r.players.some(p=>p.connected)&&Date.now()-r.updated>2*60*60*1000){rooms.delete(code);continue;}
      if(tick(r))broadcast(r);
    }
  },500); timer.unref();
  return { app, http, io, rooms, close:()=>new Promise(resolve=>{clearInterval(timer);io.close(()=>http.close(()=>resolve()));}) };
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const server=createGameServer(); const port=Number(process.env.PORT)||3000;
  server.http.listen(port,'0.0.0.0',()=>{
    console.log(`\nUNDERCOVER · Office hours, secret identities.\nLocal: http://localhost:${port}`);
    try {
      for(const list of Object.values(networkInterfaces()))for(const ip of list||[])if(ip.family==='IPv4'&&!ip.internal)console.log(`Wi-Fi: http://${ip.address}:${port}`);
    } catch { console.log('Wi-Fi: use this computer’s LAN IP address with port '+port); }
    console.log('Open a Wi-Fi address on every phone. Keep this computer awake.\n');
  });
}
