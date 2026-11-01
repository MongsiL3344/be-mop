import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import session from "express-session";
import { io } from "./lib/socket.js";
import { errorHandler } from "./lib/errors.js";

const app = express();
const CLIENT_ORIGIN = process.env["CLIENT_ORIGIN"] ?? "http://localhost:3000";

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());
const SESSION_SECRET = process.env["SESSION_SECRET"];
if (!SESSION_SECRET) throw new Error("SESSION_SECRET is not set");
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 7 },
  }),
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use(errorHandler);

const httpServer = createServer(app);
io.attach(httpServer, { cors: { origin: CLIENT_ORIGIN, credentials: true } });

const PORT = Number(process.env["PORT"] ?? 8080);
httpServer.listen(PORT, () => {
  console.log(`listening on http://localhost:${PORT}`);
});
