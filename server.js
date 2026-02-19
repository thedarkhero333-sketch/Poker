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
let dealerIndex = 0;
let gameRunning = false;

const SMALL_BLIND = 5;
const BIG_BLIND = 10;

let gameState = {
  pot: 0,
  sidePots: [],
  community: [],
  turn: null,
  stage: 0,
  reveal: false,
  currentBet: 0,
  lastAggressor: null
};

/* =========================
   CONEXION
========================= */

io.on("connection", socket => {

  if (players.length >= 6) return;

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

  if (players.length >= 2 && !gameRunning)
    startGame();

  io.emit("update", { players, gameState });

  socket.on("call", () => playerCall(socket.id));
  socket.on("check", () => playerCheck(socket.id));
  socket.on("fold", () => playerFold(socket.id));
  socket.on("raise", amount => playerRaise(socket.id, amount));

  socket.on("disconnect", () => {
    players = players.filter(p => p.id !== socket.id);
    if (players.length < 2) gameRunning = false;
    io.emit("update", { players, gameState });
  });

});

/* =========================
   ACCIONES
========================= */

function playerCall(id){
  const p = getPlayer(id);
  if (!canPlay(p)) return;

  const toCall = gameState.currentBet - p.bet;
  betAmount(p, toCall);
  nextTurn();
}

function playerCheck(id){
  const p = getPlayer(id);
  if (!canPlay(p)) return;
  if (p.bet !== gameState.currentBet) return;
  nextTurn();
}

function playerFold(id){
  const p = getPlayer(id);
  if (!p) return;
  p.folded = true;
  nextTurn();
}

function playerRaise(id, amount){
  const p = getPlayer(id);
  if (!canPlay(p)) return;

  amount = Number(amount);
  const toCall = gameState.currentBet - p.bet;
  const total = toCall + amount;

  betAmount(p, total);

  gameState.currentBet = p.bet;
  gameState.lastAggressor = p.id;

  nextTurn(true);
}

function betAmount(player, amount){
  if (amount >= player.money){
    amount = player.money;
    player.allIn = true;
  }

  player.money -= amount;
  player.bet += amount;
  player.totalBet += amount;
}

/* =========================
   FLUJO
========================= */

function startGame(){

  gameRunning = true;
  deck = createDeck();
  shuffle(deck);

  resetBets();
  gameState.pot = 0;
  gameState.sidePots = [];
  gameState.community = [];
  gameState.stage = 0;
  gameState.reveal = false;
  gameState.currentBet = BIG_BLIND;
  gameState.lastAggressor = null;

  players.forEach(p=>{
    p.cards=[deck.pop(),deck.pop()];
    p.folded=false;
    p.allIn=false;
  });

  assignRoles();
  applyBlinds();

  const bbIndex = players.findIndex(p=>p.role==="BB");
  const first = (bbIndex+1)%players.length;
  gameState.turn = players[first].id;

  io.emit("update",{players,gameState});
}

function nextTurn(raised=false){

  const active = players.filter(p=>!p.folded && !p.allIn);

  if (active.length<=1)
    return advanceStage();

  let idx = players.findIndex(p=>p.id===gameState.turn);

  do{
    idx=(idx+1)%players.length;
  }while(players[idx].folded || players[idx].allIn);

  gameState.turn = players[idx].id;

  const allMatched = players
    .filter(p=>!p.folded && !p.allIn)
    .every(p=>p.bet===gameState.currentBet);

  if (allMatched && gameState.lastAggressor===players[idx].id){
    return advanceStage();
  }

  io.emit("update",{players,gameState});
}

function advanceStage(){

  collectBetsToPot();

  gameState.currentBet=0;
  gameState.lastAggressor=null;

  gameState.stage++;

  if (gameState.stage===1)
    gameState.community.push(deck.pop(),deck.pop(),deck.pop());
  else if (gameState.stage===2)
    gameState.community.push(deck.pop());
  else if (gameState.stage===3)
    gameState.community.push(deck.pop());
  else
    return showdown();

  const dealerPos=dealerIndex%players.length;
  gameState.turn=players[(dealerPos+1)%players.length].id;

  io.emit("update",{players,gameState});
}

function collectBetsToPot(){

  const active = players.filter(p=>p.totalBet>0);

  const sorted=[...active].sort((a,b)=>a.totalBet-b.totalBet);

  while(sorted.length){

    const min=sorted[0].totalBet;
    const involved=sorted.filter(p=>p.totalBet>=min);

    const potAmount=min*involved.length;

    gameState.sidePots.push({
      amount:potAmount,
      players:involved.map(p=>p.id)
    });

    involved.forEach(p=>p.totalBet-=min);
    sorted.forEach(p=>p.totalBet-=min);

    while(sorted.length && sorted[0].totalBet===0)
      sorted.shift();
  }

  gameState.pot = gameState.sidePots.reduce((a,b)=>a+b.amount,0);

  players.forEach(p=>p.bet=0);
}

/* =========================
   SHOWDOWN
========================= */

function showdown(){

  gameState.reveal=true;

  const active = players.filter(p=>!p.folded);

  gameState.sidePots.forEach(pot=>{

    const contenders = active.filter(p=>pot.players.includes(p.id));

    const ranked = contenders.map(p=>({
      player:p,
      result:evaluateHand([...p.cards,...gameState.community])
    }));

    ranked.sort((a,b)=>compareHands(b.result,a.result));

    const best = ranked[0];
    const winners = ranked.filter(r=>
      compareHands(r.result,best.result)===0
    );

    const split = pot.amount / winners.length;

    winners.forEach(w=>w.player.money+=split);
  });

  io.emit("update",{players,gameState});

  dealerIndex++;

  setTimeout(resetRound,6000);
}

function resetRound(){

  gameState.sidePots=[];
  gameState.pot=0;
  gameState.stage=0;
  gameState.community=[];
  gameState.reveal=false;

  players.forEach(p=>{
    p.bet=0;
    p.totalBet=0;
    p.cards=[];
  });

  if(players.length>=2)
    startGame();
  else
    gameRunning=false;
}

/* =========================
   ROLES
========================= */

function assignRoles(){

  players.forEach(p=>p.role="");

  const dealer=dealerIndex%players.length;
  const sb=(dealer+1)%players.length;
  const bb=(dealer+2)%players.length;

  if(players.length===2){
    players[dealer].role="SB";
    players[sb].role="BB";
  }else{
    players[dealer].role="D";
    players[sb].role="SB";
    players[bb].role="BB";
  }
}

function applyBlinds(){

  const sb=players.find(p=>p.role==="SB");
  const bb=players.find(p=>p.role==="BB");

  if(sb) betAmount(sb,SMALL_BLIND);
  if(bb) betAmount(bb,BIG_BLIND);
}

/* =========================
   UTILS
========================= */

function getPlayer(id){
  return players.find(p=>p.id===id);
}

function canPlay(p){
  return p && !p.folded && !p.allIn && gameState.turn===p.id;
}

function resetBets(){
  players.forEach(p=>{
    p.bet=0;
    p.totalBet=0;
  });
}

/* =========================
   DECK
========================= */

function createDeck(){
  const suits=["♠","♥","♦","♣"];
  const values=["2","3","4","5","6","7","8","9","T","J","Q","K","A"];
  let d=[];
  for(let s of suits)
    for(let v of values)
      d.push(v+s);
  return d;
}

function shuffle(a){
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
}
