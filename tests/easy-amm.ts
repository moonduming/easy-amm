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
      throw new Error("❌ 用户密钥文件 user.secret.json 不存在，请先运行 createEnvironment 初始化！");
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
      userTokenA: userTokenA,
      userTokenB: userTokenB,
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
    const tx = await program.methods.deposiit(
      new anchor.BN(poolTokenAmount.toString()),           // 想要 2_000 LP
      new anchor.BN(maxTokenA.toString()), 
      new anchor.BN(maxTokenB.toString())
    ).accounts({
      user: user.publicKey,
      tokenAMint: mintA,
      tokenBMint: mintB,
      userTokenA: userTokenA,
      userTokenB: userTokenB,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID
    }).signers([user]).rpc();

    // 校验
    const tokenAAccountAfter = await getAccount(connection, tokenAPda);
    const tokenBBccountAfter = await getAccount(connection, tokenBPda);
    const poolMintInfoAfter  = await getMint(connection, poolMint);
  
    // 5.1 池子 A, B 代币增加
    expect(tokenAAccountAfter.amount).to.equal(tokenAInPool + tokenARequired);
    expect(tokenBBccountAfter.amount).to.equal(tokenBInPool + tokenBRequired);
  
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
      userMintAccount: OlduserLpAta,
      poolFeeAccount,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID
    }).signers([user]).rpc();

    // 校验
    const tokenAAccountAfter = await getAccount(connection, tokenAPda);
    const tokenBBccountAfter = await getAccount(connection, tokenBPda);
    const poolMintInfoAfter  = await getMint(connection, poolMint);
  
    // 池子 A, B 代币减少
    expect(tokenAAccountAfter.amount).to.equal(tokenAInPool - tokenAOut);
    expect(tokenBBccountAfter.amount).to.equal(tokenBInPool - tokenBOut);
  
    // LP 池币总供应量应
    expect(poolMintInfoAfter.supply).to.equal(poolSupply - poolTokenAmount2);
  
    // 用户 LP 余额
    const userLpAta = await getAssociatedTokenAddress(poolMint, user.publicKey);
    const userLpInfo = await getAccount(connection, userLpAta);
    expect(userLpInfo.amount).to.equal(OlduserLpaAmount - BigInt(poolTokenAmount.toString()));
  
    console.log("✅ Deposit 校验通过Tx: ", tx);
  });

});
