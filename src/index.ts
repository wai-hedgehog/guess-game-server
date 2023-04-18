import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import bodyParser from 'body-parser';

const PORT = process.env.PORT || 3000;

enum GameState {
  CREATING,
  PLAYING,
  FINISHED,
}

interface IPlayer {
  username: string
  id: string
}

enum GuessResult {
  HIGHER,
  LOWER,
  CORRECT,
}

interface IPlayerTurnResult {
  guess: number
  guessResult: GuessResult
  usedLie?: boolean
  changedNumber?: number
}

interface ITurnResult {
  turnNumber: number
  player1: IPlayerTurnResult
  player2: IPlayerTurnResult
}

interface IGamePlayer {
  number: number
  canChangeNumber: boolean
  canUseLie: boolean
}

interface IPlayerTurn {
  guess: number
  useLie?: boolean
  newNumber?: number
}

interface IPlayData {
  turnResult?: ITurnResult[]
  number: number
  player1FinishedTurn?: boolean
  player2FinishedTurn?: boolean
}

interface IGameData {
  player1: IGamePlayer
  player2: IGamePlayer
  player1Turn: IPlayerTurn | null
  player2Turn: IPlayerTurn | null
  turns: ITurnResult[]
  waitingPlayerTurn: boolean
}
interface IGameDatas { [key:string]: IGameData}

interface IUser {
  username: string
  game: string
}
interface IUsers { [key:string]: IUser }

interface IGame {
  id: string
  host: string
  players: IPlayer[]
  canJoin: boolean
  state: GameState
}
interface IGames { [key:string]: IGame }

const games: IGames = {};
const users: IUsers = {};
// used to store game data - away from games object so other player moves are hidden
const gamePlayData: IGameDatas = {};

const getRandomNumber = () => Math.floor(Math.random() * 500) + 1;

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors());

app.get('/', (_req, res) => {
  res.send({
    uptime: process.uptime(), games, users, gamePlayData,
  });
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
      const gameId = `GAME-${socket.id}`;
      const newGame = {
        id: gameId,
        host: username,
        players: [{ username, id: socket.id }],
        canJoin: true,
        state: GameState.CREATING,
      };
      games[gameId] = (newGame);
      users[socket.id] = { ...users[socket.id], game: gameId };
      io.emit('games', games);
      socket.emit('creating-game', newGame);
      socket.join(gameId);
    }
  });

  socket.on('join-game', ({ gameId }) => {
    console.log('joining', gameId);
    const existingGame = games[gameId];
    if (existingGame && existingGame.canJoin) {
      const updatedGame = {
        ...games[gameId],
        players: [...games[gameId].players, { username: getUsername(socket.id), id: socket.id }],
        canJoin: false,
        state: GameState.PLAYING,
      };
      io.emit('games', games);
      games[gameId] = updatedGame;
      users[socket.id] = { ...users[socket.id], game: gameId };
      socket.join(gameId);

      const gameData: IGameData = {
        player1: {
          number: getRandomNumber(),
          canChangeNumber: true,
          canUseLie: true,
        },
        player2: {
          number: getRandomNumber(),
          canChangeNumber: true,
          canUseLie: true,
        },
        player1Turn: null,
        player2Turn: null,
        turns: [],
        waitingPlayerTurn: true,
      };

      gamePlayData[gameId] = gameData;
      updatedGame.players.forEach((player, i) => {
        const playData: IPlayData = {
          number: gameData[`player${i + 1}`].number,
          player1FinishedTurn: false,
          player2FinishedTurn: false,
          turnResult: [],
        };
        io.to(player.id).emit('start-game', updatedGame, playData, player);
      });
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
