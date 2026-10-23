# 让商家从外网登录：Cloudflare Tunnel

系统在你的 Windows 电脑上运行（http://localhost:3100）。商家在自己的电脑或手机上登录，需要一个外网地址。试用期用 Cloudflare Tunnel（cloudflared）：免费，不用开路由器端口，不暴露家里的 IP。sq-system 之前用过同一个工具。

前提：**电脑开机、Docker 在运行**，商家才能访问。有付费客户后迁到小型云服务器（见第 4 节）。

## 0. 开放外网前必须做的

1. 已经用 `local-setup.ps1` 创建了管理员账号，并能在 http://localhost:3100 登录。
2. 根目录 `.env` 中 `AUTH_REQUIRED=true`（安装脚本默认就是这个值）。没有登录保护时不要开放外网。
3. 管理员密码足够长（12 位以上），不要和其他网站相同。

## 1. 安装 cloudflared

```powershell
winget install --id Cloudflare.cloudflared
cloudflared --version
```

## 2A. 临时地址（先给 1～2 个商家试用）

```powershell
cloudflared tunnel --url http://localhost:3100
```

窗口里会出现 `https://xxxx-xxxx.trycloudflare.com`，把这个地址发给商家。注意：
- 关掉这个窗口地址就失效；每次重开地址都会变，要重新发给商家。
- Cloudflare 不保证这种临时地址的稳定性，只适合短期试用。

## 2B. 固定地址（推荐，需要一个自己的域名）

域名可以在 Cloudflare 上买，或把已有域名的 DNS 改到 Cloudflare（免费套餐即可）。下面以 `app.你的域名.com` 为例。

```powershell
cloudflared tunnel login                         # 浏览器里选择你的域名并授权
cloudflared tunnel create sim-leadgen            # 生成隧道和凭证文件（在 %USERPROFILE%\.cloudflared\）
cloudflared tunnel route dns sim-leadgen app.你的域名.com
```

新建 `%USERPROFILE%\.cloudflared\config.yml`（把 `<隧道ID>` 换成上一步显示的 ID）：

```yaml
tunnel: <隧道ID>
credentials-file: C:\Users\<你的用户名>\.cloudflared\<隧道ID>.json
ingress:
  - hostname: app.你的域名.com
    service: http://localhost:3100
  - service: http_status:404
```

先手动运行确认能打开：

```powershell
cloudflared tunnel run sim-leadgen
```

确认无误后装成 Windows 服务，开机自动运行：

```powershell
cloudflared service install
```

凭证文件 `*.json` 和 `cert.pem` 相当于密码，不要发给别人，也不要放进 Git。

## 3. 给商家开账号

1. 管理员登录 → 商家管理 → 新建商家，填公司名、联系人、登录邮箱，试用期默认 7 天。
2. 系统显示一次临时密码。把外网地址、登录邮箱和临时密码发给商家；商家第一次登录必须改密码。
3. 商家登录后按引导清单操作：绑定发信邮箱 → 选类目 → 选市场 → 开始找客户。
4. 试用到期后账号自动变成只读（数据保留）。在商家管理里延长试用或标记已付费即可恢复。

## 4. 以后迁到云服务器

商家多了、需要 24 小时在线时：
1. 买一台 2 核 4G 的 Linux 云服务器，装 Docker。
2. 在电脑上备份数据库（见 `WINDOWS_LOCAL_SETUP.md` 第 5 节），把 `.env*` 文件和备份复制到服务器。
3. 服务器上 `git clone` 本仓库，`docker compose up -d`，再用 `pg_restore` 恢复数据。
4. 在服务器上按第 2B 节重新建隧道（或直接用服务器的公网 IP + HTTPS 反向代理），把域名指向服务器。商家使用的地址不变。

## 5. 常见问题

| 现象 | 处理 |
|---|---|
| 商家打不开 | 电脑是否开机、Docker 是否运行、`cloudflared` 窗口或服务是否在运行 |
| 打开的是别的系统 | 检查 config.yml 里的端口是不是 3100（sq-system 用 3000） |
| 登录后马上又退出 | 确认 `.env` 里的 `SESSION_SECRET` 没有在运行中被改动；改了会让所有人重新登录 |
