import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import bodyParser from 'body-parser';

const PORT = process.env.PORT || 3000;

enum GameState {
  CREATING,
  PLAYING,
}

interface IPlayer {
  username: string
  id: string
}

interface IGame {
  id: string
  host: string
  players: IPlayer[]
  canJoin: boolean
  state: GameState
}
interface IGames { [key:string]: IGame}

interface IUser {
  username: string
  game: any
}
interface IUsers { [key:string]: IUser}

const games: IGames = {};
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
const emitStats = (socket) => socket.emit('stats', {
  players: Object.values(users).length,
  gamesInPlay: Object.values(games).filter((game) => game.state === GameState.PLAYING).length,
});

io.on('connection', (socket) => {
  console.log(`⚡: ${socket.id} client just connected!`);

  socket.on('disconnect', () => {
    console.log(`${getUsername(socket.id)} disconnected`);
    const gameId = users[socket.id]?.game;
    if (gameId) { // delete game that user was in
      io.in(gameId).emit('opponent-disconnected');
      games[gameId].players.forEach((player) => {
        users[player.id].game = undefined;
      });
      delete games[gameId];
    }
    delete users[socket.id];
  });

  socket.on('create-game', () => {
    if (!users[socket.id].game) { // if not already in a game
      const username = getUsername(socket.id);
      const newGame = {
        id: socket.id,
        host: username,
        players: [{ username, id: socket.id }],
        canJoin: true,
        state: GameState.CREATING,
      };
      games[socket.id] = (newGame);
      users[socket.id] = { ...users[socket.id], game: socket.id };
      io.emit('games', games);
      socket.emit('creating-game', newGame);
      socket.join(socket.id);
    }
  });

  socket.on('join-game', ({ id }) => {
    console.log('joining', id);
    const existingGame = games[id];
    if (existingGame && existingGame.canJoin) {
      const updatedGame = {
        ...games[id],
        players: [...games[id].players, { username: getUsername(socket.id), id: socket.id }],
        canJoin: false,
        state: GameState.PLAYING,
      };
      io.emit('games', games);
      games[id] = updatedGame;
      users[socket.id] = { ...users[socket.id], game: id };
      socket.join(id);
      io.in(id).emit('start-game', updatedGame);
    }
  });

  socket.on('cancel-game', () => {
    users[socket.id] = { ...users[socket.id], game: null };
    delete games[socket.id];
    io.emit('games', games);
  });

  setInterval(() => emitStats(socket), 1000);
});

server.listen(PORT, () => console.log(`Listening on ${PORT}`));
