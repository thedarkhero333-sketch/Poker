const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const MAX_PLAYERS = 6;
const START_MONEY = 100;

let players = [];
let deck = [];
let community = [];
let pot = 0;
let phase = "waiting";
let turnIndex = 0;
let currentBet = 0;
let betsThisRound = 0;

const valuesOrder = {
  "2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,
  "J":11,"Q":12,"K":13,"A":14
};

function createDeck(){
  const suits = ["♠","♥","♦","♣"];
  const values = Object.keys(valuesOrder);
  deck=[];
  for(let s of suits)
    for(let v of values)
      deck.push(v+s);
  deck.sort(()=>Math.random()-0.5);
}

function nextPlayer(i){
  let idx=i;
  do{
    idx=(idx+1)%players.length;
  }while(!players[idx].active);
  return idx;
}

function startGame(){
  if(players.filter(p=>p.money>0).length<2) return;

  createDeck();
  community=[];
  pot=0;
  currentBet=0;
  betsThisRound=0;
  phase="preflop";

  players.forEach(p=>{
    if(p.money>0){
      p.active=true;
      p.folded=false;
      p.cards=[deck.pop(),deck.pop()];
      p.bet=0;
    }
  });

  turnIndex=0;
  updateState();
}

function advancePhase(){

  betsThisRound=0;
  players.forEach(p=>p.bet=0);
  currentBet=0;

  if(phase==="preflop"){
    phase="flop";
    community.push(deck.pop(),deck.pop(),deck.pop());
  }
  else if(phase==="flop"){
    phase="turn";
    community.push(deck.pop());
  }
  else if(phase==="turn"){
    phase="river";
    community.push(deck.pop());
  }
  else{
    showdown();
    return;
  }

  turnIndex=0;
  updateState();
}

function showdown(){

  phase="showdown";

  players.forEach(p=>{
    if(!p.folded && p.active){
      p.bestHand = evaluate([...p.cards,...community]);
    }
  });

  const active = players.filter(p=>!p.folded && p.active);

  active.sort((a,b)=>compareHands(b.bestHand,a.bestHand));

  const winner = active[0];
  winner.money+=pot;

  io.emit("showdown",{
    winner:winner.id,
    description:winner.bestHand.description
  });

  setTimeout(()=>{
    phase="waiting";
    startGame();
  },5000);

  updateState(true);
}

function evaluate(cards){

  const counts={};
  const suits={};

  let values=[];

  cards.forEach(c=>{
    const v=c.slice(0,-1);
    const s=c.slice(-1);
    values.push(valuesOrder[v]);
    counts[v]=(counts[v]||0)+1;
    suits[s]=(suits[s]||0)+1;
  });

  values.sort((a,b)=>b-a);

  const isFlush = Object.values(suits).some(x=>x>=5);
  const uniqueVals=[...new Set(values)].sort((a,b)=>b-a);

  let isStraight=false;
  for(let i=0;i<uniqueVals.length-4;i++){
    if(uniqueVals[i]-uniqueVals[i+4]===4){
      isStraight=true;
      break;
    }
  }

  let groups=Object.entries(counts)
    .map(([v,c])=>({value:valuesOrder[v],count:c}))
    .sort((a,b)=>b.count-a.count || b.value-a.value);

  let rank=1;
  let description="High Card";

  if(isStraight && isFlush){
    rank=9;
    description="Straight Flush";
  }
  else if(groups[0].count===4){
    rank=8;
    description="Four of a Kind";
  }
  else if(groups[0].count===3 && groups[1]?.count>=2){
    rank=7;
    description="Full House";
  }
  else if(isFlush){
    rank=6;
    description="Flush";
  }
  else if(isStraight){
    rank=5;
    description="Straight";
  }
  else if(groups[0].count===3){
    rank=4;
    description="Three of a Kind";
  }
  else if(groups[0].count===2 && groups[1]?.count===2){
    rank=3;
    description="Two Pair";
  }
  else if(groups[0].count===2){
    rank=2;
    description="Pair";
  }

  return {
    rank,
    values:groups.map(g=>g.value),
    description
  };
}

function compareHands(a,b){
  if(a.rank!==b.rank) return a.rank-b.rank;
  for(let i=0;i<a.values.length;i++){
    if(a.values[i]!==b.values[i])
      return a.values[i]-b.values[i];
  }
  return 0;
}

function updateState(reveal=false){
  io.emit("update",{
    players,
    gameState:{
      community,
      pot,
      phase,
      turn: players[turnIndex]?.id,
      reveal
    }
  });
}

io.on("connection",(socket)=>{

  if(players.length>=MAX_PLAYERS){
    socket.emit("message","Mesa llena");
    return;
  }

  const player={
    id:socket.id,
    name:"Jugador "+(players.length+1),
    money:START_MONEY,
    cards:[],
    folded:false,
    active:true,
    bet:0
  };

  players.push(player);

  if(players.length>=2 && phase==="waiting"){
    startGame();
  }

  updateState();

  socket.on("bet",(amount)=>{
    const p=players.find(x=>x.id===socket.id);
    if(!p || players[turnIndex].id!==socket.id) return;

    if(amount===0){
      if(currentBet===0){
        betsThisRound++;
        turnIndex=nextPlayer(turnIndex);
      }
    }else{
      if(amount<p.money){
        p.money-=amount;
        p.bet+=amount;
        pot+=amount;
        currentBet=p.bet;
      }
      betsThisRound++;
      turnIndex=nextPlayer(turnIndex);
    }

    if(betsThisRound>=players.filter(x=>!x.folded).length){
      advancePhase();
    }

    updateState();
  });

  socket.on("fold",()=>{
    const p=players.find(x=>x.id===socket.id);
    if(!p) return;
    p.folded=true;

    if(players.filter(x=>!x.folded).length===1){
      showdown();
      return;
    }

    turnIndex=nextPlayer(turnIndex);
    updateState();
  });

  socket.on("disconnect",()=>{
    players=players.filter(x=>x.id!==socket.id);
    updateState();
  });

});

server.listen(process.env.PORT||3000);
