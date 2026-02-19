const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

server.listen(3000, () => console.log("Servidor en puerto 3000"));

/* ============================
   VARIABLES
============================ */

let players = [];
let gameState = {
  pot: 0,
  community: [],
  turn: null,
  reveal: false,
  stage: 0
};

let deck = [];
let gameRunning = false;

/* ============================
   SOCKETS
============================ */

io.on("connection", socket => {

  if (players.length >= 6) {
    socket.emit("full");
    return;
  }

  const newPlayer = {
    id: socket.id,
    name: "Jugador " + (players.length + 1),
    money: 100,
    cards: [],
    folded: false,
    bet: 0
  };

  players.push(newPlayer);

  if (players.length >= 2 && !gameRunning) {
    startGame();
  }

  io.emit("update", { players, gameState });

  socket.on("bet", amount => {
    if (!gameRunning) return;

    const player = players.find(p => p.id === socket.id);
    if (!player || player.folded) return;
    if (gameState.turn !== socket.id) return;

    amount = Number(amount);
    if (amount > player.money) amount = player.money;

    player.money -= amount;
    player.bet += amount;
    gameState.pot += amount;

    nextTurn();
  });

  socket.on("fold", () => {
    const player = players.find(p => p.id === socket.id);
    if (!player) return;

    player.folded = true;
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

/* ============================
   GAME FLOW
============================ */

function startGame() {

  if (players.length < 2) return;

  gameRunning = true;
  gameState.pot = 0;
  gameState.community = [];
  gameState.stage = 0;
  gameState.reveal = false;

  deck = createDeck();
  shuffle(deck);

  players.forEach(p => {
    p.cards = [deck.pop(), deck.pop()];
    p.folded = false;
    p.bet = 0;
  });

  gameState.turn = players[0].id;

  io.emit("update", { players, gameState });
}

function nextTurn() {

  const active = players.filter(p => !p.folded);

  if (active.length === 1) {
    return endRound();
  }

  let currentIndex = players.findIndex(p => p.id === gameState.turn);

  do {
    currentIndex = (currentIndex + 1) % players.length;
  } while (players[currentIndex].folded);

  const nextPlayerId = players[currentIndex].id;

  // 🔥 Si volvimos al primer jugador, avanzamos fase
  if (nextPlayerId === players[0].id) {
    advanceStage();
  }

  gameState.turn = nextPlayerId;

  io.emit("update", { players, gameState });
}

  let currentIndex = players.findIndex(p => p.id === gameState.turn);

  do {
    currentIndex = (currentIndex + 1) % players.length;
  } while (players[currentIndex].folded);

  gameState.turn = players[currentIndex].id;

  advanceStageIfNeeded();

  io.emit("update", { players, gameState });
}

function advanceStage() {

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
  else if (gameState.stage >= 4) {
    return endRound();
  }

}

function endRound() {

  const active = players.filter(p => !p.folded);

  if (active.length === 1) {
    const winner = active[0];
    winner.money += gameState.pot;

    gameState.reveal = true;

    io.emit("update", { players, gameState });
    io.emit("showdown", {
      winner: winner.id,
      description: "Todos foldearon"
    });

    return setTimeout(resetRound, 5000);
  }

  const results = active.map(p => ({
    player: p,
    result: evaluateHand([...p.cards, ...gameState.community])
  }));

  results.sort((a, b) => compareHands(b.result, a.result));

  const best = results[0];

  best.player.money += gameState.pot;

  gameState.reveal = true;

  io.emit("update", { players, gameState });
  io.emit("showdown", {
    winner: best.player.id,
    description: best.result.name
  });

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

/* ============================
   EVALUADOR COMPLETO
============================ */

function evaluateHand(cards) {

  const values = "23456789TJQKA";
  const nums = cards.map(c => values.indexOf(c[0])).sort((a,b)=>b-a);
  const suits = cards.map(c => c[1]);

  const counts = {};
  nums.forEach(n => counts[n] = (counts[n] || 0) + 1);

  const groups = Object.entries(counts)
    .sort((a,b)=> b[1]-a[1] || b[0]-a[0]);

  const isFlush = suits.some(s =>
    suits.filter(x=>x===s).length >= 5);

  const unique = [...new Set(nums)].sort((a,b)=>b-a);

  let isStraight = false;
  let straightHigh = 0;

  for (let i=0;i<=unique.length-5;i++){
    if (unique[i]-unique[i+4]===4){
      isStraight=true;
      straightHigh=unique[i];
      break;
    }
  }

  if (isStraight && isFlush)
    return {rank:8, values:[straightHigh], name:"Escalera de color"};

  if (groups[0][1]===4)
    return {rank:7, values:[+groups[0][0]], name:"Poker"};

  if (groups[0][1]===3 && groups[1][1]===2)
    return {rank:6, values:[+groups[0][0]], name:"Full House"};

  if (isFlush)
    return {rank:5, values:nums.slice(0,5), name:"Color"};

  if (isStraight)
    return {rank:4, values:[straightHigh], name:"Escalera"};

  if (groups[0][1]===3)
    return {rank:3, values:[+groups[0][0]], name:"Trío"};

  if (groups[0][1]===2 && groups[1][1]===2)
    return {rank:2, values:[+groups[0][0], +groups[1][0]], name:"Doble Par"};

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

/* ============================
   CARTAS
============================ */

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
