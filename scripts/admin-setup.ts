// A temporary loopback server, before Casdoor initialization. No registration endpoint in the running center.
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import dotenv from "dotenv";
const env = dotenv.parse(await readFile(".env")),
  stateFile = ".local/admin-setup.json",
  bootstrap = ".local/admin-bootstrap.json";
if (
  existsSync(".local/casdoor/initialized") ||
  existsSync(".local/admin-subject.confirmed")
)
  process.exit(0);
const state = JSON.parse(await readFile(stateFile, "utf8"));
if (state.status !== "pending") process.exit(0);
const port = Number(env.ADMIN_SETUP_PORT || 5313),
  origin = `http://localhost:${port}`,
  login = env.CENTER_URL.replace(/\/$/, "") + "/admin";
const same = (v: string) => {
  const a = Buffer.from(v),
    b = Buffer.from(state.token);
  return a.length === b.length && timingSafeEqual(a, b);
};
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'",
  );
  try {
    if (
      !["127.0.0.1", "::ffff:127.0.0.1"].includes(
        req.socket.remoteAddress || "",
      ) ||
      req.headers.host !== `localhost:${port}`
    ) {
      res.writeHead(403).end();
      return;
    }
    const current = JSON.parse(await readFile(stateFile, "utf8"));
    if (req.url === "/setup.js" && req.method === "GET") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(
        `const token=new URLSearchParams(location.hash.slice(1)).get('token');history.replaceState(null,'','/setup');const f=document.querySelector('form'),out=document.querySelector('[role=status]');document.querySelector('#show').onchange=e=>document.querySelectorAll('[data-password]').forEach(i=>i.type=e.target.checked?'text':'password');f.onsubmit=async e=>{e.preventDefault();const v=Object.fromEntries(new FormData(f));if(v.password!==v.confirm){out.textContent='两次密码不一致';return}const r=await fetch('/setup',{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Token':token||''},body:JSON.stringify(v)});const d=await r.json();out.textContent=d.message;if(r.ok){f.hidden=true;const t=setInterval(async()=>{try{const s=await fetch('/status',{headers:{'X-Setup-Token':token||''}});const d=await s.json();if(d.ready){clearInterval(t);location.replace(d.login)}}catch{}},1000)}};`,
      );
      return;
    }
    if (
      req.url === "/status" &&
      req.method === "GET" &&
      same(String(req.headers["x-setup-token"] || ""))
    ) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ready: current.status === "complete", login }));
      if (current.status === "complete") setTimeout(() => server.close(), 500);
      return;
    }
    if (
      req.url === "/setup" &&
      req.method === "GET" &&
      current.status === "pending"
    ) {
      res.setHeader("Content-Type", "text/html;charset=utf-8");
      res.end(
        `<!doctype html><html lang="zh"><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>首次设置管理员</title><style>body{font:16px system-ui;background:#f4f5f8;color:#20322c;margin:0}main{max-width:430px;margin:8vh auto;padding:32px;background:white;border-radius:16px}label{display:block;margin:18px 0}input:not([type=checkbox]),button{box-sizing:border-box;width:100%;padding:12px;font:inherit}button{background:#236650;color:white;border:0;border-radius:8px}small{color:#5e6b66}</style><main><h1>首次设置管理员</h1><p>此账号拥有账号中心与 Casdoor 管理员权限。仅本机一次有效。</p><form><label>用户名<input name="username" value="admin" autocomplete="username" pattern="[a-zA-Z][a-zA-Z0-9_-]{1,39}" required></label><label>密码<input name="password" type="password" data-password autocomplete="new-password" minlength="8" maxlength="72" required></label><label>确认密码<input name="confirm" type="password" data-password autocomplete="new-password" minlength="8" maxlength="72" required></label><label><input type="checkbox" id="show">显示密码</label><small>至少8位，无需组合大小写、数字或符号。Casdoor 不接受空格。</small><button>保存并进入登录</button></form><p role="status"></p></main><script src="/setup.js"></script></html>`,
      );
      return;
    }
    if (req.url === "/setup" && req.method === "POST") {
      if (
        current.status !== "pending" ||
        !same(String(req.headers["x-setup-token"] || "")) ||
        req.headers.origin !== origin
      ) {
        res
          .writeHead(403)
          .end(JSON.stringify({ message: "设置授权无效或已完成" }));
        return;
      }
      let body = "";
      for await (const part of req) {
        body += part;
        if (body.length > 4096) throw Error("输入过长");
      }
      const v = JSON.parse(body);
      if (
        !/^[a-zA-Z][a-zA-Z0-9_-]{1,39}$/.test(v.username) ||
        typeof v.password !== "string" ||
        v.password.length < 8 ||
        Buffer.byteLength(v.password) > 72 ||
        v.password.includes(" ") ||
        v.password !== v.confirm
      )
        throw Error(
          "请检查用户名，密码至少8位且两次一致（最多72字节，不含空格）",
        );
      // Exclusive creation prevents racing submissions or overwriting an already prepared administrator.
      await writeFile(
        bootstrap,
        JSON.stringify({ username: v.username, password: v.password }),
        { mode: 0o600, flag: "wx" },
      );
      await writeFile(
        stateFile,
        JSON.stringify({ ...current, status: "prepared" }),
        { mode: 0o600 },
      );
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          message: "设置已保存，正在启动服务，随后自动进入登录…",
        }),
      );
      return;
    }
    res.writeHead(404).end("设置入口已关闭");
  } catch (e: any) {
    res
      .writeHead(400, { "Content-Type": "application/json" })
      .end(
        JSON.stringify({
          message: e.code === "EEXIST" ? "管理员已设置" : e.message,
        }),
      );
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `首次设置管理员（仅本机一次有效）：${origin}/setup#token=${state.token}`,
  ),
);
// The launcher marks complete only after upstream identity and center readiness are verified.
setTimeout(() => server.close(), 30 * 60 * 1000).unref();
