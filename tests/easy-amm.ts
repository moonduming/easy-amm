import fs from "fs";
import path from "path";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { EasyAmm } from "../target/types/easy_amm";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, createMint, mintTo, getAccount, getMint, getAssociatedTokenAddress } from "@solana/spl-token";
import { expect } from "chai";


describe("easy-amm", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.easyAmm as Program<EasyAmm>;
  const connection = provider.connection;

  const payer = provider.wallet.publicKey;

  let swapPda: PublicKey;
  let tokenAPda: PublicKey;
  let tokenBPda: PublicKey;
  let poolMint: PublicKey;

  let mintA: PublicKey;
  let mintB: PublicKey;
  let userTokenA: PublicKey;
  let userTokenB: PublicKey;

  // ---------- cache helpers ----------
  const CACHE_PATH = path.resolve(__dirname, "addresses.json");

  const USER_KEYPAIR_PATH = path.resolve(__dirname, "user_secret.json");

  function saveUser(kp: Keypair) {
    fs.writeFileSync(
      USER_KEYPAIR_PATH,
      JSON.stringify(Array.from(kp.secretKey))
    );
  }

  function loadUser(): Keypair {
    if (!fs.existsSync(USER_KEYPAIR_PATH)) {
      throw new Error("❌ 用户密钥文件 user_secret.json 不存在，请先运行 createEnvironment 初始化！");
    }
    const arr = Uint8Array.from(
      JSON.parse(fs.readFileSync(USER_KEYPAIR_PATH, "utf8"))
    );
    return Keypair.fromSecretKey(arr);
  }

  interface AddrCache {
    swapPda: string;
    tokenAPda: string;
    tokenBPda: string;
    poolMint: string;
    mintA: string;
    mintB: string;
    userTokenA: string;
    userTokenB: string;
  }

  function saveCache(obj: AddrCache) {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(obj, null, 2), "utf8");
  }

  function loadCache(): AddrCache | null {
    if (!fs.existsSync(CACHE_PATH)) return null;
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  }

  // ---------- environment bootstrap ----------
  async function createEnvironment() {
    const user = Keypair.generate();
    // derive PDAs
    [swapPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("easy-amm")],
      program.programId
    );
    [tokenAPda] = PublicKey.findProgramAddressSync(
      [swapPda.toBuffer(), Buffer.from("token_a")],
      program.programId
    );
    [tokenBPda] = PublicKey.findProgramAddressSync(
      [swapPda.toBuffer(), Buffer.from("token_b")],
      program.programId
    );
    [poolMint] = PublicKey.findProgramAddressSync(
      [swapPda.toBuffer(), Buffer.from("lp_mint")],
      program.programId
    );

    // airdrop SOL to user
    const airdropSig = await connection.requestAirdrop(user.publicKey, 2 * LAMPORTS_PER_SOL);
    const bh = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction(
      { signature: airdropSig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
      "confirmed"
    );

    // create mints (6 decimals)
    mintA = await createMint(connection, user, user.publicKey, null, 6);
    mintB = await createMint(connection, user, user.publicKey, null, 6);

    // user ATAs
    userTokenA = (await getOrCreateAssociatedTokenAccount(connection, user, mintA, user.publicKey)).address;
    userTokenB = (await getOrCreateAssociatedTokenAccount(connection, user, mintB, user.publicKey)).address;

    // mint some tokens into user ATAs
    await mintTo(connection, user, mintA, userTokenA, user, 2_000_000_000);
    await mintTo(connection, user, mintB, userTokenB, user, 1_000_000_000);

    saveUser(user);

    // save to cache
    saveCache({
      swapPda: swapPda.toBase58(),
      tokenAPda: tokenAPda.toBase58(),
      tokenBPda: tokenBPda.toBase58(),
      poolMint: poolMint.toBase58(),
      mintA: mintA.toBase58(),
      mintB: mintB.toBase58(),
      userTokenA: userTokenA.toBase58(),
      userTokenB: userTokenB.toBase58(),
    });
  }


  before(async () => {
    const cached = loadCache();
    if (cached) {
      // assign cached pubkeys
      swapPda    = new PublicKey(cached.swapPda);
      tokenAPda  = new PublicKey(cached.tokenAPda);
      tokenBPda  = new PublicKey(cached.tokenBPda);
      poolMint   = new PublicKey(cached.poolMint);
      mintA      = new PublicKey(cached.mintA);
      mintB      = new PublicKey(cached.mintB);
      userTokenA = new PublicKey(cached.userTokenA);
      userTokenB = new PublicKey(cached.userTokenB);
    } else {
      await createEnvironment();
    }
  });


  it("Is initialized!", async () => {
    const user = loadUser();

    // Add your test here.
    const tx = await program.methods.initializeSwap(
      200,
      300,
      new anchor.BN(100_000_000),
      new anchor.BN(50_000_000)
    ).accounts({
      payer: payer,
      user: user.publicKey,
      tokenAMint: mintA,
      tokenBMint: mintB,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID
    }).signers([user]).rpc();
    
    // …前面已经发送 initializeSwap 交易
    const latestSlot = await connection.getSlot("confirmed"); // 确保数据已落链
    
    //--------------------------------------------------------------------
    // 1. 验证 tokenA / tokenB 池账户余额（100 & 50）
    //--------------------------------------------------------------------
    const tokenAAccountInfo = await getAccount(connection, tokenAPda);
    const tokenBAccountInfo = await getAccount(connection, tokenBPda);
    
    expect(tokenAAccountInfo.amount).to.equal(BigInt(100_000_000)); // 100 * 10^6
    expect(tokenBAccountInfo.amount).to.equal(BigInt(50_000_000));  // 50  * 10^6
    
    //--------------------------------------------------------------------
    // 2. 验证 poolMint 总供应量（1000）
    //--------------------------------------------------------------------
    const poolMintInfo = await getMint(connection, poolMint);
    expect(poolMintInfo.supply).to.equal(BigInt(1_000_000_000)); // 1000 * 10^6
    
    //--------------------------------------------------------------------
    // 3. 计算 destination (user 的 LP ATA)，验证余额是否为 1000
    //--------------------------------------------------------------------
    const destination = await getAssociatedTokenAddress(poolMint, user.publicKey);
    const destAccountInfo = await getAccount(connection, destination);
    
    expect(destAccountInfo.amount).to.equal(BigInt(1_000_000_000));
    
    //--------------------------------------------------------------------
    // 4. 额外可验证：swap 账户里的配置是否写入正确
    //--------------------------------------------------------------------
    const swapAccount = await program.account.swap.fetch(swapPda);
    expect(swapAccount.tradeFees).to.equal(200);
    expect(swapAccount.withdrawFees).to.equal(300);
    
    console.log("✅ 所有断言通过！");
    console.log("Your transaction signature", tx);
  });

  it("Is deposit", async () => {
    const user = loadUser();
    const OlduserLpAta = await getAssociatedTokenAddress(poolMint, user.publicKey);
    const OlduserLpInfo = await getAccount(connection, OlduserLpAta);
    const OlduserLpaAmount = OlduserLpInfo.amount;
    // 计算 maximum_token_a_amount 和 maximum_token_b_amount
    const tokenAAccountBefore = await getAccount(connection, tokenAPda);
    const tokenBAccountBefore = await getAccount(connection, tokenBPda);
    const poolMintInfoBefore  = await getMint(connection, poolMint);

    const tokenAInPool  = BigInt(tokenAAccountBefore.amount);
    const tokenBInPool  = BigInt(tokenBAccountBefore.amount);
    const poolSupply    = BigInt(poolMintInfoBefore.supply);

    const poolTokenAmount = BigInt(2_000_000_000); 

    const tokenARequired = (poolTokenAmount * tokenAInPool) / poolSupply;
    const tokenBRequired = (poolTokenAmount * tokenBInPool) / poolSupply;
    
    // 预留 1 % 滑点
    const maxTokenA = (tokenARequired * BigInt(101)) / BigInt(100); // +1 %
    const maxTokenB = (tokenBRequired * BigInt(101)) / BigInt(100); // +1 %
    // 兑换
    const tx = await program.methods.deposit(
      new anchor.BN(poolTokenAmount.toString()),           // 想要 2_000 LP
      new anchor.BN(maxTokenA.toString()), 
      new anchor.BN(maxTokenB.toString())
    ).accounts({
      user: user.publicKey,
      tokenAMint: mintA,
      tokenBMint: mintB,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID
    }).signers([user]).rpc();

    // 校验
    const tokenAAccountAfter = await getAccount(connection, tokenAPda);
    const tokenBBccountAfter = await getAccount(connection, tokenBPda);
    const poolMintInfoAfter  = await getMint(connection, poolMint);
  
    // 5.1 池子 A, B 代币增加
    expect(
      tokenAAccountAfter.amount >= tokenAInPool + tokenARequired - BigInt(1) 
        && tokenAAccountAfter.amount <= tokenAInPool + tokenARequired + BigInt(1)
    ).to.be.true;
    expect(
      tokenBBccountAfter.amount >= tokenBInPool + tokenBRequired - BigInt(1) 
        && tokenBBccountAfter.amount <= tokenBInPool + tokenBRequired + BigInt(1)
    ).to.be.true;
  
    // LP 池币总供应量应
    expect(poolMintInfoAfter.supply).to.equal(poolSupply + poolTokenAmount);
  
    // 用户 LP 余额应
    const userLpAta = await getAssociatedTokenAddress(poolMint, user.publicKey);
    const userLpInfo = await getAccount(connection, userLpAta);
    expect(userLpInfo.amount).to.equal(BigInt(poolTokenAmount.toString()) + OlduserLpaAmount);
  
    console.log("✅ Deposit 校验通过Tx: ", tx);
  });

  it("Is WithdrawAll", async () => {
    const user = loadUser();
    const poolFeeAccount = await getAssociatedTokenAddress(poolMint, payer);
    const OlduserLpAta = await getAssociatedTokenAddress(poolMint, user.publicKey);
    const OlduserLpInfo = await getAccount(connection, OlduserLpAta);
    const OlduserLpaAmount = OlduserLpInfo.amount;
    // 计算 minimum_token_a_amount 和 minimum_token_b_amount
    const tokenAAccountBefore = await getAccount(connection, tokenAPda);
    const tokenBAccountBefore = await getAccount(connection, tokenBPda);
    const poolMintInfoBefore  = await getMint(connection, poolMint);

    const tokenAInPool  = BigInt(tokenAAccountBefore.amount);
    const tokenBInPool  = BigInt(tokenBAccountBefore.amount);
    const poolSupply    = BigInt(poolMintInfoBefore.supply);

    const poolTokenAmount = BigInt(2_000_000_000); 

    // ──────────────────────────────────────────────────────────────
    // 2. 预估可领取的 tokenA / tokenB  (含 3% withdraw fee)
    //    公式: raw_out = LP_burn * reserve / total_supply
    //          user_out = raw_out * (1 - feeBps)
    // ──────────────────────────────────────────────────────────────
    const WITHDRAW_FEE_BPS = BigInt(300);  // 3 % fee
    const FEE_DENOM        = BigInt(10_000);

    const poolTokenAmount2 = poolTokenAmount *  (FEE_DENOM - WITHDRAW_FEE_BPS) / FEE_DENOM;

    // raw amount before fee
    const tokenAOut = (poolTokenAmount2 * tokenAInPool) / poolSupply;
    const tokenBOut = (poolTokenAmount2 * tokenBInPool) / poolSupply;

    // 预留 1 % 滑点
    const minTokenA = (tokenAOut * BigInt(99)) / BigInt(100); // -1 %
    const minTokenB = (tokenBOut * BigInt(99)) / BigInt(100); // -1 %
    // 兑换
    const tx = await program.methods.withdrawAll(
      new anchor.BN(poolTokenAmount.toString()),           // 想要 2_000 LP
      new anchor.BN(minTokenA.toString()), 
      new anchor.BN(minTokenB.toString())
    ).accounts({
      user: user.publicKey,
      tokenAMint: mintA,
      tokenBMint: mintB,
      poolFeeAccount,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID
    }).signers([user]).rpc();

    // 校验
    const tokenAAccountAfter = await getAccount(connection, tokenAPda);
    const tokenBBccountAfter = await getAccount(connection, tokenBPda);
    const poolMintInfoAfter  = await getMint(connection, poolMint);
  
    // 池子 A, B 代币减少
    expect(
      tokenAAccountAfter.amount >= tokenAInPool - tokenAOut - BigInt(1) 
        && tokenAAccountAfter.amount <= tokenAInPool - tokenAOut + BigInt(1)
    ).to.be.true;
    expect(
      tokenBBccountAfter.amount >= tokenBInPool - tokenBOut - BigInt(1) 
        && tokenBBccountAfter.amount <= tokenBInPool - tokenBOut + BigInt(1)
    ).to.be.true;
  
    // LP 池币总供应量应
    expect(poolMintInfoAfter.supply).to.equal(poolSupply - poolTokenAmount2);
  
    // 用户 LP 余额
    const userLpAta = await getAssociatedTokenAddress(poolMint, user.publicKey);
    const userLpInfo = await getAccount(connection, userLpAta);
    expect(userLpInfo.amount).to.equal(OlduserLpaAmount - BigInt(poolTokenAmount.toString()));
  
    console.log("✅ WithdrawAll 校验通过Tx: ", tx);
  });

  it("Is deposit single", async () => {
    const user = loadUser();

    //--------------------------------------------------------------------
    // 0. 读取旧状态
    //--------------------------------------------------------------------
    const oldUserLpAta   = await getAssociatedTokenAddress(poolMint, user.publicKey);
    const oldUserLpInfo  = await getAccount(connection, oldUserLpAta);
    const oldUserLpAmt   = oldUserLpInfo.amount;

    const oldUserTokenAInfo = await getAccount(connection, userTokenA);
    const oldUserTokenAAmt  = oldUserTokenAInfo.amount;

    const poolTokenAInfo = await getAccount(connection, tokenAPda);
    const poolMintInfo   = await getMint(connection, poolMint);

    const reserveA   = BigInt(poolTokenAInfo.amount);                // A
    const poolSupply = BigInt(poolMintInfo.supply);                  // L

    //--------------------------------------------------------------------
    // 1. 本次单币投入数量 (用户提供的 tokenA)
    //--------------------------------------------------------------------
    const sourceTokenAmount = BigInt(200_000_000);
    const halfSource = sourceTokenAmount / BigInt(2);

    //--------------------------------------------------------------------
    // 2. 计算 trade fee & 有效存入量
    //--------------------------------------------------------------------
    const TRADE_FEE_BPS = BigInt(200);      // 与 initializeSwap 中保持一致 (2%)
    const FEE_DENOM     = BigInt(10_000);

    const fee = halfSource * TRADE_FEE_BPS / FEE_DENOM;  // 有效 tokenA
    const netDepositA = sourceTokenAmount - fee;

    //--------------------------------------------------------------------
    // 3. 根据公式 ΔL = L * (sqrt(1 + R) - 1)，估算可铸 LP
    //--------------------------------------------------------------------
    const R = Number(netDepositA) / Number(reserveA);                // R = x/A
    const mintedFloat = Number(poolSupply) * (Math.sqrt(1 + R) - 1); // ΔL (浮点)
    const mintedLP = BigInt(Math.floor(mintedFloat));                // 向下取整

    console.log("mintedLp: ", mintedLP);
    //--------------------------------------------------------------------
    // 4. 最小可接受 LP (滑点保护 1 %)
    //--------------------------------------------------------------------
    const minPoolTokenAmount = mintedLP * BigInt(99) / BigInt(100);  // -1 %

    //--------------------------------------------------------------------
    // 5. 发起单币存入交易
    //--------------------------------------------------------------------
    const tx = await program.methods.depositSingle(
      new anchor.BN(sourceTokenAmount.toString()),
      new anchor.BN(minPoolTokenAmount.toString())
    ).accounts({
      user: user.publicKey,
      poolToken: tokenAPda,
      mint: mintA,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    }).signers([user]).rpc();

    //--------------------------------------------------------------------
    // 读取新状态并断言
    //--------------------------------------------------------------------
    const poolTokenAInfoAfter = await getAccount(connection, tokenAPda);
    const poolMintInfoAfter   = await getMint(connection, poolMint);
    const newUserLpInfo       = await getAccount(connection, oldUserLpAta);
    const newUserTokenAInfo   = await getAccount(connection, userTokenA);

    // tokenA 应增加 sourceTokenAmount
    expect(
      poolTokenAInfoAfter.amount >= reserveA + sourceTokenAmount - BigInt(1) 
        && poolTokenAInfoAfter.amount <= reserveA + sourceTokenAmount + BigInt(1)
    ).to.be.true;

    // LP 总供应量应增加 mintedLP (允许 ±1 容差)
    const actualLpSupply = BigInt(poolMintInfoAfter.supply.toString());
    const expectedLpSupply = poolSupply + mintedLP;
    expect(
      actualLpSupply >= expectedLpSupply - BigInt(1) && actualLpSupply <= expectedLpSupply + BigInt(1)
    ).to.be.true;

    // 用户 LP 余额应 + mintedLP (允许 ±1 容差)
    const actualUserLp = BigInt(newUserLpInfo.amount.toString());
    const expectedUserLp = oldUserLpAmt + mintedLP;
    expect(
      actualUserLp >= expectedUserLp - BigInt(1) && actualUserLp <= expectedUserLp + BigInt(1)
    ).to.be.true;
    // 用户 tokenA 余额应 - sourceTokenAmount
    expect(
      newUserTokenAInfo.amount >= oldUserTokenAAmt - sourceTokenAmount - BigInt(1) 
        && newUserTokenAInfo.amount <= oldUserTokenAAmt - sourceTokenAmount + BigInt(1)
    ).to.be.true;

    console.log("✅ Deposit-Single 校验通过 Tx:", tx);
  });

  it("Is withdraw single", async () => {
    const user = loadUser();
    const poolFeeAccount = await getAssociatedTokenAddress(poolMint, payer);
    //--------------------------------------------------------------------
    // 0. 读取旧状态
    //--------------------------------------------------------------------
    const userLpATA   = await getAssociatedTokenAddress(poolMint, user.publicKey);
    const oldUserLp   = (await getAccount(connection, userLpATA)).amount;
    const oldUserTokA = (await getAccount(connection, userTokenA)).amount;
  
    const poolTokAInfo = await getAccount(connection, tokenAPda);
    const poolMintInfo = await getMint(connection, poolMint);
  
    const reserveA   = BigInt(poolTokAInfo.amount);  // A
    const poolSupply = BigInt(poolMintInfo.supply);  // L
  
    //--------------------------------------------------------------------
    // 1. 想提取的 tokenA 数量
    //--------------------------------------------------------------------
    const destTokenAmount = BigInt(500_000_000); // 500 tokenA (6 decimals)
  
    //--------------------------------------------------------------------
    // 2. 预估需 burn 的 LP (简单按比例)
    //--------------------------------------------------------------------
    const halfSource = (destTokenAmount + BigInt(1)) / BigInt(2);
    const TRADE_FEE_BPS = BigInt(200);      // 与 initializeSwap 中保持一致 (2%)
    const FEE_DENOM     = BigInt(10_000);
    const WITHDRAW_FEE_BPS = BigInt(300);  // 3 % fee
    
    // 计算需要销毁的 LP
    let numerator = halfSource * FEE_DENOM;
    let denominator = FEE_DENOM - TRADE_FEE_BPS;
    let trade_fee_source_amount = (numerator + denominator - BigInt(1)) / denominator
    let netDepositA = destTokenAmount - halfSource + trade_fee_source_amount;
    const R = Number(netDepositA) / Number(reserveA);                // R = x/A
    const mintedFloat = Number(poolSupply) * (1 - Math.sqrt(1 - R)); // ΔL (浮点)
    const burnLP = BigInt(Math.ceil(mintedFloat));                // 向上取整
    console.log("burnLP: ", burnLP);
    // 提取手续费
    const withdraw_fee = burnLP * WITHDRAW_FEE_BPS / FEE_DENOM
    // 实际需要支付的 LP
    const LPAmount = burnLP + withdraw_fee;
    console.log("LPAmount: ", LPAmount);

    const maxPoolTokenBurn = LPAmount * BigInt(101) / BigInt(100);  // 允许 1 % 滑点
  
    //--------------------------------------------------------------------
    // 3. 发送 withdrawSingle
    //--------------------------------------------------------------------
    const tx = await program.methods.withdrawSingle(
        new anchor.BN(destTokenAmount.toString()),
        new anchor.BN(maxPoolTokenBurn.toString())
      ).accounts({
        user: user.publicKey,
        poolToken: tokenAPda,
        mint: mintA,
        poolFeeAccount,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID
      }).signers([user]).rpc();
  
    //--------------------------------------------------------------------
    // 4. 读取新状态并断言（容差 ±1）
    //--------------------------------------------------------------------
    const poolTokAAfter = await getAccount(connection, tokenAPda);
    const poolMintAfter = await getMint(connection, poolMint);
    const userLpAfter   = await getAccount(connection, userLpATA);
    const userTokAAfter = await getAccount(connection, userTokenA);
  
    // 4‑1 池子 tokenA 减少
    expect(
      poolTokAAfter.amount >= reserveA - destTokenAmount - BigInt(1) 
        && poolTokAAfter.amount <= reserveA - destTokenAmount + BigInt(1)
    ).to.be.true;
  
    // 4‑2 LP 总供应量减少 ≈ burnLP
    const actualBurn = poolSupply - BigInt(poolMintAfter.supply);
    expect(
      actualBurn >= burnLP - BigInt(1) && actualBurn <= burnLP + BigInt(1)
    ).to.be.true;
  
    // 4‑3 用户 LP 余额减少 ≈ burnLP
    const userLpDiff = oldUserLp - BigInt(userLpAfter.amount);
    expect(
      userLpDiff >= LPAmount - BigInt(1) && userLpDiff <= LPAmount + BigInt(1)
    ).to.be.true;
  
    // 4‑4 用户 tokenA 余额增加 destTokenAmount
    expect(userTokAAfter.amount).to.equal(oldUserTokA + destTokenAmount);
  
    console.log("✅ Withdraw-Single 校验通过 Tx:", tx);
  });

  it("Is Swap", async () => {
    const user = loadUser();
    //--------------------------------------------------------------------
    // 0. 读取旧状态
    //--------------------------------------------------------------------
    const oldUserTokA = (await getAccount(connection, userTokenA)).amount;
    const oldUserTokB = (await getAccount(connection, userTokenB)).amount;
  
    const poolTokAInfo = await getAccount(connection, tokenAPda);
    const poolTokBInfo = await getAccount(connection, tokenBPda);
  
    const reserveA   = BigInt(poolTokAInfo.amount);  // A
    const reserveB   = BigInt(poolTokBInfo.amount);  // B

    const amount_in = BigInt(200_000_000);
    const TRADE_FEE_BPS = BigInt(200);      // 与 initializeSwap 中保持一致 (2%)
    const FEE_DENOM = BigInt(10_000);
    const fees = amount_in * TRADE_FEE_BPS / FEE_DENOM
    const source_amount = amount_in - fees;

    // 计算能兑换到的 Token B
    const K = reserveA * reserveB;
    const new_A_amount = reserveA + source_amount
    const new_B_amount = (K + new_A_amount - BigInt(1)) / new_A_amount;
    const new_A_amount2 = (K + new_B_amount - BigInt(1)) / new_B_amount
    const source_in = new_A_amount2 - reserveA + fees;
    console.log("source_in: ", source_in);

    const destination_amount_swapped = reserveB - new_B_amount;
    console.log("destination_amount_swapped: ", destination_amount_swapped);
    // 允许 1% 滑点
    const minimum_amount_out = destination_amount_swapped * BigInt(99) / BigInt(100)

    const tx = await program.methods.exchange(
      true,
      new anchor.BN(amount_in.toString()),
      new anchor.BN(minimum_amount_out.toString())
    ).accounts({
      user: user.publicKey,
      tokenAMint: mintA,
      tokenBMint: mintB,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID
    }).signers([user]).rpc();

    // --------------------------------------------------------------------
    // 读取新状态并断言
    // --------------------------------------------------------------------
    const poolTokAAfter   = await getAccount(connection, tokenAPda);
    const poolTokBAfter   = await getAccount(connection, tokenBPda);
    const newUserTokAInfo = await getAccount(connection, userTokenA);
    const newUserTokBInfo = await getAccount(connection, userTokenB);

    // 1. 池子 A 应增加 net source_amount
    expect(poolTokAAfter.amount).to.equal(reserveA + source_in);

    // 2. 池子 B 应减少 destination_amount_swapped
    expect(poolTokBAfter.amount).to.equal(reserveB - destination_amount_swapped);

    // 3. 用户 tokenA 余额应减少 source_in（实际转出的数量）
    expect(newUserTokAInfo.amount).to.equal(oldUserTokA - source_in);

    // 4. 用户 tokenB 余额应增加 destination_amount_swapped
    expect(newUserTokBInfo.amount).to.equal(oldUserTokB + destination_amount_swapped);

    console.log("✅ Swap 校验通过 Tx:", tx);

  });

  it("Withdraws all remaining LP", async () => {
    const user = loadUser();
    const poolFeeAccount = await getAssociatedTokenAddress(poolMint, payer);

    //--------------------------------------------------------------------
    // 0. 读取旧状态
    //--------------------------------------------------------------------
    const userLpAta = await getAssociatedTokenAddress(poolMint, user.publicKey);
    const oldUserLpInfo = await getAccount(connection, userLpAta);
    const poolTokenAmount = BigInt(oldUserLpInfo.amount.toString());

    const tokenAAccountBefore = await getAccount(connection, tokenAPda);
    const tokenBAccountBefore = await getAccount(connection, tokenBPda);
    const poolMintInfoBefore = await getMint(connection, poolMint);

    const tokenAInPool = BigInt(tokenAAccountBefore.amount);
    const tokenBInPool = BigInt(tokenBAccountBefore.amount);
    const poolSupply = BigInt(poolMintInfoBefore.supply);

    //--------------------------------------------------------------------
    // 1. 根据待赎回 LP 计算最小可收取代币数量
    //--------------------------------------------------------------------
    const WITHDRAW_FEE_BPS = BigInt(300);
    const FEE_DENOM = BigInt(10_000);

    const poolTokenAmount2 =
      (poolTokenAmount * (FEE_DENOM - WITHDRAW_FEE_BPS)) / FEE_DENOM;
    const tokenAOut = (poolTokenAmount2 * tokenAInPool) / poolSupply;
    const tokenBOut = (poolTokenAmount2 * tokenBInPool) / poolSupply;

    const minTokenA = (tokenAOut * BigInt(99)) / BigInt(100);
    const minTokenB = (tokenBOut * BigInt(99)) / BigInt(100);

    //--------------------------------------------------------------------
    // 2. 发起赎回全部 LP 的交易
    //--------------------------------------------------------------------
    const tx = await program.methods
      .withdrawAll(
        new anchor.BN(poolTokenAmount.toString()),
        new anchor.BN(minTokenA.toString()),
        new anchor.BN(minTokenB.toString())
      )
      .accounts({
        user: user.publicKey,
        tokenAMint: mintA,
        tokenBMint: mintB,
        poolFeeAccount,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    //--------------------------------------------------------------------
    // 3. 读取新状态并断言
    //--------------------------------------------------------------------
    const tokenAAccountAfter = await getAccount(connection, tokenAPda);
    const tokenBAccountAfter = await getAccount(connection, tokenBPda);
    const poolMintInfoAfter = await getMint(connection, poolMint);
    const userLpInfoAfter = await getAccount(connection, userLpAta);

    // 池子 A、B 代币应减少 (允许 ±1 容差)
    expect(
      tokenAAccountAfter.amount >= tokenAInPool - tokenAOut - BigInt(1) &&
        tokenAAccountAfter.amount <= tokenAInPool - tokenAOut + BigInt(1)
    ).to.be.true;
    expect(
      tokenBAccountAfter.amount >= tokenBInPool - tokenBOut - BigInt(1) &&
        tokenBAccountAfter.amount <= tokenBInPool - tokenBOut + BigInt(1)
    ).to.be.true;

    // LP 总供应量减少应等于有效销毁量
    expect(poolMintInfoAfter.supply).to.equal(poolSupply - poolTokenAmount2);

    // 用户 LP 余额应为 0
    expect(userLpInfoAfter.amount).to.equal(BigInt(0));

    console.log("✅ Withdraw-All-Remaining 校验通过 Tx:", tx);
  });

});
