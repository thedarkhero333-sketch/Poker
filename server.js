const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
server.listen(process.env.PORT || 3000);

const SMALL_BLIND = 5;
const BIG_BLIND = 10;

let players = [];
let deck = [];
let dealerIndex = 0;
let currentTurnIndex = 0;
let gameRunning = false;

let gameState = {
  pot: 0,
  community: [],
  reveal: false,
  stage: 0,
  currentBet: 0
};

/* =========================
   CONEXIONES
========================= */

io.on("connection", socket => {

  if (players.length >= 6) return;

  players.push({
    id: socket.id,
    name: "Jugador " + (players.length + 1),
    money: 100,
    cards: [],
    folded: false,
    bet: 0,
    role: ""
  });

  if (players.length >= 2 && !gameRunning) {
    startGame();
  }

  io.emit("update", { players, gameState });

  socket.on("bet", amount => {

    if (!gameRunning) return;

    const player = players[currentTurnIndex];
    if (!player || player.id !== socket.id) return;

    amount = Number(amount);

    if (amount < gameState.currentBet - player.bet) return;

    const toPay = amount;
    if (toPay > player.money) return;

    player.money -= toPay;
    player.bet += toPay;

    nextTurn();
  });

  socket.on("fold", () => {

    const player = players[currentTurnIndex];
    if (!player || player.id !== socket.id) return;

    player.folded = true;
    nextTurn();
  });

  socket.on("disconnect", () => {
    players = players.filter(p => p.id !== socket.id);
    if (players.length < 2) gameRunning = false;
    io.emit("update", { players, gameState });
  });
});

/* =========================
   GAME START
========================= */

function startGame() {

  if (players.length < 2) return;

  gameRunning = true;
  gameState.community = [];
  gameState.pot = 0;
  gameState.stage = 0;
  gameState.reveal = false;
  gameState.currentBet = BIG_BLIND;

  deck = createDeck();
  shuffle(deck);

  rotateDealer();
  assignRoles();
  postBlinds();

  players.forEach(p => {
    p.cards = [deck.pop(), deck.pop()];
    p.folded = false;
  });

  currentTurnIndex = (dealerIndex + 3) % players.length;
  if (players.length === 2)
    currentTurnIndex = (dealerIndex + 1) % players.length;

  io.emit("update", { players, gameState });
}

/* =========================
   BLINDS Y ROLES
========================= */

function rotateDealer() {
  dealerIndex = (dealerIndex + 1) % players.length;
}

function assignRoles() {

  players.forEach(p => p.role = "");

  players[dealerIndex].role = "D";

  if (players.length === 2) {
    players[dealerIndex].role = "D/SB";
    players[(dealerIndex + 1) % 2].role = "BB";
    return;
  }

  players[(dealerIndex + 1) % players.length].role = "SB";
  players[(dealerIndex + 2) % players.length].role = "BB";
}

function postBlinds() {

  if (players.length === 2) {

    const sb = players[dealerIndex];
    const bb = players[(dealerIndex + 1) % 2];

    sb.money -= SMALL_BLIND;
    sb.bet = SMALL_BLIND;

    bb.money -= BIG_BLIND;
    bb.bet = BIG_BLIND;

  } else {

    const sb = players[(dealerIndex + 1) % players.length];
    const bb = players[(dealerIndex + 2) % players.length];

    sb.money -= SMALL_BLIND;
    sb.bet = SMALL_BLIND;

    bb.money -= BIG_BLIND;
    bb.bet = BIG_BLIND;
  }
}

/* =========================
   TURNOS
========================= */

function nextTurn() {

  let active = players.filter(p => !p.folded);

  if (active.length === 1)
    return endRound();

  currentTurnIndex = (currentTurnIndex + 1) % players.length;

  while (players[currentTurnIndex].folded)
    currentTurnIndex = (currentTurnIndex + 1) % players.length;

  checkRoundEnd();

  io.emit("update", { players, gameState });
}

function checkRoundEnd() {

  const active = players.filter(p => !p.folded);

  const allMatched = active.every(p => p.bet === gameState.currentBet);

  if (!allMatched) return;

  // 🔥 ahora sí sumamos al pozo
  active.forEach(p => {
    gameState.pot += p.bet;
    p.bet = 0;
  });

  gameState.currentBet = 0;
  advanceStage();
}

/* =========================
   FASES
========================= */

function advanceStage() {

  gameState.stage++;

  if (gameState.stage === 1)
    gameState.community.push(deck.pop(), deck.pop(), deck.pop());
  else if (gameState.stage === 2)
    gameState.community.push(deck.pop());
  else if (gameState.stage === 3)
    gameState.community.push(deck.pop());
  else
    return endRound();
}

/* =========================
   FIN DE RONDA
========================= */

function endRound() {

  const active = players.filter(p => !p.folded);

  let winner = active[0];
  winner.money += gameState.pot;

  gameState.reveal = true;

  io.emit("update", { players, gameState });

  setTimeout(() => {
    startGame();
  }, 5000);
}

/* =========================
   UTILIDADES
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
