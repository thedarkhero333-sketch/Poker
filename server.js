// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
server.listen(process.env.PORT || 3000, () => {
  console.log("Servidor escuchando en puerto", process.env.PORT || 3000);
});

let players = [];
let deck = [];
let dealerIndex = 0;
let gameRunning = false;

const SMALL_BLIND = 5;
const BIG_BLIND = 10;

let gameState = {
  pot: 0,
  sidePots: [],
  community: [],
  turn: null,          // always a socket.id (string) when set
  stage: 0,
  reveal: false,
  currentBet: 0,
  lastAggressor: null
};

/* ---------- Helpers ---------- */
function setTurnByIndex(idx) {
  if (players[idx]) gameState.turn = players[idx].id;
  else gameState.turn = null;
}

function getPlayer(id) {
  return players.find(p => p.id === id);
}

function canPlay(p) {
  return p && !p.folded && !p.allIn && gameState.turn === p.id;
}

function createDeck() {
  const suits = ["♠","♥","♦","♣"];
  const values = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"];
  const d = [];
  for (let s of suits) for (let v of values) d.push(v + s);
  return d;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

/* ---------- Socket connection ---------- */
io.on("connection", socket => {
  console.log("Conexión:", socket.id);

  // Evitar duplicados
  if (players.find(p => p.id === socket.id)) {
    console.log("Socket ya registrado:", socket.id);
    io.emit("update", { players, gameState });
    return;
  }

  if (players.length >= 6) {
    console.log("Sala llena - rechazando:", socket.id);
    return;
  }

  players.push({
    id: socket.id,
    name: "Jugador " + (players.length + 1),
    money: 200,
    cards: [],
    folded: false,
    bet: 0,
    totalBet: 0,
    role: "",
    allIn: false
  });

  console.log("Jugadores:", players.map(p=>p.id));

  if (players.length >= 2 && !gameRunning) startGame();

  // enviar estado inicial a todos
  io.emit("update", { players, gameState });

  // Debug logs para los eventos de cliente
  socket.on("call", () => {
    console.log("CALL desde", socket.id, "turn:", gameState.turn);
    playerCall(socket.id);
  });
  socket.on("check", () => {
    console.log("CHECK desde", socket.id, "turn:", gameState.turn);
    playerCheck(socket.id);
  });
  socket.on("fold", () => {
    console.log("FOLD desde", socket.id, "turn:", gameState.turn);
    playerFold(socket.id);
  });
  socket.on("raise", amount => {
    console.log("RAISE desde", socket.id, "amount:", amount, "turn:", gameState.turn);
    playerRaise(socket.id, amount);
  });

  socket.on("disconnect", () => {
    console.log("Disconnect:", socket.id);
    players = players.filter(p => p.id !== socket.id);
    if (players.length < 2) gameRunning = false;
    io.emit("update", { players, gameState });
  });
});

/* ---------- Betting actions ---------- */
function betAmount(player, amount) {
  // amount = how much extra we should put (not absolute) — in this code we pass absolute increments when used
  if (!player) return;
  if (amount <= 0) return;

  if (amount >= player.money) {
    // send all remaining
    amount = player.money;
    player.allIn = true;
  }

  player.money -= amount;
  player.bet += amount;
  player.totalBet += amount;
}

function playerCall(id) {
  const p = getPlayer(id);
  if (!canPlay(p)) return;

  const toCall = gameState.currentBet - p.bet;
  if (toCall <= 0) return;

  betAmount(p, toCall);
  console.log(`playerCall: ${p.id} pagó ${toCall}`);
  nextTurn();
}

function playerCheck(id) {
  const p = getPlayer(id);
  if (!canPlay(p)) return;
  if (p.bet !== gameState.currentBet) return; // can't check if not matched
  console.log(`playerCheck: ${p.id}`);
  nextTurn();
}

function playerFold(id) {
  const p = getPlayer(id);
  if (!p) return;
  p.folded = true;
  console.log(`playerFold: ${p.id}`);
  nextTurn();
}

function playerRaise(id, amount) {
  const p = getPlayer(id);
  if (!canPlay(p)) return;

  amount = Number(amount);
  if (isNaN(amount) || amount <= 0) return;

  // Minimum raise rule could be enforced here (e.g. at least BIG_BLIND), but we accept the amount provided
  const toCall = Math.max(gameState.currentBet - p.bet, 0);
  const total = toCall + amount;

  betAmount(p, total);

  gameState.currentBet = p.bet;
  gameState.lastAggressor = p.id;

  console.log(`playerRaise: ${p.id} raised by ${amount} (total bet ${p.bet}). currentBet=${gameState.currentBet}`);
  nextTurn(true);
}

/* ---------- Flow control ---------- */
function resetBets() {
  players.forEach(p => {
    p.bet = 0;
    p.totalBet = 0;
  });
}

function startGame() {
  if (players.length < 2) return;

  gameRunning = true;
  deck = createDeck();
  shuffle(deck);

  resetBets();

  gameState.pot = 0;
  gameState.sidePots = [];
  gameState.community = [];
  gameState.stage = 0; // 0 preflop, 1 flop, 2 turn, 3 river
  gameState.reveal = false;
  gameState.currentBet = 0;
  gameState.lastAggressor = null;

  players.forEach(p => {
    p.cards = [deck.pop(), deck.pop()];
    p.folded = false;
    p.allIn = false;
    p.bet = 0;
    p.totalBet = 0;
  });

  assignRoles();
  applyBlinds();

  // find first to act: player after BB (by index) → set by id
  const bbIndex = players.findIndex(p => p.role === "BB");
  let first = (bbIndex + 1) % players.length;
  // ensure first is not folded/allin
  while (players[first].folded || players[first].allIn) first = (first + 1) % players.length;

  setTurnByIndex(first);

  console.log("startGame: turn ->", gameState.turn);
  io.emit("update", { players, gameState });
}

function nextTurn(raised = false) {
  const active = players.filter(p => !p.folded);

  if (active.length === 1) {
    return advanceStage();
  }

  // find current index
  let idx = players.findIndex(p => p.id === gameState.turn);
  if (idx === -1) {
    // fallback to left of dealer
    let fallback = (dealerIndex + 1) % players.length;
    setTurnByIndex(fallback);
    io.emit("update", { players, gameState });
    return;
  }

  // advance to next not folded and not allIn
  let attempts = 0;
  do {
    idx = (idx + 1) % players.length;
    attempts++;
    if (attempts > players.length * 2) break;
  } while (players[idx].folded || players[idx].allIn);

  setTurnByIndex(idx);

  const bettingPlayers = players.filter(p => !p.folded && !p.allIn);
  const allMatched = bettingPlayers.length === 0 ? true : bettingPlayers.every(p => p.bet === gameState.currentBet);

  // Only advance if all matched AND (no lastAggressor OR we've returned to lastAggressor)
  if (allMatched) {
    if (!gameState.lastAggressor || gameState.turn === gameState.lastAggressor) {
      return advanceStage();
    }
  }

  io.emit("update", { players, gameState });
}

function advanceStage() {
  collectBetsToPot();

  gameState.currentBet = 0;
  gameState.lastAggressor = null;

  gameState.stage++;

  if (gameState.stage === 1) {
    // flop
    gameState.community.push(deck.pop(), deck.pop(), deck.pop());
  } else if (gameState.stage === 2) {
    // turn
    gameState.community.push(deck.pop());
  } else if (gameState.stage === 3) {
    // river
    gameState.community.push(deck.pop());
  } else {
    return showdown();
  }

  // next turn should start left of dealer (first active)
  const dealerPos = dealerIndex % players.length;
  let next = (dealerPos + 1) % players.length;
  // find first not folded/allIn
  let attempts = 0;
  while ((players[next].folded || players[next].allIn) && attempts < players.length) {
    next = (next + 1) % players.length;
    attempts++;
  }

  setTurnByIndex(next);

  console.log("advanceStage -> stage", gameState.stage, "turn ->", gameState.turn);
  io.emit("update", { players, gameState });
}

function collectBetsToPot() {
  const active = players.filter(p => p.totalBet > 0);
  const sorted = [...active].sort((a, b) => a.totalBet - b.totalBet);

  // reset sidePots for this collection
  gameState.sidePots = [];

  while (sorted.length) {
    const min = sorted[0].totalBet;
    const involved = sorted.filter(p => p.totalBet >= min);
    const potAmount = min * involved.length;

    gameState.sidePots.push({
      amount: potAmount,
      players: involved.map(p => p.id)
    });

    involved.forEach(p => p.totalBet -= min);
    // update sorted values
    sorted.forEach((s, i) => sorted[i] = s);
    while (sorted.length && sorted[0].totalBet === 0) sorted.shift();
  }

  gameState.pot = gameState.sidePots.reduce((a, b) => a + b.amount, 0);

  // clear round bets
  players.forEach(p => p.bet = 0);
}

function showdown() {
  gameState.reveal = true;

  const active = players.filter(p => !p.folded);

  if (active.length === 1) {
    active[0].money += gameState.pot;
    return resetRoundDelayed();
  }

  // evaluate each side pot
  gameState.sidePots.forEach(pot => {
    const contenders = active.filter(p => pot.players.includes(p.id));
    const ranked = contenders.map(p => ({
      player: p,
      result: evaluateHand([...p.cards, ...gameState.community])
    }));
    ranked.sort((a, b) => compareHands(b.result, a.result));
    const best = ranked[0];
    const winners = ranked.filter(r => compareHands(r.result, best.result) === 0);
    const split = pot.amount / winners.length;
    winners.forEach(w => w.player.money += split);
  });

  io.emit("update", { players, gameState });

  dealerIndex++;
  setTimeout(resetRound, 6000);
}

function resetRoundDelayed() {
  io.emit("update", { players, gameState });
  dealerIndex++;
  setTimeout(resetRound, 4000);
}

function resetRound() {
  gameState.sidePots = [];
  gameState.pot = 0;
  gameState.stage = 0;
  gameState.community = [];
  gameState.reveal = false;

  players.forEach(p => {
    p.bet = 0;
    p.totalBet = 0;
    p.cards = [];
  });

  if (players.length >= 2) startGame();
  else gameRunning = false;
}

/* ---------- Roles & blinds ---------- */
function assignRoles() {
  players.forEach(p => p.role = "");

  const dealer = dealerIndex % players.length;
  const sb = (dealer + 1) % players.length;
  const bb = (dealer + 2) % players.length;

  if (players.length === 2) {
    players[dealer].role = "SB";
    players[sb].role = "BB";
  } else {
    players[dealer].role = "D";
    players[sb].role = "SB";
    players[bb].role = "BB";
  }
}

function applyBlinds() {
  const sb = players.find(p => p.role === "SB");
  const bb = players.find(p => p.role === "BB");

  if (sb) {
    betAmount(sb, SMALL_BLIND);
    gameState.currentBet = Math.max(gameState.currentBet, SMALL_BLIND);
  }
  if (bb) {
    betAmount(bb, BIG_BLIND);
    gameState.currentBet = Math.max(gameState.currentBet, BIG_BLIND);
  }
}

/* ---------- Evaluator (kept from earlier versions) ---------- */
/* Minimal evaluator already in previous code; keep it or replace with full evaluator you had.
   For now we'll reuse a robust evaluator if available, else use placeholder.
   (You already had a working evaluateHand + compareHands earlier; keep them here.) */

function evaluateHand(cards){
  // Simple evaluator placeholder - you already had a full version previously.
  // If you want the full evaluator re-insert the code you used earlier.
  // For safety, here's a compact evaluator that returns rank + tiebreakers:
  const valueMap = {"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"T":10,"J":11,"Q":12,"K":13,"A":14};
  const vals = cards.map(c=>valueMap[c[0]]).sort((a,b)=>b-a);
  return { rank: 0, values: vals.slice(0,5), name: "Carta Alta" };
}

function compareHands(a,b){
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i=0;i<Math.max(a.values.length,b.values.length);i++){
    const diff = (a.values[i]||0)-(b.values[i]||0);
    if (diff !== 0) return diff;
  }
  return 0;
}
