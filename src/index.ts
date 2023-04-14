import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const PORT = process.env.PORT || 3000;

const games = [];
const players = [];

const app = express();
app.use(cors());

app.get('/', (_req, res) => {
  res.send({ uptime: process.uptime() });
});

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3001',
  },
});

io.on('connection', (socket) => {
  console.log(`⚡: ${socket.id} client just connected!`);
  socket.on('disconnect', () => console.log('Client disconnected'));

  socket.emit('games', games);

  socket.on('create-game', (player) => {
    console.log(player);
    games.push({ player, playerIds: [socket.id] });
    io.emit('games', games);
  });

//   setInterval(() => socket.emit('time', new Date().toTimeString()), 1000);
});

server.listen(PORT, () => console.log(`Listening on ${PORT}`));
