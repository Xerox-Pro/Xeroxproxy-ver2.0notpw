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

// ======== Referer チェックミドルウェア ========
// 親からの iframe 埋め込み、かつ iframe 内でのページ遷移（同一オリジン）を許可。
// 親は環境変数 ALLOWED_PARENTS でカンマ区切り指定可（未指定時は既定の 1 ドメイン）。
const DEFAULT_PARENT = "xeroxapp024.vercel.app";
const PARENT_ALLOWED_HOSTS = (process.env.ALLOWED_PARENTS || DEFAULT_PARENT)
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  // bare-server API は除外（プロキシ機能を壊さないため）
  if (req.path.startsWith("/ca")) {
    return next();
  }

  // 静的ファイル（CSS/JS/画像/フォント/動画/音声/JSON 等）は除外
  // これらは iframe 内ページから「同一オリジン参照」で読み込まれるため、
  // 親ホストではなく子ホストが Referer になるのが通常。除外しないと崩れます。
  if (
    req.path.match(
      /\.(css|js|mjs|png|jpg|jpeg|gif|ico|webp|svg|avif|apng|bmp|woff|woff2|ttf|otf|eot|mp4|webm|mp3|wav|json|map)$/
    )
  ) {
    return next();
  }

  // ここから HTML や API など「ページ遷移系」に Referer チェックをかける
  const referer = req.get("referer");

  if (!referer) {
    // 直アクセスは拒否（iframe 経由なら Referer が入る想定）
    return res.status(403).send("Forbidden");
  }

  try {
    const refererHost = new URL(referer).host;
    const selfHost = req.headers.host; // デプロイ先の実ホスト（例: xeroxapp025.vercel.app）

    // 許可条件:
    // - 親ホスト（埋め込み元）からのリクエスト
    // - 同一ホスト（iframe 内でのページ遷移時の Referer）からのリクエスト
    const isFromParent = PARENT_ALLOWED_HOSTS.includes(refererHost);
    const isFromSelf = refererHost === selfHost;

    if (isFromParent || isFromSelf) {
      return next();
    }
  } catch (e) {
    // 不正な Referer 形式は拒否
  }

  return res.status(403).send("Forbidden");
});
// ======== ここまで ========

// Basic認証
if (config.challenge !== false) {
  console.log(chalk.green("🔒 Password protection is enabled! Listing logins below"));
  Object.entries(config.users).forEach(([username, password]) => {
    console.log(chalk.blue(`Username: ${username}, Password: ${password}`));
  });
  app.use(basicAuth({ users: config.users, challenge: true }));
}

// アセット配信（キャッシュ付き）
app.get("/e/*", async (req, res, next) => {
  try {
    if (cache.has(req.path)) {
      const { data, contentType, timestamp } = cache.get(req.path);
      if (Date.now() - timestamp <= CACHE_TTL) {
        res.writeHead(200, { "Content-Type": contentType });
        return res.end(data);
      }
      cache.delete(req.path);
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
      : mime.getType(ext) || "application/octet-stream";

    cache.set(req.path, { data, contentType, timestamp: Date.now() });
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch (error) {
    console.error("Error fetching asset:", error);
    res.setHeader("Content-Type", "text/html");
    res.status(500).send("Error fetching the asset");
  }
});

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* if (process.env.MASQR === "true") {
  console.log(chalk.green("Masqr is enabled"));
  setupMasqr(app);
} */

// 静的アセット
app.use(express.static(path.join(__dirname, "static")));

// bare-server 用 CORS
app.use("/ca", cors({ origin: true }));

// ページルーティング（既存のマッピングは維持）
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

// ワイルドカード: /static 内にある HTML を自動で解決して返す
// 例: /game -> static/game.html, /foo/bar -> static/foo/bar.html
app.get("*", (req, res, next) => {
  // 既に静的アセットで返せるパスや /ca はここに来ない想定
  const staticRoot = path.join(__dirname, "static");

  // デコード＆正規化
  const reqPath = decodeURIComponent(req.path);
  const safeJoin = (p) => {
    const full = path.join(staticRoot, p);
    const normalized = path.normalize(full);
    // ディレクトリトラバーサル防止
    if (!normalized.startsWith(staticRoot)) {
      return null;
    }
    return normalized;
  };

  // 1. そのままのパス（/foo -> static/foo）
  const direct = safeJoin(reqPath);
  if (direct && fs.existsSync(direct) && fs.statSync(direct).isFile()) {
    return res.sendFile(direct);
  }

  // 2. .html を付与（/foo -> static/foo.html）
  const withHtml = safeJoin(reqPath.replace(/\/$/, "") + ".html");
  if (withHtml && fs.existsSync(withHtml) && fs.statSync(withHtml).isFile()) {
    return res.sendFile(withHtml);
  }

  // 見つからなければ次へ（404 ハンドラへ）
  return next();
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

// bare-server 統合
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
