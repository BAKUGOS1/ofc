import { randomInt, randomUUID } from 'node:crypto';
import { packs } from './words.js';
export class GameError extends Error {}
const ensure = (ok, message) => { if (!ok) throw new GameError(message); };
export function player(name) {
  ensure(typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 20, 'Use a name between 2 and 20 characters.');
  return { id: randomUUID(), token: randomUUID(), name: name.trim(), connected: true, ready: false, alive: true, score: 0 };
}
export function room(code, host) {
  return { code, hostId: host.id, players: [host], phase: 'lobby', pack: 'office', seconds: 45, round: 0, match: 0, updated: Date.now(), used: [], votes: {}, history: [], candidates: [], runoff: false };
}
const active = r => r.players.filter(p => p.alive);
export function nextSpeaker(r) { return r.order[r.turn]; }
function clues(r) {
  r.phase = 'clues'; r.turn = 0; r.round++; r.votes = {}; r.runoff = false;
  r.order = active(r).map(p => p.id);
  // Rotate the starting speaker each round.
  const shift = randomInt(r.order.length); r.order = [...r.order.slice(shift), ...r.order.slice(0, shift)];
  r.deadline = Date.now() + r.seconds * 1000;
}
export function start(r, id) {
  ensure(id === r.hostId, 'Only the host can start.');
  ensure(r.phase === 'lobby', 'The game has already started.');
  ensure(r.players.length >= 4 && r.players.length <= 10, 'Gather 4–10 players to start.');
  ensure(r.players.every(p => p.ready && p.connected), 'Everyone needs to be connected and ready.');
  const pool = packs[r.pack];
  let options = pool.map((_,i) => i).filter(i => !r.used.includes(`${r.pack}:${i}`));
  if (!options.length) { r.used = []; options = pool.map((_,i) => i); }
  const index = options[randomInt(options.length)]; r.used.push(`${r.pack}:${index}`);
  const pair = [...pool[index]]; if (randomInt(2)) pair.reverse();
  r.words = pair; r.spyId = r.players[randomInt(r.players.length)].id;
  r.players.forEach(p => { p.alive = true; p.revealed = false; p.word = pair[p.id === r.spyId ? 1 : 0]; });
  r.phase = 'reveal'; r.round = 0; r.match++; r.history = []; r.winner = null; r.lastResult = null; r.deadline = null;
}
function finish(r, winner) {
  r.phase = 'finished'; r.winner = winner; r.deadline = null;
  r.players.forEach(p => { if ((winner === 'undercover') === (p.id === r.spyId)) p.score++; });
}
function resolve(r) {
  const counts = Object.values(r.votes).reduce((a,id) => ({...a,[id]:(a[id]||0)+1}), {});
  const max = Math.max(0,...Object.values(counts));
  const tied = r.candidates.filter(id => (counts[id]||0) === max);
  if (tied.length > 1 && !r.runoff) {
    r.phase = 'voting'; r.runoff = true; r.candidates = tied; r.votes = {}; r.deadline = Date.now() + 30000; return;
  }
  const eliminated = max > 0 && tied.length === 1 ? tied[0] : null;
  if (eliminated) r.players.find(p => p.id === eliminated).alive = false;
  r.lastResult = { eliminated, undercover: eliminated === r.spyId, counts, tied: !eliminated };
  r.history.push({ round: r.round, ...r.lastResult });
  r.deadline = null;
  if (eliminated === r.spyId) finish(r, 'civilians');
  else if (active(r).length <= 3) finish(r, 'undercover');
  else r.phase = 'result';
}
export function action(r, id, type, data = {}) {
  const p = r.players.find(p => p.id === id); ensure(p, 'Player not found.');
  switch (type) {
    case 'settings':
      ensure(id === r.hostId && r.phase === 'lobby', 'Settings are locked.');
      ensure(Object.hasOwn(packs, data.pack) && [30,45,60].includes(data.seconds), 'Invalid settings.');
      r.pack = data.pack; r.seconds = data.seconds; r.players.forEach(p => p.ready = false); break;
    case 'ready': ensure(r.phase === 'lobby', 'Game already started.'); p.ready = !p.ready; break;
    case 'start': start(r,id); break;
    case 'revealed':
      ensure(r.phase === 'reveal', 'Not the reveal phase.'); p.revealed = true;
      if (r.players.every(p => p.revealed)) clues(r); break;
    case 'clue-done':
      ensure(r.phase === 'clues' && (nextSpeaker(r) === id || id === r.hostId), 'Wait for your turn.');
      advanceTurn(r); break;
    case 'open-vote':
      ensure(r.phase === 'discussion' && id === r.hostId, 'Only the host can open voting after clues.'); openVote(r); break;
    case 'vote':
      ensure(r.phase === 'voting' && p.alive, 'You cannot vote right now.');
      ensure(!Object.hasOwn(r.votes, id), 'Your vote is already locked.');
      ensure(data.target !== id && r.candidates.includes(data.target), 'Choose another eligible player.');
      r.votes[id] = data.target;
      if (active(r).every(p => Object.hasOwn(r.votes, p.id))) resolve(r); break;
    case 'next': ensure(r.phase === 'result' && id === r.hostId, 'Only the host can start the next round.'); clues(r); break;
    case 'lobby':
      ensure(r.phase === 'finished' && id === r.hostId, 'Finish this game first.');
      r.phase = 'lobby'; r.deadline = null; r.players.forEach(p => { p.ready = false; p.alive = true; delete p.word; }); break;
    case 'cancel':
      ensure(id === r.hostId && r.phase !== 'lobby', 'Only the host can end a game.');
      r.phase = 'lobby'; r.deadline = null; r.players.forEach(p => { p.ready = false; p.alive = true; delete p.word; }); break;
    default: throw new GameError('Unknown action.');
  }
  r.updated = Date.now();
}
function advanceTurn(r) {
  r.turn++;
  if (r.turn >= r.order.length) { r.phase = 'discussion'; r.deadline = Date.now() + 60000; }
  else r.deadline = Date.now() + r.seconds * 1000;
}
function openVote(r) { r.phase = 'voting'; r.votes = {}; r.candidates = active(r).map(p=>p.id); r.runoff = false; r.deadline = Date.now() + 45000; }
export function tick(r, now = Date.now()) {
  if (!r.deadline || now < r.deadline) return false;
  if (r.phase === 'clues') advanceTurn(r);
  else if (r.phase === 'discussion') openVote(r);
  else if (r.phase === 'voting') resolve(r);
  else return false;
  r.updated = now; return true;
}
export function view(r, id) {
  const me = r.players.find(p=>p.id===id);
  return {
    code:r.code, hostId:r.hostId, phase:r.phase, pack:r.pack, seconds:r.seconds, round:r.round, match:r.match,
    me:id, word: r.phase !== 'lobby' ? me?.word : null, revealed:!!me?.revealed,
    players:r.players.map(p=>({id:p.id,name:p.name,connected:p.connected,ready:p.ready,alive:p.alive,score:p.score,revealed:!!p.revealed})),
    speaker:r.phase==='clues'?nextSpeaker(r):null, order:r.order, deadline:r.deadline,
    voted:Object.keys(r.votes), myVote:r.votes[id] || null, candidates:r.candidates, runoff:r.runoff,
    lastResult: ['result','finished'].includes(r.phase)?r.lastResult:null,
    history:r.history,
    winner:r.phase==='finished'?r.winner:null,
    solution:r.phase==='finished'?{words:r.words,spyId:r.spyId}:null
  };
}
