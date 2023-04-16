import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import bodyParser from 'body-parser';

const PORT = process.env.PORT || 3000;

interface IUser {
  username: string
  game: any
}
interface IUsers { [key:string]: IUser}

let games = [];
const users: IUsers = {};

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors());

app.get('/', (_req, res) => {
  res.send({ uptime: process.uptime(), games, users });
});

app.post('/login', (req, res) => {
  const { username, socketId } = (req.body);
  if (users[socketId] || !Object.values(users).find((user) => user.username === username)) {
    users[socketId] = { username, game: null };
    return res.send({ login: true });
  }
  return res.send({ login: false });
});

app.get('/games', (_req, res) => {
  res.send({ games });
});

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3001',
  },
});

const getUsername = (socketId) => users[socketId]?.username;

io.on('connection', (socket) => {
  console.log(`⚡: ${socket.id} client just connected!`);
  socket.on('disconnect', () => {
    console.log(`${getUsername(socket.id)} disconnected`);
    delete users[socket.id];
  });

  socket.on('create-game', () => {
    if (!users[socket.id].game) { // if not already in a game
      const username = getUsername(socket.id);
      const newGame = { host: username, id: socket.id, playerUsernames: [username] };
      games.push(newGame);
      users[socket.id] = { ...users[socket.id], game: newGame };
      io.emit('games', games);
      socket.emit('enter-game', newGame);
      socket.join(socket.id);
    }
  });

  socket.on('join-game', ({ id }) => {
    console.log('joining', id);
    const existingGame = games.find((game) => game.id === id);
    if (existingGame) {
      games = games.map((game) => {
        if (game.id === id) {
          game.playerUsernames.push(getUsername(socket.id));
        }
        return game;
      });
      const updatedGame = games.find((game) => game.id === id);
      users[socket.id] = { ...users[socket.id], game: updatedGame };
      socket.join(updatedGame.id);
      socket.emit('enter-game', updatedGame);
      setTimeout(() => io.in(updatedGame.id).emit('start-game', updatedGame), 500);
    }
  });

//   setInterval(() => socket.emit('time', new Date().toTimeString()), 1000);
});

server.listen(PORT, () => console.log(`Listening on ${PORT}`));
