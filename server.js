const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + "/public"));

let players = [];
let gameState = {
  phase: "waiting",
  pot: 0,
  community: [],
  turnIndex: 0
};

let deck = [];

function createDeck() {
  const suits = ["♠","♥","♦","♣"];
  const values = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
  deck = [];
  for (let s of suits) {
    for (let v of values) {
      deck.push(v+s);
    }
  }
}

function shuffle() {
  deck.sort(() => Math.random() - 0.5);
}

function startGame() {
  if (players.filter(p => p.active).length < 2) return;

  createDeck();
  shuffle();

  gameState.phase = "preflop";
  gameState.pot = 0;
  gameState.community = [];
  gameState.turnIndex = 0;

  players.forEach(p => {
    if (p.waiting) {
      p.waiting = false;
    }
    if (p.money > 0) {
      p.active = true;
      p.folded = false;
      p.bet = 0;
      p.cards = [deck.pop(), deck.pop()];
    }
  });

  io.emit("update", { players, gameState });
}

function nextPhase() {
  if (gameState.phase === "preflop") {
    gameState.phase = "flop";
    gameState.community.push(deck.pop(), deck.pop(), deck.pop());
  } else if (gameState.phase === "flop") {
    gameState.phase = "turn";
    gameState.community.push(deck.pop());
  } else if (gameState.phase === "turn") {
    gameState.phase = "river";
    gameState.community.push(deck.pop());
  } else {
    endHand();
    return;
  }

  players.forEach(p => p.bet = 0);
  gameState.turnIndex = 0;
  io.emit("update", { players, gameState });
}

function endHand() {
  let activePlayers = players.filter(p => p.active && !p.folded);
  if (activePlayers.length === 0) return;

  let winner = activePlayers[Math.floor(Math.random() * activePlayers.length)];
  winner.money += gameState.pot;

  io.emit("message", winner.name + " ganó $" + gameState.pot);

  gameState.phase = "waiting";
  setTimeout(startGame, 5000);
}

io.on("connection", socket => {

  if (players.length >= 6) {
    socket.emit("message", "Mesa llena");
    return;
  }

  const newPlayer = {
    id: socket.id,
    name: "Jugador " + (players.length + 1),
    money: 100,
    cards: [],
    bet: 0,
    folded: false,
    active: false,
    waiting: gameState.phase !== "waiting"
  };

  players.push(newPlayer);

  if (players.length >= 2 && gameState.phase === "waiting") {
    setTimeout(startGame, 3000);
  }

  io.emit("update", { players, gameState });

  socket.on("bet", amount => {
    let player = players.find(p => p.id === socket.id);
    if (!player || player.folded || player.money <= 0) return;

    if (amount > player.money) amount = player.money;

    player.money -= amount;
    player.bet += amount;
    gameState.pot += amount;

    gameState.turnIndex++;

    if (gameState.turnIndex >= players.filter(p=>p.active && !p.folded).length) {
      nextPhase();
    }

    io.emit("update", { players, gameState });
  });

  socket.on("fold", () => {
    let player = players.find(p => p.id === socket.id);
    if (!player) return;
    player.folded = true;
    gameState.turnIndex++;
    io.emit("update", { players, gameState });
  });

  socket.on("disconnect", () => {
    players = players.filter(p => p.id !== socket.id);
    io.emit("update", { players, gameState });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Servidor iniciado"));
