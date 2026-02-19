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

  if (players.length >= 2 && !gameRunning)
    startGame();

  io.emit("update", { players, gameState });

  socket.on("bet", amount => {

    if (!gameRunning) return;
    if (gameState.turn !== socket.id) return;

    const p = players.find(x => x.id === socket.id);
    if (!p || p.folded) return;

    amount = Number(amount);

    const toCall = gameState.currentBet - p.bet;

    if (amount < toCall) return; // no puede apostar menos que igualar

    if (amount > p.money) amount = p.money;

    p.money -= amount;
    p.bet += amount;

    if (p.bet > gameState.currentBet)
      gameState.currentBet = p.bet;

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

  gameState.pot = 0;
  gameState.community = [];
  gameState.stage = 0;
  gameState.reveal = false;
  gameState.currentBet = BIG_BLIND;

  deck = createDeck();
  shuffle(deck);

  players.forEach(p => {
    p.cards = [deck.pop(), deck.pop()];
    p.folded = false;
    p.bet = 0;
    p.role = "";
  });

  assignRoles();
  applyBlinds();

  // empieza el jugador después de BB
  const bbIndex = players.findIndex(p => p.role === "BB");
  const first = (bbIndex + 1) % players.length;
  gameState.turn = players[first].id;

  io.emit("update", { players, gameState });
}

/* =========================
   ROLES (ROTATIVOS)
========================= */

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

  if (active.length === 1)
    return endRound();

  const allMatched = active.every(p => p.bet === gameState.currentBet);

  if (allMatched)
    return advanceStage();

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

  // sumar apuestas al pozo recién ahora
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

  if (active.length === 1) {
    winner = active[0];
  } else {

    const results = active.map(p => ({
      player: p,
      result: evaluateHand([...p.cards, ...gameState.community])
    }));

    results.sort((a,b)=>compareHands(b.result,a.result));

    winner = results[0].player;

    io.emit("showdown", {
      winner: winner.id,
      description: results[0].result.name
    });
  }

  winner.money += gameState.pot;

  gameState.reveal = true;

  io.emit("update", { players, gameState });

  dealerIndex++; // 🔥 rota dealer

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
