const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
server.listen(process.env.PORT || 3000);

let players = [];
let deck = [];
let gameRunning = false;
let dealerIndex = 0;

const SMALL_BLIND = 5;
const BIG_BLIND = 10;

let gameState = {
  pot: 0,
  community: [],
  turn: null,
  reveal: false,
  stage: 0,
  currentBet: 0
};

/* =========================
   CONEXIONES
========================= */

io.on("connection", socket => {

  if (players.find(p => p.id === socket.id)) return;
  if (players.length >= 6) return;

  const player = {
    id: socket.id,
    name: "Jugador " + (players.length + 1),
    money: 100,
    cards: [],
    folded: false,
    bet: 0,
    role: ""
  };

  players.push(player);

  if (players.length >= 2 && !gameRunning) {
    startGame();
  }

  io.emit("update", { players, gameState });

  socket.on("call", () => {

    if (!gameRunning) return;
    if (gameState.turn !== socket.id) return;

    const p = players.find(x => x.id === socket.id);
    if (!p || p.folded) return;

    const toCall = gameState.currentBet - p.bet;
    if (toCall <= 0) return;

    const amount = Math.min(toCall, p.money);

    p.money -= amount;
    p.bet += amount;

    nextTurn();
  });

  socket.on("check", () => {

    if (gameState.turn !== socket.id) return;

    const p = players.find(x => x.id === socket.id);
    if (!p) return;

    if (p.bet !== gameState.currentBet) return;

    nextTurn();
  });

  socket.on("fold", () => {

    const p = players.find(x => x.id === socket.id);
    if (!p) return;

    p.folded = true;
    nextTurn();
  });

  socket.on("disconnect", () => {

    players = players.filter(p => p.id !== socket.id);

    if (players.length < 2) {
      gameRunning = false;
      gameState.turn = null;
    }

    io.emit("update", { players, gameState });
  });
});

/* =========================
   INICIO
========================= */

function startGame() {

  gameRunning = true;

  deck = createDeck();
  shuffle(deck);

  gameState.community = [];
  gameState.pot = 0;
  gameState.stage = 0;
  gameState.reveal = false;
  gameState.currentBet = BIG_BLIND;

  players.forEach(p => {
    p.cards = [deck.pop(), deck.pop()];
    p.folded = false;
    p.bet = 0;
    p.role = "";
  });

  assignRoles();
  applyBlinds();

  const bbIndex = players.findIndex(p => p.role === "BB");
  const first = (bbIndex + 1) % players.length;
  gameState.turn = players[first].id;

  io.emit("update", { players, gameState });
}

/* =========================
   ROLES
========================= */

function assignRoles() {

  players.forEach(p => p.role = "");

  const dealer = dealerIndex % players.length;
  const sb = (dealer + 1) % players.length;
  const bb = (dealer + 2) % players.length;

  players[dealer].role = "D";
  players[sb].role = "SB";
  players[bb].role = "BB";
}

function applyBlinds() {

  const sb = players.find(p => p.role === "SB");
  const bb = players.find(p => p.role === "BB");

  if (sb) {
    sb.money -= SMALL_BLIND;
    sb.bet = SMALL_BLIND;
  }

  if (bb) {
    bb.money -= BIG_BLIND;
    bb.bet = BIG_BLIND;
  }
}

/* =========================
   TURNOS
========================= */

function nextTurn() {

  const active = players.filter(p => !p.folded);

  if (active.length === 1) {
    return endRound();
  }

  const allMatched = active.every(p => p.bet === gameState.currentBet);

  if (allMatched) {
    return advanceStage();
  }

  let currentIndex = players.findIndex(p => p.id === gameState.turn);

  do {
    currentIndex = (currentIndex + 1) % players.length;
  } while (players[currentIndex].folded);

  gameState.turn = players[currentIndex].id;

  io.emit("update", { players, gameState });
}

/* =========================
   ETAPAS
========================= */

function advanceStage() {

  players.forEach(p => {
    gameState.pot += p.bet;
    p.bet = 0;
  });

  gameState.currentBet = 0;
  gameState.stage++;

  if (gameState.stage === 1)
    gameState.community.push(deck.pop(), deck.pop(), deck.pop());
  else if (gameState.stage === 2)
    gameState.community.push(deck.pop());
  else if (gameState.stage === 3)
    gameState.community.push(deck.pop());
  else
    return endRound();

  const dealerPos = dealerIndex % players.length;
  const first = (dealerPos + 1) % players.length;
  gameState.turn = players[first].id;

  io.emit("update", { players, gameState });
}

