import express from "express";
import cors from "cors";
import session from "express-session";
import { errorHandler } from "./lib/errors.js";
import { checkOrigin } from "./lib/origin.js";
import { userRouter } from "./features/user/controller.js";
import { tagRouter } from "./features/tag/controller.js";
import { notificationRouter } from "./features/notification/controller.js";

export const CLIENT_ORIGIN = process.env["CLIENT_ORIGIN"] ?? "http://localhost:3000";

const SESSION_SECRET = process.env["SESSION_SECRET"];
if (!SESSION_SECRET) throw new Error("SESSION_SECRET is not set");

export const app = express();

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(checkOrigin(CLIENT_ORIGIN));
app.use(express.json());
app.use(
  session({
    name: "sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 7 },
  }),
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/users", userRouter);
app.use("/tags", tagRouter);
app.use("/notifications", notificationRouter);

app.use(errorHandler);
