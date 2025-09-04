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
import config from "./config.js";

console.log(chalk.yellow("🚀 Starting server..."));

const __dirname = process.cwd();
const server = http.createServer();
const app = express();
const bareServer = createBareServer("/ca/");
const PORT = process.env.PORT || 8080;
const cache = new Map();
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30日キャッシュ

// BasicAuth
if (config.challenge !== false) {
  console.log(chalk.green("🔒 Password protection is enabled! Listing logins below"));
  Object.entries(config.users).forEach(([username, password]) => {
    console.log(chalk.blue(`Username: ${username}, Password: ${password}`));
  });
  app.use(basicAuth({ users: config.users, challenge: true }));
}

// 許可された埋め込み元
const allowedEmbedOrigins = ["https://xeroxapp024.vercel.app"];

// ----------------------------
// 🔒 埋め込みチェックミドルウェア（全リクエスト共通）
// ----------------------------
app.use((req, res, next) => {
  const referer = req.get("Referer");
  const origin = referer ? new URL(referer).origin : "";

  const isAllowed = referer && allowedEmbedOrigins.includes(origin);

  if (!isAllowed) {
    return res.status(403).send(`
      <html lang="ja">
        <head><meta charset="UTF-8"><title>アクセス拒否</title></head>
        <body style="font-family: sans-serif; background-color: #f8f8f8; display: flex; align-items: center; justify-content: center; height: 100vh;">
          <div style="background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); text-align: center;">
            <h1 style="color: #e53e3e; font-size: 1.5rem;">不正なアクセスです</h1>
            <p style="color: #4a5568;">このページは XeroxYT からの埋め込みでしか表示できません</p>
          </div>
        </body>
      </html>
    `);
  }

  next();
});

// ----------------------------
// /e/* アセットキャッシュ取得
// ----------------------------
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
    const contentType = no.includes(ext) ? "application/octet-stream" : mime.getType(ext);

    cache.set(req.path, { data, contentType, timestamp: Date.now() });
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching the asset");
  }
});

// ----------------------------
// 共通設定
// ----------------------------
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/ca", cors({ origin: true }));

// ----------------------------
// 静的ファイル配信（直アクセス禁止）
const staticDir = path.join(__dirname, "static");
app.use(express.static(staticDir, {
  setHeaders: (res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
  }
}));

// ----------------------------
// ページルーティング（直アクセス禁止）
const routes = [
  { path: "/b", file: "apps.html" },
  { path: "/a", file: "games.html" },
  { path: "/play.html", file: "games.html" },
  { path: "/c", file: "settings.html" },
  { path: "/d", file: "tabs.html" },
  { path: "/", file: "index.html" },
];

routes.forEach(route => {
  app.get(route.path, (req, res) => {
    res.sendFile(path.join(staticDir, route.file));
  });
});

// ----------------------------
// 404 / 500
// ----------------------------
app.use((req, res) => res.status(404).sendFile(path.join(staticDir, "404.html")));
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).sendFile(path.join(staticDir, "404.html"));
});

// ----------------------------
// サーバー起動
// ----------------------------
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
