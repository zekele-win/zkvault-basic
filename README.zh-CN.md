# ❄️ zkvault-basic

zkvault-basic 是一个基于 zkSNARK 的最小可用零知识证明项目，旨在帮助开发者深入了解 zk 应用的基本工作流程，包括电路编写、proof 生成与合约验证等关键环节。

通过该项目，你可以掌握如何构建一个完整的 zk 应用，从本地开发到部署测试，涵盖前后端集成和 CLI 操作。

---

## 🎯 项目目标

zkvault-basic 的设计初衷是作为学习与分享的工具，复现匿名存取款的典型场景：

- 使用 zkSNARK 实现匿名存款与任意钱包取款
- 结合 Circom 与 Solidity，构建完整的零知识工作流
- 强调极简实现，聚焦核心概念，方便学习理解

本项目简化自 Tornado Cash 的基本机制，是入门 zk 应用开发的理想参考。

---

## ✨ 功能概览

### 存款

- 用户创建一个随机密钥 `secret`
- 根据该密钥生成一个承诺 `commitment`
- 使用该 `commitment`，将固定数量的 ETH 存入合约，实现匿名存款

### 取款

- 提供存款时的密钥 `secret`
- 生成对应的零知识证明 `proof`
- 使用任意钱包执行合约取款，资金可转入任意地址

---

## 设计理念

`zkvault` 的目的是实现以下三个核心特点：

- **一致性（Consistency）**
- **安全性（Security）**
- **隐私性（Privacy）**（暂未实现）

我们通过梳理存款（deposit）和取款（withdraw）流程来具体说明这三个特点。

### 存款（Deposit）过程

1. 【APP】准备调用【合约】函数 `deposit(commitment)`
   - 【APP】随机生成 `secret`（用户确保其不泄漏）
   - 【APP】计算【合约】函数 `deposit` 需要的参数 `commitment = hash(secret)`，`commitment` 是公开的
2. 【合约】函数 `deposit(commitment)` 处理
   - 确保用户存入的资金正确
   - 保存 `commitment`，并标记该 `commitment` 为 `DEPOSITED` 状态

### 取款（Withdraw）过程

1. 【APP】准备调用【合约】函数 `withdraw(pA, pB, pC, pubSignals)`
   - 参数解释
     - `(pA, pB, pC, pubSignals)` 是标准的 zkSNARK proof 参数
     - `pubSignals[0] = commitment`，`pubSignals[1] = recipient`
   - 【APP】通过存款时保存的 `secret`，以及指定的 `recipient` 调用【zk 电路】的 `Withdraw(public: commitment, public: recipient, private: secret)`，生成 zkProof（标准组成：`pA`, `pB`, `pC`, `pubSignals`）
   - 【zk 电路】生成的 zkProof 绑定了 `commitment`、`recipient` 和计算 `commitment` 的算法逻辑，确保 zkProof 中的任何数值修改都无法通过【合约】端验证
   - 如果 `withdraw` 需要的 zkProof 中的 `commitment`（`pubSignals[0]`）与存款时的 `commitment` 不一致，则【合约】端会拒绝 `withdraw`，要么 `verifier` 失败，要么 `commitment` 状态无法正确识别。这确保了 **一致性（Consistency）**
   - 同时，由于生成 zkProof 时绑定了 `recipient`，即使由于意外因素（如 gas 不足）导致执行【合约】函数 `withdraw` 失败，其他人也不能通过修改 `recipient` 参数盗取资金。因为修改 `recipient` 需要【APP】重新生成 zkProof，而重新生成 zkProof 需要 `secret`。这确保了 **安全性（Security）**
2. 【合约】函数 `withdraw(pA, pB, pC, pubSignals)` 处理
   - 检查 `commitment` 状态
   - 调用 `verifier` 验证 zkProof（`pA`, `pB`, `pC`, `pubSignals`）的有效性
     - `verifier` 是【APP】在编译【zk 电路】时生成的对应合约

### 风险

整个存款/取款过程，为了保证 **一致性（Consistency）**，`deposit` 和 `withdraw` 都暴露了 `commitment`，这意味着执行存款和执行取款的账号地址是关联的，从而导致缺乏 **隐私性（Privacy）**

---

## 🧱 项目结构

