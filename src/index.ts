import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;

enum GameState {
  CREATING = 'CREATING',
  PLAYING = 'PLAYING',
  FINISHED = 'FINISHED',
}

enum GameResult {
  WIN = 'WIN',
  LOSE = 'LOSE',
  DRAW = 'DRAW',
}

interface IPlayer {
  username: string
  id: string
  player: string
}

enum GuessResult {
  HIGHER = 'HIGHER',
  LOWER = 'LOWER',
  CORRECT = 'CORRECT',
}

interface IPlayerTurnResult {
  guess: number
  guessResult?: GuessResult
  usedLie?: boolean
  changedNumber?: boolean
  changedNumberInfo?: { original: number, newNumber?: number }
}

interface ITurnResult {
  turnNumber: number
  player1: IPlayerTurnResult | null
  player2: IPlayerTurnResult | null
}

interface IGamePlayer {
  originalNumber: number
  number: number
  canChangeNumber: boolean
  canUseLie: boolean
}

interface IPlayerTurn {
  guess: number
  useLie: boolean
  changeNumber: boolean
}

interface IGameData {
  player1: IGamePlayer
  player2: IGamePlayer
  currentTurn: ITurnResult
  turns: ITurnResult[]
  rematchWanted: boolean
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

const getRandomNumber = () => Math.floor(Math.random() * (+process.env.NUMBER_LIMIT)) + 1;

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cors());

app.get('/', (_req, res) => {
  res.send({
    uptime: process.uptime(), games: Object.keys(games).length, users: Object.keys(users),
  });
});

app.get('/games', (_req, res) => {
  res.send({ games });
});

app.post('/login', (req, res) => {
  const { username, socketId } = (req.body);
  if (users[socketId] || !Object.values(users).find((user) => user.username === username)) {
    users[socketId] = { username, game: null };
    return res.send({ login: true });
  }
  return res.send({ login: false });
});

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN,
  },
});

const omitOpponentData = (turnRes: ITurnResult, player: string): ITurnResult => {
  const opponent = player === 'player1' ? 'player2' : 'player1';
  const opponentFullData = turnRes[opponent];
  const opponentData = { guess: opponentFullData.guess, guessResult: opponentFullData.guessResult };
  return { ...turnRes, [opponent]: opponentData };
};

const getUsername = (socketId) => users[socketId]?.username;
const emitStats = (socket) => socket.emit('stats', {
  players: Object.values(users).length,
  gamesInPlay: Object.values(games).filter((game) => game.state === GameState.PLAYING).length,
});