/* =========================
   FINAL
========================= */

function endRound() {

  const active = players.filter(p => !p.folded);
  let winner;
  let bestResult;

  if (active.length === 1) {
    winner = active[0];
  } else {

    const results = active.map(p => ({
      player: p,
      result: evaluateHand([...p.cards, ...gameState.community])
    }));

    results.sort((a, b) => compareHands(b.result, a.result));

    winner = results[0].player;
    bestResult = results[0].result;

    io.emit("showdown", {
      winner: winner.id,
      description: bestResult.name
    });
  }

  winner.money += gameState.pot;
  gameState.reveal = true;

  io.emit("update", { players, gameState });

  dealerIndex++;

  setTimeout(resetRound, 5000);
}

function resetRound() {

  gameState.community = [];
  gameState.pot = 0;
  gameState.stage = 0;
  gameState.turn = null;
  gameState.reveal = false;

  players.forEach(p => {
    p.cards = [];
    p.folded = false;
    p.bet = 0;
    p.role = "";
  });

  if (players.length >= 2)
    startGame();
  else
    gameRunning = false;
}

/* =========================
   CARTAS + EVALUADOR REAL
========================= */

function createDeck(){
  const suits=["♠","♥","♦","♣"];
  const values=["2","3","4","5","6","7","8","9","T","J","Q","K","A"];
  let d=[];
  for (let s of suits)
    for (let v of values)
      d.push(v+s);
  return d;
}

function shuffle(array){
  for (let i=array.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [array[i],array[j]]=[array[j],array[i]];
  }
}

function evaluateHand(cards){

  const valueMap = {
    "2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,
    "T":10,"J":11,"Q":12,"K":13,"A":14
  };

  const values = cards.map(c => valueMap[c[0]]);
  const suits = cards.map(c => c[1]);

  const counts = {};
  values.forEach(v => counts[v] = (counts[v] || 0) + 1);

  const uniqueVals = [...new Set(values)].sort((a,b)=>b-a);
  const sortedVals = values.slice().sort((a,b)=>b-a);

  const isFlush = suits.some(s =>
    suits.filter(x=>x===s).length >=5
  );

  const sortedAsc = [...new Set(values)].sort((a,b)=>a-b);

  let isStraight = false;
  let straightHigh = 0;

  for(let i=0;i<sortedAsc.length-4;i++){
    if(
      sortedAsc[i]+1===sortedAsc[i+1] &&
      sortedAsc[i]+2===sortedAsc[i+2] &&
      sortedAsc[i]+3===sortedAsc[i+3] &&
      sortedAsc[i]+4===sortedAsc[i+4]
    ){
      isStraight = true;
      straightHigh = sortedAsc[i+4];
    }
  }

  if(sortedAsc.includes(14) &&
     sortedAsc.includes(2) &&
     sortedAsc.includes(3) &&
     sortedAsc.includes(4) &&
     sortedAsc.includes(5)){
    isStraight = true;
    straightHigh = 5;
  }

  const pairs = [];
  const trips = [];
  const quads = [];

  for(let v in counts){
    if(counts[v]===2) pairs.push(+v);
    if(counts[v]===3) trips.push(+v);
    if(counts[v]===4) quads.push(+v);
  }

  pairs.sort((a,b)=>b-a);
  trips.sort((a,b)=>b-a);
  quads.sort((a,b)=>b-a);

  if(isStraight && isFlush)
    return {rank:8, values:[straightHigh], name:"Escalera de Color"};

  if(quads.length)
    return {rank:7, values:[quads[0]], name:"Poker"};

  if(trips.length && pairs.length)
    return {rank:6, values:[trips[0]], name:"Full House"};

  if(isFlush)
    return {rank:5, values:sortedVals, name:"Color"};

  if(isStraight)
    return {rank:4, values:[straightHigh], name:"Escalera"};

  if(trips.length)
    return {rank:3, values:[trips[0]], name:"Trio"};

  if(pairs.length>=2)
    return {rank:2, values:[pairs[0],pairs[1]], name:"Doble Par"};

  if(pairs.length)
    return {rank:1, values:[pairs[0]], name:"Par"};

  return {rank:0, values:sortedVals, name:"Carta Alta"};
}

function compareHands(a,b){

  if(a.rank !== b.rank)
    return a.rank - b.rank;

  for(let i=0;i<Math.max(a.values.length,b.values.length);i++){
    const diff = (a.values[i]||0) - (b.values[i]||0);
    if(diff !== 0) return diff;
  }

  return 0;
}
