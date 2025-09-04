import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createBareServer } from "@nebula-services/bare-server-node";
import chalk from "chalk";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import basicAuth from "express-basic-auth";
import mime from "mime";
import fetch from "node-fetch";
// import { setupMasqr } from "./Masqr.js";
import config from "./config.js";

console.log(chalk.yellow("🚀 Starting server..."));

const __dirname = process.cwd();
const server = http.createServer();
const app = express();
const bareServer = createBareServer("/ca/");
const PORT = process.env.PORT || 8080;
const cache = new Map();
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // Cache for 30 Days

// 🔒 BasicAuth (任意)
if (config.challenge !== false) {
  console.log(
    chalk.green("🔒 Password protection is enabled! Listing logins below"),
  );
  Object.entries(config.users).forEach(([username, password]) => {
    console.log(chalk.blue(`Username: ${username}, Password: ${password}`));
  });
  app.use(basicAuth({ users: config.users, challenge: true }));
}

// ========================
// 📌 埋め込み制御ミドルウェア（全体適用）
// ========================
const allowedEmbedOrigins = ["https://xeroxapp024.vercel.app"];

app.use((req, res, next) => {
  const referer = req.get("Referer");
  const origin = referer ? new URL(referer).origin : "";

  // iframe 埋め込みかどうか
  const isEmbedded = !!referer;

  // same-origin 判定（必要なら）
  const currentOrigin = req.protocol + "://" + req.get("host");

  let isAllowed = false;
  if (allowedEmbedOrigins.includes("same-origin") && origin === currentOrigin) {
    isAllowed = true;
  } else if (allowedEmbedOrigins.includes(origin)) {
    isAllowed = true;
  }

  // 🔴 埋め込み以外は全拒否
  if (!isEmbedded || !isAllowed) {
    return res.status(403).send(`
      <html lang="ja">
        <head><meta charset="UTF-8"><title>アクセス拒否</title></head>
        <body style="font-family: sans-serif; background-color: #f8f8f8; display: flex; align-items: center; justify-content: center; height: 100vh;">
          <div style="background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); text-align: center;">
            <h1 style="color: #e53e3e; font-size: 1.5rem;">不正なアクセスです</h1>
            <p style="color: #4a5568;">このページは、XeroxYT からの埋め込みでしか表示できません</p>
          </div>
        </body>
      </html>
    `);
  }

  next();
});

// ========================
// 📌 /e/* アセットキャッシュ取得
// ========================
app.get("/e/*", async (req, res, next) => {
  try {
    if (cache.has(req.path)) {
      const { data, contentType, timestamp } = cache.get(req.path);
      if (Date.now() - timestamp <= CACHE_TTL) {
        res.writeHead(200, { "Content-Type": contentType });
        return res.end(data);
      } else {
        cache.delete(req.path);
      }
    }

    const baseUrls = {
      "/e/1/": "https://raw.githubusercontent.com/qrs/x/fixy/",
      "/e/2/": "https://raw.githubusercontent.com/3v1/V5-Assets/main/",
      "/e/3/": "https://raw.githubusercontent.com/3v1/V5-Retro/master/",
    };

    let reqTarget;
    for (const [prefix, baseUrl] of Object.entries(baseUrls)) {
      if (req.path.startsWith(prefix)) {
        reqTarget = baseUrl + req.path.slice(prefix.length);
        break;
      }
    }

    if (!reqTarget) return next();

    const asset = await fetch(reqTarget);
    if (!asset.ok) return next();

    const data = Buffer.from(await asset.arrayBuffer());
    const ext = path.extname(reqTarget);
    const no = [".unityweb"];
    const contentType = no.includes(ext)
      ? "application/octet-stream"
      : mime.getType(ext);

    cache.set(req.path, { data, contentType, timestamp: Date.now() });
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch (error) {
    console.error("Error fetching asset:", error);
    res.setHeader("Content-Type", "text/html");
    res.status(500).send("Error fetching the asset");
  }
});

// ========================
// 📌 共通設定
// ========================
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/ca", cors({ origin: true }));

// 静的ファイル
app.use(express.static(path.join(__dirname, "static")));

// ページルーティング
const routes = [
  { path: "/b", file: "apps.html" },
  { path: "/a", file: "games.html" },
  { path: "/play.html", file: "games.html" },
  { path: "/c", file: "settings.html" },
  { path: "/d", file: "tabs.html" },
  { path: "/", file: "index.html" },
];

routes.forEach(route => {
  app.get(route.path, (_req, res) => {
    res.sendFile(path.join(__dirname, "static", route.file));
  });
});

// 404
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "static", "404.html"));
});

// 500
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).sendFile(path.join(__dirname, "static", "404.html"));
});

// ========================
// 📌 サーバー起動
// ========================
server.on("request", (req, res) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

server.on("upgrade", (req, socket, head) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeUpgrade(req, socket, head);
  } else {
    socket.end();
  }
});

server.on("listening", () => {
  console.log(chalk.green(`🌍 Server is running on http://localhost:${PORT}`));
});

server.listen({ port: PORT });