```bash
.
├── circuits/                          # Circom 零知识电路
│   └── ZkVaultBasic.circom            # 主电路，包含存取款逻辑
│
├── contracts/                         # Solidity 智能合约
│   ├── ZkVaultBasic.sol               # 主 Vault 合约，调用 verifier 验证 ZK 证明
│   └── ZkVaultBasicVerifier.sol       # Circom 编译后自动生成的 Groth16 验证器合约
│
├── scripts/                           # 脚本，包括 CLI 和合约部署
│   ├── cli.ts                         # 提供命令行交互功能（如 deposit/withdraw 测试）
│   └── deploy.ts                      # 用于部署合约到本地链或测试网
│
├── test/                              # 单元测试（电路 + 合约 + 工具函数）
│   ├── utils.hex.test.ts              # 测试 hex 编解码工具
│   ├── utils.pedersen.test.ts         # 测试 Pedersen 哈希函数
│   ├── ZkVaultBasic.circom.test.ts    # 测试 Circom 电路逻辑与 Witness 输出
│   └── ZkVaultBasic.sol.test.ts       # 测试 Solidity 合约行为与 ZK 验证集成
│
├── types/                             # TypeScript 类型定义文件
│   ├── circom_tester.d.ts             # circom_tester 模块的类型声明
│   └── ffjavascript.d.ts              # ffjavascript 工具库的类型声明
│
├── utils/                             # 工具函数模块
│   ├── hex.ts                         # hex 编解码相关函数
│   └── pedersen.ts                    # Pedersen 哈希函数（与电路保持兼容）
│
├── .mocharc.json                      # Mocha 测试框架配置
├── hardhat.config.ts                  # Hardhat 编译与部署配置
├── package.json                       # 项目依赖与 NPM 脚本定义
└── tsconfig.json                      # TypeScript 配置文件
```

---

## ⚙️ 环境准备

1. 安装 Node.js，推荐版本：**v22**
2. 安装 Circom 2  
   安装指南：[https://docs.circom.io/getting-started/installation/](https://docs.circom.io/getting-started/installation/)
   ```bash
   circom --version
   ```
3. 安装本地测试网工具 Anvil  
   安装链接：[https://github.com/foundry-rs/foundry](https://github.com/foundry-rs/foundry)

---

## 📦 安装依赖

```bash
npm install
```

---

## 🔧 编译电路

生成电路所需的 `r1cs` 和 `wasm` 文件：

```bash
npm run build
```

---

## 🔐 Setup 电路（trusted setup）

前置要求：下载 `powersOfTau28_hez_final_12.ptau` 文件，并放置于项目根目录。

- 下载地址：[https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_12.ptau](https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_12.ptau)
- 如链接失效，请参考 [iden3/snarkjs](https://github.com/iden3/snarkjs?tab=readme-ov-file#7-prepare-phase-2)

执行 setup，生成 proving key、verifying key 及 Solidity verifier：

```bash
npm run setup
```

---

## 📄 编译智能合约

将 Vault 与 Verifier 合约编译为 EVM 可部署格式：

```bash
npm run compile
```

---

## 🧪 运行测试

包含 Circom 电路测试 + Solidity 合约测试：

```bash
npm run test
```

---

## 🚀 启动本地测试链（anvil）

默认地址为 `http://127.0.0.1:8545`：

```bash
npm run srv
```

---

## 🧾 环境变量配置（.env）

在项目根目录创建 `.env` 文件，例如：

```env
NETWORK = "test"
NODE_URL = "http://127.0.0.1:8545"
MNEMONIC = "<你的测试助记词>"
```

⚠️ 助记词仅用于本地测试，**切勿用于生产钱包**！

---

## 📤 合约部署至本地测试网

查看部署参数说明：

```bash
npm run deploy -- --help
```

例如，部署支持 1 ETH 存款金额的合约：

```bash
npm run deploy -- --denomination 1
```

---

## 🧭 CLI 命令使用

### 发起存款（deposit）

```bash
npm run cli -- deposit
```

执行成功后，将输出存款密钥 `secret`，请妥善保存。

### 发起取款（withdraw）

使用之前打印的密钥进行取款：

```bash
npm run cli -- withdraw --secret <your-secret>
```

---

## 📚 延伸阅读与参考

- [Circom 2 官方文档](https://docs.circom.io/)
- [Snarkjs 教程](https://github.com/iden3/snarkjs)
- [Zero Knowledge Proofs](https://ethereum.org/en/zero-knowledge-proofs/)

---

## 🚧 下一阶段计划

基于 merkle tree 实现升级版 zkvault-classic，完整断开借款和取款的地址关联。

---

## 📄 License

本项目使用 MIT 开源协议，详情见 [LICENSE](./LICENSE)。
