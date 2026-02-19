<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Poker Online</title>
<script src="/socket.io/socket.io.js"></script>

<style>

body{
  margin:0;
  background:#0e1a2b;
  font-family:Arial;
  color:white;
  text-align:center;
}

#table{
  width:850px;
  height:500px;
  margin:20px auto;
  background:radial-gradient(circle at center,#1e7d3c 0%,#115c2c 70%);
  border-radius:250px;
  position:relative;
  border:12px solid #5a3e1b;
}

.seat{
  width:150px;
  height:140px;
  background:#1c1c1c;
  border-radius:12px;
  position:absolute;
  padding:6px;
  font-size:14px;
}

.turn{
  border:2px solid gold;
}

.role{
  display:inline-block;
  width:22px;
  height:22px;
  border-radius:50%;
  font-size:12px;
  line-height:22px;
  font-weight:bold;
  margin-left:4px;
}

.dealer{ background:gold; color:black; }
.sb{ background:#3fa9f5; }
.bb{ background:#ff4d4d; }

.card{
  display:inline-block;
  width:60px;
  height:90px;
  background:white;
  border-radius:8px;
  margin:3px;
  position:relative;
  border:1px solid #ccc;
  font-weight:bold;
}

.card .top{
  position:absolute;
  top:4px;
  left:6px;
  font-size:14px;
}

.card .bottom{
  position:absolute;
  bottom:4px;
  right:6px;
  font-size:14px;
  transform:rotate(180deg);
}

.card .center{
  position:absolute;
  top:50%;
  left:50%;
  transform:translate(-50%,-50%);
  font-size:26px;
}

.red{ color:red; }
.black{ color:black; }

.hidden{
  background:#222;
}

#community{
  position:absolute;
  top:45%;
  left:50%;
  transform:translate(-50%,-50%);
}

</style>
</head>
<body>

<h1>♠ Texas Hold'em ♣</h1>
<div id="pot">Pozo: $0</div>
<div id="table">
  <div id="community"></div>
</div>

<script>

const socket=io();
let myId=null;
let currentTurn=null;
let revealCards=false;

socket.on("connect",()=>{ myId=socket.id; });

socket.on("update",data=>{
  currentTurn=data.gameState.turn;
  revealCards=data.gameState.reveal;

  document.getElementById("pot").innerText="Pozo: $"+data.gameState.pot;

  renderCommunity(data.gameState.community);
  renderPlayers(data.players,data.gameState);
});

function renderCommunity(cards){
  const div=document.getElementById("community");
  div.innerHTML="";
  cards.forEach(c=> div.appendChild(createCard(c)));
}

function createCard(text){
  const suit=text.slice(-1);
  const value=text.slice(0,-1);
  const color=(suit==="♥"||suit==="♦")?"red":"black";

  const div=document.createElement("div");
  div.className="card "+color;
  div.innerHTML=`
    <div class="top">${value}${suit}</div>
    <div class="center">${suit}</div>
    <div class="bottom">${value}${suit}</div>
  `;
  return div;
}

function renderPlayers(players,gameState){

  document.querySelectorAll(".seat").forEach(e=>e.remove());

  const positions=[
    {top:"5%",left:"45%"},
    {top:"20%",left:"80%"},
    {top:"65%",left:"80%"},
    {top:"80%",left:"45%"},
    {top:"65%",left:"5%"},
    {top:"20%",left:"5%"}
  ];

  players.forEach((p,index)=>{

    const seat=document.createElement("div");
    seat.className="seat";
    seat.style.top=positions[index].top;
    seat.style.left=positions[index].left;

    if(index===gameState.dealerIndex)
      seat.innerHTML+=`<span class="role dealer">D</span>`;
    if(index===gameState.sbIndex)
      seat.innerHTML+=`<span class="role sb">SB</span>`;
    if(index===gameState.bbIndex)
      seat.innerHTML+=`<span class="role bb">BB</span>`;

    if(p.id===currentTurn)
      seat.classList.add("turn");

    let cardsHtml="";

    if(p.id===myId || revealCards){
      p.cards.forEach(c=> seat.appendChild(createCard(c)));
    }else if(!p.folded){
      seat.innerHTML+=`
        <div class="card hidden"></div>
        <div class="card hidden"></div>
      `;
    }

    seat.innerHTML+=`<div><b>${p.name}</b></div><div>$${p.money}</div>`;

    document.getElementById("table").appendChild(seat);
  });
}

</script>

</body>
</html>
