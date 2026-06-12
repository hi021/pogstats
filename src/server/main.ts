import http from "http";
import Koa from "koa";
import { WebSocketServer, WebSocket } from "ws";
import { SERVER_PORT } from "../scripts/env.js";
import { onConnect, sendDebugMessageToSocket } from "./websocket.js";

const SCORES_WS_URL = "wss://ushio.chiffa.lol/";

const app = new Koa();
const server = http.createServer(app.callback());
const wss = new WebSocketServer({ noServer: true });

const scoresWs = new WebSocket(SCORES_WS_URL);

const scoreBatch = new Array<any>();
let scoreId = -1;

app.use(async (ctx) => {
  if (ctx.path === "/status") {
    ctx.body = { ok: true };
  }
});

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/api/v1/socket/scores") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", onConnect);

app.use(sendDebugMessageToSocket);

scoresWs.on("open", () => {
  console.log("Connected to scores-ws");
  scoresWs.send("connect");
});

scoresWs.on("message", (event) => {
  const message = event.toString();
  if(message == "start-batch" || message == "end-batch") {
    // TODO dump current in-memory batch
    // clear scoresBatch array
    // save last score id
    return;
  }
  
  try {
    const score = JSON.parse(message);
    
    if (score.id) {
      scoreId = score.id;
      console.log(score);
      scoresWs.close();
    } else {
      console.log("error or score id", score)
      // reconnect(parsed);
      // save last score id
    }
  } catch(e) {
    console.error("scores-ws failed to parse score JSON:\n", e);
    // TODO maybe disconnect?
    // save last score id
  }
});

scoresWs.on("error", (err) => {
  console.error("scores-ws error:\n", err);
});

scoresWs.on("close", () => {
  console.log("scores-ws connection closed");
});

server.listen(SERVER_PORT, () => {
  console.log(`Server running on http://localhost:${SERVER_PORT}`);
  console.log(`WebSocket listening on ws://localhost:${SERVER_PORT}/api/v1/socket/scores`);
});

// function reconnect(scoreId) {
//     setTimeout(_ => {
//         const socket = new WebSocket("ws://127.0.0.1:7727");

//         // ... we can use that score id. This way we only receive the scores that
//         // were fetched in the meanwhile that we don't already know about.
//         socket.on("open", _ => socket.send(scoreId));
//         socket.on("message", onMessage);
//     }, 10_000);
// }
