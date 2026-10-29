import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import session from "express-session";
import { Server } from "socket.io";

const app = express();
const CLIENT_ORIGIN = process.env["CLIENT_ORIGIN"] ?? "http://localhost:3000";

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env["SESSION_SECRET"]!,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 7 },
  }),
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const httpServer = createServer(app);
export const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN, credentials: true },
});

const PORT = Number(process.env["PORT"] ?? 8080);
httpServer.listen(PORT, () => {
  console.log(`listening on http://localhost:${PORT}`);
});
