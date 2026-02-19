const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let players = [];
let gameStarted = false;
let deck = [];

function createDeck() {
    const suits = ["♠","♥","♦","♣"];
    const values = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
    deck = [];
    for (let suit of suits) {
        for (let value of values) {
            deck.push(value + suit);
        }
    }
}

function shuffle() {
    deck.sort(() => Math.random() - 0.5);
}

function evaluateHand(cards) {
    const values = cards.map(c => c.slice(0, -1));
    const suits = cards.map(c => c.slice(-1));

    const valueCounts = {};
    values.forEach(v => valueCounts[v] = (valueCounts[v] || 0) + 1);

    const counts = Object.values(valueCounts).sort((a,b)=>b-a);

    if (counts[0] === 4) return "Poker";
    if (counts[0] === 3 && counts[1] === 2) return "Full House";
    if (counts[0] === 3) return "Trío";
    if (counts[0] === 2 && counts[1] === 2) return "Doble Par";
    if (counts[0] === 2) return "Par";

    const suitCounts = {};
    suits.forEach(s => suitCounts[s] = (suitCounts[s] || 0) + 1);
    if (Object.values(suitCounts).includes(5)) return "Color";

    return "Carta Alta";
}

io.on("connection", (socket) => {

    if (players.length >= 2) {
        socket.emit("message", "Mesa llena");
        return;
    }

    players.push(socket.id);
    io.emit("players", players.length);

    if (players.length === 2 && !gameStarted) {
        gameStarted = true;
        startGame();
    }

    socket.on("disconnect", () => {
        players = players.filter(id => id !== socket.id);
        gameStarted = false;
        io.emit("players", players.length);
    });
});

function startGame() {
    let countdown = 10;

    const interval = setInterval(() => {
        io.emit("countdown", countdown);
        countdown--;

        if (countdown < 0) {
            clearInterval(interval);
            dealGame();
        }
    }, 1000);
}

function dealGame() {
    createDeck();
    shuffle();

    const community = [
        deck.pop(), deck.pop(), deck.pop(),
        deck.pop(), deck.pop()
    ];

    players.forEach(playerId => {
        const playerCards = [deck.pop(), deck.pop()];
        const hand = evaluateHand([...playerCards, ...community]);

        io.to(playerId).emit("gameData", {
            playerCards,
            community,
            hand
        });
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Servidor iniciado"));
