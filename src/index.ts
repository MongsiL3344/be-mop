import { createServer } from "node:http";
import { app, CLIENT_ORIGIN } from "./app.js";
import { io } from "./lib/socket.js";

const httpServer = createServer(app);
io.attach(httpServer, { cors: { origin: CLIENT_ORIGIN, credentials: true } });

const PORT = Number(process.env["PORT"] ?? 8080);
httpServer.listen(PORT, () => {
  console.log(`listening on http://localhost:${PORT}`);
});