io.on('connection', (socket) => {
  console.log(`⚡: ${socket.id} client just connected!`);

  socket.on('disconnect', () => {
    try {
      console.log(`${getUsername(socket.id)} disconnected`);
      const gameId = users[socket.id]?.game;
      if (gameId) { // delete game that user was in
        io.in(gameId).emit('opponent-disconnected');
        games[gameId].players.forEach((player) => {
          users[player.id].game = undefined;
        });
        delete games[gameId];
        io.emit('games', games);
      }
      delete users[socket.id];
    } catch (e) {
      console.error('DISCONNECT_EVENT', e);
    }
  });

  socket.on('create-game', () => {
    try {
      if (!users[socket.id].game) { // if not already in a game
        const username = getUsername(socket.id);
        const gameId = `GAME-${socket.id}`;
        const newGame = {
          id: gameId,
          host: username,
          players: [{ username, id: socket.id, player: 'player1' }],
          canJoin: true,
          state: GameState.CREATING,
        };
        games[gameId] = (newGame);
        users[socket.id] = { ...users[socket.id], game: gameId };
        io.emit('games', games);
        socket.emit('creating-game', newGame);
        socket.join(gameId);
      }
    } catch (e) {
      console.error('CREATE_GAME_EVENT', e);
    }
  });

  socket.on('join-game', ({ gameId }) => {
    try {
      const existingGame = games[gameId];
      if (existingGame && existingGame.canJoin) {
        const updatedGame = {
          ...games[gameId],
          players: [...games[gameId].players, { username: getUsername(socket.id), id: socket.id, player: 'player2' }],
          canJoin: false,
          state: GameState.PLAYING,
        };
        games[gameId] = updatedGame;
        io.emit('games', games);
        users[socket.id] = { ...users[socket.id], game: gameId };
        socket.join(gameId);

        const p1Number = getRandomNumber();
        const p2Number = getRandomNumber();
        const gameData: IGameData = {
          player1: {
            originalNumber: p1Number,
            number: p1Number,
            canChangeNumber: true,
            canUseLie: true,
          },
          player2: {
            originalNumber: p2Number,
            number: p2Number,
            canChangeNumber: true,
            canUseLie: true,
          },
          currentTurn: { player1: null, player2: null, turnNumber: 1 },
          turns: [],
          rematchWanted: false,
        };

        gamePlayData[gameId] = gameData;
        updatedGame.players.forEach((player, i) => {
          io.to(player.id).emit('start-game', updatedGame, gameData[`player${i + 1}`]);
        });
      }
    } catch (e) {
      console.error('JOIN_GAME_EVENT', 'GameId: ', gameId, e);
    }
  });

  socket.on('submit-turn', ({ guess, useLie = false, changeNumber = false }: IPlayerTurn) => {
    try {
      const gameId = users[socket.id]?.game;
      if (!gameId) return;
      const currentGame = games[gameId];
      const currentPlayerDetails = currentGame.players.find((player) => player.id === socket.id);
      const otherPlayerDetails = currentGame.players.find((player) => player.id !== socket.id);
      const currentPlayer = currentPlayerDetails.player;
      const otherPlayer = otherPlayerDetails.player;

      const currentGPData = gamePlayData[gameId];
      if (currentGPData) {
      // validate turn
        if (currentGPData.currentTurn[currentPlayer]) return;
        if (!guess) return;
        if (useLie && !currentGPData[currentPlayer].canUseLie) return;
        if (changeNumber && !currentGPData[currentPlayer].canChangeNumber) return;

        const currentPlayerTurnResult: IPlayerTurnResult = {
          guess,
          changedNumber: changeNumber,
          usedLie: useLie,
        };

        const getGuessResult = (guessedNum, target, shouldLie) => {
          if (guessedNum > target) return shouldLie ? GuessResult.HIGHER : GuessResult.LOWER;
          if (guessedNum < target) return shouldLie ? GuessResult.LOWER : GuessResult.HIGHER;
          return GuessResult.CORRECT;
        };

        const newGamePlayData: IGameData = { ...currentGPData };

        if (currentGPData.currentTurn[otherPlayer]) {
        // end turn logic because both players submitted
          const otherPlayerTurnResults: IPlayerTurnResult = currentGPData.currentTurn[otherPlayer];

          newGamePlayData[currentPlayer] = {
            originalNumber: currentGPData[currentPlayer].originalNumber,
            number: currentPlayerTurnResult.changedNumber
              ? getRandomNumber() : currentGPData[currentPlayer].number,
            canChangeNumber: currentPlayerTurnResult.changedNumber
              ? false : currentGPData[currentPlayer].canChangeNumber,
            canUseLie: currentPlayerTurnResult.usedLie
              ? false : currentGPData[currentPlayer].canUseLie,
          };

          newGamePlayData[otherPlayer] = {
            originalNumber: currentGPData[otherPlayer].originalNumber,
            number: otherPlayerTurnResults.changedNumber
              ? getRandomNumber() : currentGPData[otherPlayer].number,
            canChangeNumber: otherPlayerTurnResults.changedNumber
              ? false : currentGPData[otherPlayer].canChangeNumber,
            canUseLie: otherPlayerTurnResults.usedLie
              ? false : currentGPData[otherPlayer].canUseLie,
          };

          const currentPlayerChangedNumber = newGamePlayData[currentPlayer].number
          !== newGamePlayData[currentPlayer].originalNumber;
          const otherPlayerChangedNumber = newGamePlayData[otherPlayer].number
          !== newGamePlayData[otherPlayer].originalNumber;
          const turnResult = {
            turnNumber: currentGPData.currentTurn.turnNumber,
            [otherPlayer]: {
              ...otherPlayerTurnResults,
              guessResult: getGuessResult(
                otherPlayerTurnResults.guess,
                newGamePlayData[currentPlayer].number,
                currentPlayerTurnResult.usedLie,
              ),
              changedNumberInfo: {
                original: newGamePlayData[otherPlayer].originalNumber,
                ...(otherPlayerChangedNumber && { newNumber: newGamePlayData[otherPlayer].number }),
              },
            },
            [currentPlayer]: {
              ...currentPlayerTurnResult,
              guessResult: getGuessResult(
                currentPlayerTurnResult.guess,
                newGamePlayData[otherPlayer].number,
                otherPlayerTurnResults.usedLie,
              ),
              changedNumberInfo: {
                original: newGamePlayData[currentPlayer].originalNumber,
                ...(currentPlayerChangedNumber
                    && { newNumber: newGamePlayData[currentPlayer].number }),
              },
            },
          };
          newGamePlayData.currentTurn = {
            player1: null,
            player2: null,
            turnNumber: currentGPData.currentTurn.turnNumber + 1,
          };
          newGamePlayData.turns.push(turnResult as any);

          gamePlayData[gameId] = newGamePlayData;

          // update later to no obmitting game-end event if game over.

          const currentPlayerGuessResult = (turnResult as any)[currentPlayer].guessResult;
          const otherPlayerGuessResult = (turnResult as any)[otherPlayer].guessResult;

          // game over
          if (currentPlayerGuessResult === GuessResult.CORRECT
            || otherPlayerGuessResult === GuessResult.CORRECT) {
            const newGame = { ...games[gameId] };
            newGame.state = GameState.FINISHED;
            games[gameId] = newGame;
            let currentPlayerGameResult: GameResult;
            let otherPlayerGameResult: GameResult;

            if (currentPlayerGuessResult !== GuessResult.CORRECT) {
              currentPlayerGameResult = GameResult.LOSE;
              otherPlayerGameResult = GameResult.WIN;
            } else if (otherPlayerGuessResult === GuessResult.CORRECT) {
              currentPlayerGameResult = GameResult.DRAW;
              otherPlayerGameResult = GameResult.DRAW;
            } else {
              currentPlayerGameResult = GameResult.WIN;
              otherPlayerGameResult = GameResult.LOSE;
            }

            io.to(currentPlayerDetails.id).emit('game-end', newGamePlayData.turns, currentPlayerGameResult);
            io.to(otherPlayerDetails.id).emit('game-end', newGamePlayData.turns, otherPlayerGameResult);
          } else {
          // next turn
            io.to(currentPlayerDetails.id).emit(
              'turn-end',
              omitOpponentData(turnResult as any, currentPlayer),
              newGamePlayData[currentPlayer],
            );
            io.to(otherPlayerDetails.id).emit(
              'turn-end',
              omitOpponentData(turnResult as any, otherPlayer),
              newGamePlayData[otherPlayer],
            );
          }
        } else {
          newGamePlayData.currentTurn[currentPlayer] = currentPlayerTurnResult;
          gamePlayData[gameId] = newGamePlayData;
        }
      }
    } catch (e) {
      console.error('SUBMIT_TURN_EVENT', 'INPUT: ', { guess, useLie, changeNumber }, e);
    }
  });

  socket.on('cancel-game', () => {
    try {
      const gameId = users[socket.id]?.game;
      users[socket.id] = { ...users[socket.id], game: null };
      delete games[gameId];
      io.emit('games', games);
    } catch (e) {
      console.error('CANCEL_GAME_EVENT', e);
    }
  });

  socket.on('rematch', () => {
    try {
      const gameId = users[socket.id].game;
      if (!gameId) return;
      const currentGameData: IGameData = { ...gamePlayData[gameId] };
      if (currentGameData.rematchWanted) {
      // restart game
        const newGame: IGame = { ...games[gameId] };
        newGame.state = GameState.PLAYING;
        games[gameId] = newGame;

        const p1Number = getRandomNumber();
        const p2Number = getRandomNumber();
        const newGameData: IGameData = {
          player1: {
            originalNumber: p1Number,
            number: p1Number,
            canChangeNumber: true,
            canUseLie: true,
          },
          player2: {
            originalNumber: p2Number,
            number: p2Number,
            canChangeNumber: true,
            canUseLie: true,
          },
          currentTurn: { player1: null, player2: null, turnNumber: 1 },
          turns: [],
          rematchWanted: false,
        };
        gamePlayData[gameId] = newGameData;
        newGame.players.forEach((player, i) => {
          io.to(player.id).emit('rematch-start', newGame, newGameData[`player${i + 1}`]);
        });
      } else {
        currentGameData.rematchWanted = true;
        gamePlayData[gameId] = currentGameData;
        const otherPlayer = games[gameId].players.find((player) => player.id !== socket.id);
        io.to(otherPlayer.id).emit('rematch-wanted');
      }
    } catch (e) {
      console.error('REMATCH_EVENT', e);
    }
  });

  socket.on('quit-game', () => {
    try {
      const gameId = users[socket.id].game;
      if (!gameId) return;
      const otherPlayer = games[gameId].players.find((player) => player.id !== socket.id);
      io.to(otherPlayer.id).emit('opponent-left');
      delete games[gameId];
      delete gamePlayData[gameId];
      delete users[socket.id].game;
      delete users[otherPlayer.id].game;
    } catch (e) {
      console.error('QUIT_GAME_EVENT', e);
    }
  });
  // long intervals to prevent being rate limited when hosting on free services
  setInterval(() => emitStats(socket), 15000);
});

server.listen(PORT, () => console.log(`Listening on ${PORT}`));
