const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
app.get("/", (req, res) => res.send("Game House Server running ✓"));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const rooms = {};

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms[code] ? makeCode() : code;
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("create_room", ({ game, playerName }) => {
    const code = makeCode();
    rooms[code] = {
      code,
      game,
      players: [{ id: socket.id, name: playerName, color: "w" }],
      started: false,
    };
    socket.join(code);
    socket.roomCode = code;
    socket.playerName = playerName;
    socket.emit("room_created", { code, color: "w", playerName });
    console.log(`Room ${code} created by ${playerName} for ${game}`);
  });

  socket.on("join_room", ({ code, playerName }) => {
    const upperCode = code.toUpperCase();
    const room = rooms[upperCode];
    if (!room) { socket.emit("error", { msg: "Room not found. Check the code and try again." }); return; }
    if (room.started) { socket.emit("error", { msg: "Game already in progress." }); return; }
    if (room.players.length >= 2) { socket.emit("error", { msg: "Room is full." }); return; }

    room.players.push({ id: socket.id, name: playerName, color: "b" });
    socket.join(upperCode);
    socket.roomCode = upperCode;
    socket.playerName = playerName;
    room.started = true;

    const p1 = room.players[0];
    const p2 = room.players[1];

    io.to(p1.id).emit("game_start", { game: room.game, color: "w", opponentName: p2.name });
    io.to(p2.id).emit("game_start", { game: room.game, color: "b", opponentName: p1.name });

    console.log(`Room ${upperCode} started: ${p1.name} (W) vs ${p2.name} (B)`);
  });

  socket.on("move", ({ code, move, newState }) => {
    // Use provided code or fall back to socket's stored code
    const roomCode = (code && code.length === 4) ? code.toUpperCase() : socket.roomCode;
    if (!roomCode) return;
    if (rooms[roomCode]) rooms[roomCode].state = newState;
    socket.to(roomCode).emit("opponent_move", { move, newState });
  });

  socket.on("reaction", ({ code, emoji }) => {
    const roomCode = (code && code.length === 4) ? code.toUpperCase() : socket.roomCode;
    if (roomCode) socket.to(roomCode).emit("opponent_reaction", { emoji });
  });

  socket.on("rematch_request", ({ code }) => {
    const roomCode = code || socket.roomCode;
    if (roomCode) socket.to(roomCode).emit("rematch_requested");
  });

  socket.on("rematch_accept", ({ code }) => {
    const roomCode = code || socket.roomCode;
    const room = rooms[roomCode];
    if (!room) return;
    room.players = room.players.map(p => ({ ...p, color: p.color === "w" ? "b" : "w" }));
    io.to(roomCode).emit("rematch_start", {
      players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color })),
    });
  });

  socket.on("disconnect", () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    socket.to(code).emit("opponent_left", { name: socket.playerName || "Opponent" });
    setTimeout(() => {
      if (rooms[code]) {
        const alive = rooms[code].players.some(p => io.sockets.sockets.get(p.id));
        if (!alive) { delete rooms[code]; console.log(`Room ${code} cleaned up`); }
      }
    }, 30000);
    console.log("Disconnected:", socket.id, "from room", code);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Game House server on port ${PORT}`));
