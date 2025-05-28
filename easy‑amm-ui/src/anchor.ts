// src/anchor.ts
import {
    AnchorProvider,
    Program,
    web3
  } from "@coral-xyz/anchor";

import type { EasyAmm } from "../../target/types/easy_amm";
import idl from "../../target/idl/easy_amm.json";
  
  // ——📌 你的常量——
  // 明确声明类型，避免 TS 把它误判为 Provider
  export const PROGRAM_ID: web3.PublicKey = new web3.PublicKey("Ds2VNJ6Ay2JVfGhLedAHAiyUyDTMGW8A8dBXneLdDhBe");
  export const NETWORK    = "http://127.0.0.1:8899"; // devnet / localnet
  export const COMMITMENT = "confirmed";
  
  // ——连接 provider——
  export const getProvider = (wallet: any) => {
    const connection = new web3.Connection(NETWORK, COMMITMENT);
    return new AnchorProvider(connection, wallet, { preflightCommitment: COMMITMENT });
  };
  
  // ——实例化 Program——
  export const getProgram = (wallet: any) => {
    const provider = getProvider(wallet);
    return new Program<EasyAmm>(
      idl as any,
      provider as AnchorProvider
    );
  };

// --- 池子账户 PDA（固定地址）---
// 需要根据自己池子账户地址进行变更
export const POOL_PDA = new web3.PublicKey(
  "4mdJX3PJzzdpmJqnRgCUoCatFBR1dyr2r9gr4xHNTy3r"
);

