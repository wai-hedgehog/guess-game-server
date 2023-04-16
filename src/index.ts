import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import bodyParser from 'body-parser';

const PORT = process.env.PORT || 3000;

let games = [];
const users = {};

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors());

app.get('/', (_req, res) => {
  res.send({ uptime: process.uptime(), games, users });
});

app.post('/login', (req, res) => {
  const { username, socketId } = (req.body);
  if (users[socketId] || !Object.values(users).includes(username)) {
    users[socketId] = username;
    return res.send({ login: true });
  }
  return res.send({ login: false });
});

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3001',
  },
});

io.on('connection', (socket) => {
  let username: string;
  console.log(`⚡: ${socket.id} client just connected!`);
  socket.on('disconnect', () => {
    console.log(`${username} disconnected`);
    delete users[socket.id];
  });

  socket.emit('games', games);

  socket.on('create-game', (player) => {
    const newGame = { player, id: socket.id, playerUsernames: [player] };
    games.push(newGame);
    io.emit('games', games);
    socket.emit('enter-game', newGame);
    socket.join(socket.id);
  });

  socket.on('join-game', ({ id, username }) => {
    console.log('joining', id);
    const existingGame = games.find((game) => game.id === id);
    if (existingGame) {
      games = games.map((game) => {
        if (game.id === id) {
          game.playerUsernames.push(username);
        }
        return game;
      });
      socket.join(existingGame.id);
      socket.emit('enter-game', existingGame);
      setTimeout(() => io.in(existingGame.id).emit('start-game', existingGame), 500);
    }
  });

//   setInterval(() => socket.emit('time', new Date().toTimeString()), 1000);
});

server.listen(PORT, () => console.log(`Listening on ${PORT}`));
