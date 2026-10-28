import test from 'node:test';
import assert from 'node:assert/strict';
import {io as client} from 'socket.io-client';
import {createGameServer} from '../server.js';
function once(s,event){return new Promise(resolve=>s.once(event,resolve));}
const send=(s,type,data={})=>s.timeout(2000).emitWithAck('command',{type,data});
test('real multiplayer: room, QR, private state, voting, reconnect and host transfer',async()=>{
 const server=createGameServer();await new Promise(resolve=>server.http.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.http.address().port}`;const sockets=[];
 async function connect(){const s=client(url,{forceNew:true,reconnection:false});sockets.push(s);await once(s,'connect');return s;}
 try{
  const states=[];const sessions=[];
  for(let i=0;i<4;i++){
   const s=await connect();s.on('state',v=>states[i]=v);
   const next=once(s,'state');const response=await send(s,i===0?'create':'join',{name:`Person ${i}`,code:sessions[0]?.code});assert.equal(response.ok,true);sessions.push(response.session);await next;
  }
  const code=sessions[0].code;
  assert.equal((await fetch(`${url}/health`)).status,200);
  assert.match(await (await fetch(`${url}/qr?room=${code}`)).text(),/<svg/);
  assert.equal((await fetch(`${url}/lib/words.js`)).status,404);
  assert.equal((await fetch(`${url}/`)).status,200);
  const outsider=await connect();assert.equal((await send(outsider,'join',{name:'Person 1',code})).ok,false);assert.equal((await send(outsider,'resume',{code,token:'fake'})).ok,false);
  for(const s of sockets.slice(0,4))assert.equal((await send(s,'ready')).ok,true);
  const revealStates=Promise.all(sockets.slice(0,4).map(s=>once(s,'state')));
  assert.equal((await send(sockets[0],'start')).ok,true);await revealStates;
  const r=server.rooms.get(code);
  assert.equal(r.phase,'reveal');
  for(const s of states){assert.ok(s.word);assert.equal(s.solution,null);assert.ok(s.players.every(p=>!('token'in p)&&!('word'in p)));}
  assert.equal((await send(outsider,'join',{name:'Latecomer',code})).ok,false);
  const oldId=states[1].me;sockets[1].disconnect();
  const restored=await connect();const restoredState=once(restored,'state');assert.equal((await send(restored,'resume',sessions[1])).ok,true);assert.equal((await restoredState).me,oldId);
  const playing=[sockets[0],restored,sockets[2],sockets[3]];
  for(const s of playing)assert.equal((await send(s,'revealed')).ok,true);
  while(r.phase==='clues')assert.equal((await send(sockets[0],'clue-done')).ok,true);
  assert.equal((await send(sockets[0],'open-vote')).ok,true);
  for(let i=0;i<4;i++){const p=r.players[i];const target=p.id===r.spyId?r.players.find(x=>x.id!==r.spyId).id:r.spyId;assert.equal((await send(playing[i],'vote',{target})).ok,true);}
  assert.equal(r.phase,'finished');assert.equal(r.winner,'civilians');
  sockets[0].disconnect();await new Promise(resolve=>setTimeout(resolve,50));assert.notEqual(r.hostId,r.players[0].id);
  const newHost=playing[r.players.findIndex(p=>p.id===r.hostId)];assert.equal((await send(newHost,'lobby')).ok,true);
  assert.equal((await send(newHost,'settings',{pack:'food',seconds:60})).ok,true);
  assert.equal(r.pack,'food');
 }finally{for(const s of sockets)s.disconnect();await server.close();}
});
