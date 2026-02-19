    const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const MAX_PLAYERS = 6;
const START_MONEY = 100;
const SMALL_BLIND = 5;
const BIG_BLIND = 10;

let players = [];
let deck = [];
let community = [];
let pot = 0;
let phase = "waiting";
let turnIndex = 0;
let dealerIndex = 0;
let currentBet = 0;
let betsThisRound = 0;

function createDeck() {
  const suits = ["♠","♥","♦","♣"];
  const values = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
  deck = [];
  for (let s of suits)
    for (let v of values)
      deck.push(v + s);

  deck.sort(() => Math.random() - 0.5);
}

function nextActivePlayer(index){
  let i = index;
  do{
    i = (i + 1) % players.length;
  }while(!players[i].active);
  return i;
}

function startGame(){
  if(players.length < 2) return;

  createDeck();
  community = [];
  pot = 0;
  currentBet = BIG_BLIND;
  betsThisRound = 0;
  phase = "preflop";

  players.forEach(p=>{
    p.cards = [deck.pop(), deck.pop()];
    p.active = true;
    p.bet = 0;
  });

  dealerIndex = (dealerIndex + 1) % players.length;

  const sb = nextActivePlayer(dealerIndex);
  const bb = nextActivePlayer(sb);

  players[sb].money -= SMALL_BLIND;
  players[bb].money -= BIG_BLIND;
  players[sb].bet = SMALL_BLIND;
  players[bb].bet = BIG_BLIND;

  pot = SMALL_BLIND + BIG_BLIND;
  turnIndex = nextActivePlayer(bb);

  io.emit("message", "Nueva ronda iniciada");
  updateState();
}

function advancePhase(){
  betsThisRound = 0;
  players.forEach(p=>p.bet=0);
  currentBet = 0;

  if(phase==="preflop"){
    phase="flop";
    community.push(deck.pop(), deck.pop(), deck.pop());
  }else if(phase==="flop"){
    phase="turn";
    community.push(deck.pop());
  }else if(phase==="turn"){
    phase="river";
    community.push(deck.pop());
  }else{
    determineWinner();
    return;
  }

  turnIndex = nextActivePlayer(dealerIndex);
  updateState();
}

function determineWinner(){
  const activePlayers = players.filter(p=>p.active);
  const winner = activePlayers[Math.floor(Math.random()*activePlayers.length)];
  winner.money += pot;

  io.emit("message", winner.name + " ganó el pozo de $" + pot);

  setTimeout(()=>{
    if(players.filter(p=>p.money>0).length>=2){
      startGame();
    }else{
      phase="waiting";
      io.emit("message","Esperando más jugadores");
      updateState();
    }
  },3000);
}

function updateState(){
  io.emit("update",{
    players,
    gameState:{
      community,
      pot,
      phase,
      turn: players[turnIndex]?.id
    }
  });
}

io.on("connection",(socket)=>{

  if(players.length>=MAX_PLAYERS){
    socket.emit("message","Mesa llena");
    return;
  }

  const newPlayer={
    id:socket.id,
    name:"Jugador "+(players.length+1),
    money:START_MONEY,
    cards:[],
    active:true,
    bet:0
  };

  players.push(newPlayer);

  if(players.length>=2 && phase==="waiting"){
    startGame();
  }

  updateState();

  socket.on("bet",(amount)=>{
    const player = players.find(p=>p.id===socket.id);
    if(!player || players[turnIndex].id!==socket.id) return;

    if(amount===9999) amount = player.money;

    if(amount < currentBet) return;

    if(amount>player.money) amount=player.money;

    player.money -= amount;
    player.bet += amount;
    pot += amount;
    currentBet = player.bet;

    betsThisRound++;

    turnIndex = nextActivePlayer(turnIndex);

    if(betsThisRound>=players.filter(p=>p.active).length){
      advancePhase();
    }

    updateState();
  });

  socket.on("fold",()=>{
    const player = players.find(p=>p.id===socket.id);
    if(!player || players[turnIndex].id!==socket.id) return;

    player.active=false;

    if(players.filter(p=>p.active).length===1){
      determineWinner();
      return;
    }

    turnIndex = nextActivePlayer(turnIndex);
    updateState();
  });

  socket.on("disconnect",()=>{
    players = players.filter(p=>p.id!==socket.id);
    updateState();
  });

});

server.listen(3000,()=>console.log("Servidor activo"));
