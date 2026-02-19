const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

server.listen(3000, () => {
  console.log("Servidor corriendo en puerto 3000");
});

let players = [];
let gameState = {
  started: false,
  turn: null,
  pot: 0,
  community: [],
  reveal: false,
  dealerIndex: 0,
  currentBet: 0,
  stage: "waiting"
};

const MAX_PLAYERS = 6;
const SMALL_BLIND = 5;
const BIG_BLIND = 10;

io.on("connection", socket => {

  if (players.find(p => p.id === socket.id)) return;
  if (players.length >= MAX_PLAYERS) return;

  players.push({
    id: socket.id,
    name: "Jugador " + (players.length + 1),
    money: 100,
    cards: [],
    bet: 0,
    folded: false
  });

  io.emit("update", { players, gameState });

  if (players.length >= 2 && !gameState.started) {
    startRound();
  }

  socket.on("bet", amount => handleBet(socket.id, amount));
  socket.on("fold", () => handleFold(socket.id));

  socket.on("disconnect", () => {
    players = players.filter(p => p.id !== socket.id);
    if (players.length < 2) resetGame();
    io.emit("update", { players, gameState });
  });
});

function resetGame() {
  gameState.started = false;
  gameState.stage = "waiting";
  gameState.pot = 0;
  gameState.community = [];
  gameState.reveal = false;
}

function createDeck() {
  const suits = ["♠", "♥", "♦", "♣"];
  const values = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
  let deck = [];

  for (let s of suits)
    for (let v of values)
      deck.push(v + s);

  return deck.sort(() => Math.random() - 0.5);
}

function startRound() {

  gameState.started = true;
  gameState.stage = "preflop";
  gameState.community = [];
  gameState.pot = 0;
  gameState.reveal = false;
  gameState.currentBet = BIG_BLIND;

  let deck = createDeck();

  players.forEach(p => {
    p.cards = [deck.pop(), deck.pop()];
    p.bet = 0;
    p.folded = false;
  });

  assignBlinds();

  gameState.deck = deck;

  io.emit("update", { players, gameState });
}

function assignBlinds() {

  if (players.length < 2) return;

  let sbIndex = (gameState.dealerIndex + 1) % players.length;
  let bbIndex = (gameState.dealerIndex + 2) % players.length;

  if (players.length === 2) {
    sbIndex = gameState.dealerIndex;
    bbIndex = (gameState.dealerIndex + 1) % 2;
  }

  players[sbIndex].money -= SMALL_BLIND;
  players[sbIndex].bet = SMALL_BLIND;

  players[bbIndex].money -= BIG_BLIND;
  players[bbIndex].bet = BIG_BLIND;

  gameState.turn = (bbIndex + 1) % players.length;
}

function handleBet(id, amount) {

  const player = players.find(p => p.id === id);
  if (!player || player.folded) return;
  if (players[gameState.turn].id !== id) return;

  if (amount === 0) {
    if (player.bet === gameState.currentBet) {
      nextTurn();
    }
    return;
  }

  if (amount !== SMALL_BLIND && amount !== BIG_BLIND) return;
  if (player.money < amount) return;

  player.money -= amount;
  player.bet += amount;

  if (player.bet > gameState.currentBet)
    gameState.currentBet = player.bet;

  nextTurn();
}

function handleFold(id) {

  const player = players.find(p => p.id === id);
  if (!player) return;

  player.folded = true;

  const active = players.filter(p => !p.folded);

  if (active.length === 1) {
    endRound(active[0]);
    return;
  }

  nextTurn();
}

function nextTurn() {

  let count = players.length;

  for (let i = 1; i <= count; i++) {
    let next = (gameState.turn + i) % count;
    if (!players[next].folded) {
      gameState.turn = next;
      break;
    }
  }

  if (allBetsEqual()) {
    advanceStage();
  }

  io.emit("update", { players, gameState });
}

function allBetsEqual() {
  const active = players.filter(p => !p.folded);
  return active.every(p => p.bet === gameState.currentBet);
}

function advanceStage() {

  players.forEach(p => {
    gameState.pot += p.bet;
    p.bet = 0;
  });

  gameState.currentBet = 0;

  if (gameState.stage === "preflop") {
    gameState.community.push(
      gameState.deck.pop(),
      gameState.deck.pop(),
      gameState.deck.pop()
    );
    gameState.stage = "flop";
  }
  else if (gameState.stage === "flop") {
    gameState.community.push(gameState.deck.pop());
    gameState.stage = "turn";
  }
  else if (gameState.stage === "turn") {
    gameState.community.push(gameState.deck.pop());
    gameState.stage = "river";
  }
  else {
    showdown();
    return;
  }

  gameState.turn = (gameState.dealerIndex + 1) % players.length;

  io.emit("update", { players, gameState });
}

function showdown() {

  gameState.reveal = true;

  // 🔥 TEMPORAL: ganador random hasta que hagamos evaluación real
  const active = players.filter(p => !p.folded);
  const winner = active[Math.floor(Math.random() * active.length)];

  winner.money += gameState.pot;

  io.emit("showdown", {
    winner: winner.id,
    description: "Mejor mano (modo demo)"
  });

  setTimeout(() => {
    endRound(winner);
  }, 5000);
}

function endRound(winner) {

  gameState.pot = 0;
  gameState.community = [];
  gameState.reveal = false;
  gameState.started = false;

  gameState.dealerIndex = (gameState.dealerIndex + 1) % players.length;

  if (players.length >= 2) {
    startRound();
  } else {
    resetGame();
  }

  io.emit("update", { players, gameState });
}
