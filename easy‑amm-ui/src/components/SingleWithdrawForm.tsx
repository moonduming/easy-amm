import React, { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import {
  getMint,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { getProgram, POOL_PDA } from '../anchor';

/**
 * SingleWithdrawForm – 单币提取（用户指定 Token A 或 Token B）
 *
 * 公式 (与测试保持一致)：
 *   - 先计算需要烧毁的 LP (burnLP) 以及 withdraw_fee
 *   - maxPoolTokenBurn = (burnLP + withdraw_fee) * (1 + slip%)
 *   - 调用 withdrawSingle(destAmount, maxPoolTokenBurn)
 */

const BPS_DENOM = 10_000n;

const SingleWithdrawForm: React.FC = () => {
  const { wallet, publicKey } = useWallet();
  

  // ---- 组件状态 ----
  const [tokenSide, setTokenSide] = useState<'A' | 'B'>('A');
  const [destAmount, setDestAmount] = useState<string>(''); // 用户想提取的 token 数量
  const [slipPct, setSlipPct] = useState<string>('1');      // 滑点 %
  const [estLP, setEstLP] = useState<string>('0');  // 预计烧毁 LP
  const [loading, setLoading] = useState(false);
  const [txSig, setTxSig] = useState('');
  const [poolInfo, setPoolInfo] = useState<any>(null);   // Pool 账户
  const [tradeFeeBps, setTradeFeeBps] = useState<bigint>(0n); // 交易费
  const [withdrawFeeBps, setWithdrawFeeBps] = useState<bigint>(0n); // 交易费

  // ---- 池子储备 ----
  const [reserveToken, setReserveToken] = useState<bigint>(0n);
  const [poolSupply, setPoolSupply] = useState<bigint>(0n);

  // 1. 同步池子 token 储备 & LP 供应
  useEffect(() => {
    if (!wallet) return;
    (async () => {
      try {
        const program = getProgram((wallet as any).adapter ?? wallet);
        const conn = program.provider.connection;

        const pool = await program.account.swap.fetch(POOL_PDA);
        setPoolInfo(pool);
        setTradeFeeBps(BigInt(pool.tradeFees?.toString() ?? '0'));
        setWithdrawFeeBps(BigInt(pool.withdrawFees?.toString() ?? '0'));

        const tokenPda = tokenSide === 'A' ? pool.tokenA : pool.tokenB;
        const [balTok, mintInfo] = await Promise.all([
          conn.getTokenAccountBalance(new PublicKey(tokenPda)),
          getMint(conn, new PublicKey(pool.poolMint)),
        ]);

        setReserveToken(BigInt(balTok.value.amount));
        setPoolSupply(BigInt(mintInfo.supply));
      } catch (e) {
        console.error('fetch reserve/poolSupply error', e);
      }
    })();
  }, [wallet, tokenSide]);

  // 2. 实时估算 burn LP
  useEffect(() => {
    if (!destAmount || reserveToken === 0n || poolSupply === 0n) {
      setEstLP('0');
      return;
    }
    try {
      const destUnits = BigInt(Math.floor(parseFloat(destAmount) * 1_000_000)); // 6 decimals

      // ------- 逻辑与测试脚本一致 -------
      const halfSource = (destUnits + 1n) / 2n;
      const numerator = halfSource * BPS_DENOM;
      const denominator = BPS_DENOM - tradeFeeBps;
      const trade_fee_source_amount = (numerator + denominator - 1n) / denominator;
      const netDeposit = destUnits - halfSource + trade_fee_source_amount;

      const R = Number(netDeposit) / Number(reserveToken);
      const mintedFloat =
        Number(poolSupply) * (1 - Math.sqrt(1 - R));
      const burnLP = BigInt(Math.ceil(mintedFloat));

      // withdraw fee
      const withdraw_fee = burnLP * withdrawFeeBps / BPS_DENOM;
      const lpTotal = burnLP + withdraw_fee;

      setEstLP((Number(lpTotal) / 1_000_000).toFixed(6));
    } catch (e) {
      console.error('estimate burn LP error', e);
      setEstLP('0');
    }
  }, [destAmount, reserveToken, poolSupply, tradeFeeBps, withdrawFeeBps]);

  // 3. 提交交易
  const handleWithdrawSingle = async () => {
    if (!wallet || !publicKey || !destAmount) return;
    setLoading(true);
    try {
      const program = getProgram((wallet as any).adapter ?? wallet);

      const destUnits = BigInt(Math.floor(parseFloat(destAmount) * 1_000_000));
      const halfSource = (destUnits + 1n) / 2n;
      const numerator = halfSource * BPS_DENOM;
      const denominator = BPS_DENOM - tradeFeeBps;
      const tradeFeeSrcAmt = (numerator + denominator - 1n) / denominator;
      const netDeposit = destUnits - halfSource + tradeFeeSrcAmt;

      const R = Number(netDeposit) / Number(reserveToken);
      const mintedFloat =
        Number(poolSupply) * (1 - Math.sqrt(1 - R));
      const burnLP = BigInt(Math.ceil(mintedFloat));
      const withdrawFee = burnLP * withdrawFeeBps / BPS_DENOM;
      const lpTotal = burnLP + withdrawFee;

      // 滑点上限 (+ slipPct %)
      const slip = parseFloat(slipPct) || 0;
      const maxPoolTokenBurn = lpTotal * BigInt(100 + slip) / 100n;

      // poolToken PDA
      const poolTokenPda = tokenSide === 'A' ? poolInfo.tokenA : poolInfo.tokenB;
      const mintKey = tokenSide === 'A' ? poolInfo.tokenAMint : poolInfo.tokenBMint;

      const tx = await program.methods
        .withdrawSingle(
          new BN(destUnits.toString()),
          new BN(maxPoolTokenBurn.toString())
        )
        .accounts({
          user: publicKey,
          poolToken: poolTokenPda,
          mint: mintKey,
          poolFeeAccount: poolInfo.poolFeeAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      setTxSig(tx);
    } catch (err) {
      console.error('withdrawSingle failed:', err);
      setTxSig('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="deposit-form">
      <h2>单币提取 (Token&nbsp;{tokenSide})</h2>

      {/* 选择币种 */}
      <div>
        <label>选择币种：</label>
        <select
          value={tokenSide}
          onChange={e => setTokenSide(e.target.value as 'A' | 'B')}
          disabled={loading}
        >
          <option value="A">Token A</option>
          <option value="B">Token B</option>
        </select>
      </div>

      {/* 输入想要提取的 token 数量 */}
      <div>
        <label>提取 Token&nbsp;{tokenSide} 数量：</label>
        <input
          type="number"
          value={destAmount}
          onChange={e => setDestAmount(e.target.value)}
          placeholder="如 500.0"
          disabled={loading}
        />
      </div>

      {/* 滑点容忍度 */}
      <div>
        <label>滑点容忍度 (%):</label>
        <input
          type="number"
          value={slipPct}
          onChange={e => setSlipPct(e.target.value)}
          disabled={loading}
        />
      </div>

      <p>
        预计支付 LP: {estLP}
      </p>

      <button onClick={handleWithdrawSingle} disabled={loading || !destAmount}>
        {loading ? '提交中...' : '立即提取'}
      </button>

      {txSig && (
        <p>
          交易成功！签名：<a
            href={`https://explorer.solana.com/tx/${txSig}?cluster=custom&customUrl=${encodeURIComponent('http://localhost:8899')}`}
            target="_blank" rel="noreferrer"
          >{txSig}</a>
        </p>
      )}
    </div>
  );
};

export default SingleWithdrawForm;