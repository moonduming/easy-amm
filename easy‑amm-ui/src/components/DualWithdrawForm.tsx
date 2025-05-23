import React, { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import {
  getMint,
  TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import { getProgram, POOL_PDA } from '../anchor';

/**
 * DualWithdrawForm – 用户烧毁 LP，按比例领取 Token A / Token B
 *
 * 公式概览（与后端保持一致）：
 *   raw_out  = LP_burn * reserve / total_supply
 *   user_out = raw_out * (1 - WITHDRAW_FEE_BPS/10_000)
 */

// const WITHDRAW_FEE_BPS = ADDRS.WITHDRAW_FEE_BPS; // 3%
const BPS_DENOM = 10_000n;

const DualWithdrawForm: React.FC = () => {
  const { wallet, publicKey } = useWallet();

  // --- UI 状态 ---
  const [lpAmount, setLpAmount] = useState<string>('');
  const [slipPct, setSlipPct] = useState<string>('1');
  const [estA, setEstA] = useState<string>('0');
  const [estB, setEstB] = useState<string>('0');
  const [loading, setLoading] = useState(false);
  const [txSig, setTxSig] = useState('');

  // --- 池子状态 ---
  const [reserveA, setReserveA] = useState<bigint>(0n);
  const [reserveB, setReserveB] = useState<bigint>(0n);
  const [poolSupply, setPoolSupply] = useState<bigint>(0n);
  const [poolInfo, setPoolInfo] = useState<any>(null);
  const [withdraFeeBps, setWithdraFeeBps] = useState<bigint>(0n); // 交易费

  // 1. 读取池子储备 & LP 供应
  useEffect(() => {
    if (!wallet) return;
    (async () => {
      try {
        const program = getProgram((wallet as any).adapter ?? wallet);
        const conn = program.provider.connection;

        const pool = await program.account.swap.fetch(POOL_PDA);
        setPoolInfo(pool);
        setWithdraFeeBps(BigInt(pool.withdrawFees?.toString() ?? '0'));
        const [balA, balB, mintInfo] = await Promise.all([
          conn.getTokenAccountBalance(new PublicKey(pool.tokenA)),
          conn.getTokenAccountBalance(new PublicKey(pool.tokenB)),
          getMint(conn, new PublicKey(pool.poolMint))
        ]);

        setReserveA(BigInt(balA.value.amount));
        setReserveB(BigInt(balB.value.amount));
        setPoolSupply(BigInt(mintInfo.supply));
      } catch (e) {
        console.error('fetch reserves/mint error', e);
      }
    })();
  }, [wallet]);

  // 2. 计算预估领取 tokenA / tokenB
  useEffect(() => {
    if (!lpAmount || poolSupply === 0n) {
      setEstA('0');
      setEstB('0');
      return;
    }
    try {
      const lpUnits = BigInt(Math.floor(parseFloat(lpAmount) * 1_000_000)); // 6 decimals
      const lpAfterFee = lpUnits * (BPS_DENOM - withdraFeeBps) / BPS_DENOM;

      const tokenAOut = (lpAfterFee * reserveA) / poolSupply;
      const tokenBOut = (lpAfterFee * reserveB) / poolSupply;

      setEstA((Number(tokenAOut) / 1_000_000).toFixed(6));
      setEstB((Number(tokenBOut) / 1_000_000).toFixed(6));
    } catch (e) {
      console.error('estimate withdraw error', e);
      setEstA('0');
      setEstB('0');
    }
  }, [lpAmount, reserveA, reserveB, poolSupply, withdraFeeBps]);

  // 3. 提交 withdrawAll 交易
  const handleWithdraw = async () => {
    if (!wallet || !publicKey || !lpAmount) return;
    setLoading(true);
    try {
      const program = getProgram((wallet as any).adapter ?? wallet);

      const lpUnits = BigInt(Math.floor(parseFloat(lpAmount) * 1_000_000));
      const lpAfterFee = lpUnits * (BPS_DENOM - withdraFeeBps) / BPS_DENOM;

      const tokenAOut = (lpAfterFee * reserveA) / poolSupply;
      const tokenBOut = (lpAfterFee * reserveB) / poolSupply;

      // 滑点保护
      const slip = parseFloat(slipPct) || 0;
      const minA = tokenAOut * BigInt(100 - slip) / 100n;
      const minB = tokenBOut * BigInt(100 - slip) / 100n;

      const tx = await program.methods
        .withdrawAll(
          new BN(lpUnits.toString()),
          new BN(minA.toString()),
          new BN(minB.toString())
        )
        .accounts({
          user: publicKey,
          tokenAMint: poolInfo.tokenAMint,
          tokenBMint: poolInfo.tokenBMint,
          poolFeeAccount: poolInfo.poolFeeAccount,
          tokenProgram: TOKEN_PROGRAM_ID
        })
        .rpc();

      setTxSig(tx);
    } catch (err) {
      console.error('withdrawAll failed:', err);
      setTxSig('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="deposit-form">
      <h2>双币提取</h2>

      <div>
        <label>烧毁 LP 数量：</label>
        <input
          type="number"
          value={lpAmount}
          onChange={e => setLpAmount(e.target.value)}
          placeholder="如 2.0 表示 2 LP"
          disabled={loading}
        />
      </div>

      <div>
        <label>滑点容忍度 (%)：</label>
        <input
          type="number"
          value={slipPct}
          onChange={e => setSlipPct(e.target.value)}
          disabled={loading}
        />
      </div>

      <p>预计领取: {estA} Token A / {estB} Token B</p>

      <button onClick={handleWithdraw} disabled={loading || !lpAmount}>
        {loading ? '提交中...' : '立即提取'}
      </button>

      {txSig && (
        <p>
          交易成功！签名: <a
            href={`https://explorer.solana.com/tx/${txSig}?cluster=custom&customUrl=${encodeURIComponent('http://localhost:8899')}`}
            target="_blank" rel="noreferrer"
          >{txSig}</a>
        </p>
      )}
    </div>
  );
};

export default DualWithdrawForm;
