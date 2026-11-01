# easy-amm UI

基于 React、TypeScript 和 Vite 的 AMM 交互前端，用于查看池子状态、添加或移除流动性，以及兑换代币。合约说明见[项目 README](../README.md)。

## 运行准备

- 安装 Node.js 和 npm。
- 在仓库根目录运行 `anchor build`，生成前端引用的 `target/idl/easy_amm.json` 和 `target/types/easy_amm.ts`。
- 将合约部署到所选网络，准备对应的池子账户、测试代币和钱包余额。
- 前端配置了 Solflare 钱包适配器。

## 网络与账户配置

启动前检查以下文件：

| 文件 | 配置 |
| --- | --- |
| [src/App.tsx](src/App.tsx) | 钱包连接的 RPC endpoint 和钱包适配器网络，当前使用 Devnet |
| [src/anchor.ts](src/anchor.ts) | 合约 provider 的 `NETWORK`、`PROGRAM_ID` 和 `POOL_PDA` |

`src/anchor.ts` 中的 `NETWORK` 当前为 `http://127.0.0.1:8899`。需将两处 RPC 配置及钱包网络统一到同一目标网络；连接 Devnet 时将 `NETWORK` 改为对应的 Devnet RPC，使用本地验证器时则调整 `src/App.tsx` 的连接配置。

`POOL_PDA` 是固定配置的池子地址，应替换为目标网络上实际创建的池子地址。确认 Program ID 与构建生成的 IDL 及部署一致。

## 本地启动

在仓库根目录运行：

```bash
cd 'easy‑amm-ui'
npm install
npm run dev
```

目录名中的 `‑` 为 Unicode 连字符，复制上面的命令可避免路径输入错误。打开 Vite 输出的本地地址并连接钱包。

## 开发命令

在本目录运行：

```bash
npm run build
npm run lint
npm run preview
```

`preview` 用于预览构建产物，需先完成 `build`。前端读取合约与账户状态，需要目标 RPC 可访问且相关账户已初始化。
