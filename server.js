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

let gameState = {
  pot: 0,
  community: [],
  turn: null,
  reveal: false,
  stage: 0, // 0 preflop | 1 flop | 2 turn | 3 river
  betsThisRound: 0
};

/* =========================
   CONEXIONES
========================= */

io.on("connection", socket => {

  if (players.length >= 6) return;

  const player = {
    id: socket.id,
    name: "Jugador " + (players.length + 1),
    money: 100,
    cards: [],
    folded: false,
    bet: 0
  };

  players.push(player);

  if (players.length >= 2 && !gameRunning) {
    startGame();
  }

  io.emit("update", { players, gameState });

  socket.on("bet", amount => {

    if (!gameRunning) return;
    if (gameState.turn !== socket.id) return;

    const p = players.find(x => x.id === socket.id);
    if (!p || p.folded) return;

    amount = Number(amount);
    if (amount > p.money) amount = p.money;
    if (amount <= 0) return;

    p.money -= amount;
    p.bet += amount;

    gameState.betsThisRound++;

    nextTurn();
  });

  socket.on("check", () => {

    if (gameState.turn !== socket.id) return;

    gameState.betsThisRound++;
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

  if (players.length < 2) return;

  gameRunning = true;

  deck = createDeck();
  shuffle(deck);

  gameState.community = [];
  gameState.pot = 0;
  gameState.stage = 0;
  gameState.reveal = false;
  gameState.betsThisRound = 0;

  players.forEach(p => {
    p.cards = [deck.pop(), deck.pop()];
    p.folded = false;
    p.bet = 0;
  });

  dealerIndex = dealerIndex % players.length;

  // Primer turno = jugador a la izquierda del dealer
  const first = (dealerIndex + 1) % players.length;
  gameState.turn = players[first].id;

  io.emit("update", { players, gameState });
}

/* =========================
   TURNOS
========================= */

function nextTurn() {

  const active = players.filter(p => !p.folded);

  if (active.length === 1) {
    return endRound();
  }

  let currentIndex = players.findIndex(p => p.id === gameState.turn);

  do {
    currentIndex = (currentIndex + 1) % players.length;
  } while (players[currentIndex].folded);

  gameState.turn = players[currentIndex].id;

  // Si todos actuaron → avanzar etapa
  if (gameState.betsThisRound >= active.length) {
    advanceStage();
  }

  io.emit("update", { players, gameState });
}

/* =========================
   ETAPAS
========================= */

function advanceStage() {

  // Mover apuestas al pozo
  players.forEach(p => {
    gameState.pot += p.bet;
    p.bet = 0;
  });

  gameState.betsThisRound = 0;

  gameState.stage++;

  if (gameState.stage === 1) {
    gameState.community.push(deck.pop(), deck.pop(), deck.pop());
  }
  else if (gameState.stage === 2) {
    gameState.community.push(deck.pop());
  }
  else if (gameState.stage === 3) {
    gameState.community.push(deck.pop());
  }
  else if (gameState.stage > 3) {
    return endRound();
  }

  // Nuevo turno empieza desde dealer+1
  const first = (dealerIndex + 1) % players.length;
  gameState.turn = players[first].id;
}

/* =========================
   FINAL
========================= */

function endRound() {

  const active = players.filter(p => !p.folded);

  let winner;

  if (active.length === 1) {
    winner = active[0];
  } else {

    const results = active.map(p => ({
      player: p,
      result: evaluateHand([...p.cards, ...gameState.community])
    }));

    results.sort((a, b) => compareHands(b.result, a.result));

    winner = results[0].player;

    io.emit("showdown", {
      winner: winner.id,
      description: results[0].result.name
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
  });

  if (players.length >= 2) {
    startGame();
  } else {
    gameRunning = false;
  }
}

/* =========================
   EVALUADOR
========================= */

function evaluateHand(cards) {

  const order = "23456789TJQKA";
  const nums = cards.map(c => order.indexOf(c[0])).sort((a,b)=>b-a);
  const suits = cards.map(c => c[1]);

  const counts = {};
  nums.forEach(n => counts[n] = (counts[n] || 0) + 1);

  const groups = Object.entries(counts)
    .sort((a,b)=> b[1]-a[1] || b[0]-a[0]);

  const isFlush = suits.some(s =>
    suits.filter(x=>x===s).length >= 5);

  const unique = [...new Set(nums)].sort((a,b)=>b-a);

  let isStraight = false;
  let high = 0;

  for (let i=0;i<=unique.length-5;i++){
    if (unique[i]-unique[i+4]===4){
      isStraight=true;
      high=unique[i];
      break;
    }
  }

  if (isStraight && isFlush)
    return {rank:8, values:[high], name:"Escalera de color"};

  if (groups[0][1]===4)
    return {rank:7, values:[+groups[0][0]], name:"Poker"};

  if (groups[0][1]===3 && groups[1] && groups[1][1]===2)
    return {rank:6, values:[+groups[0][0]], name:"Full House"};

  if (isFlush)
    return {rank:5, values:nums.slice(0,5), name:"Color"};

  if (isStraight)
    return {rank:4, values:[high], name:"Escalera"};

  if (groups[0][1]===3)
    return {rank:3, values:[+groups[0][0]], name:"Trío"};

  if (groups[0][1]===2 && groups[1] && groups[1][1]===2)
    return {rank:2, values:[+groups[0][0]], name:"Doble Par"};

  if (groups[0][1]===2)
    return {rank:1, values:[+groups[0][0]], name:"Par"};

  return {rank:0, values:nums.slice(0,5), name:"Carta Alta"};
}

function compareHands(a,b){
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i=0;i<a.values.length;i++){
    if ((a.values[i]||0)!==(b.values[i]||0))
      return (a.values[i]||0)-(b.values[i]||0);
  }
  return 0;
}

/* =========================
   CARTAS
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

