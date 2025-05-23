import React, { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import BN from 'bn.js';
import {
  TOKEN_PROGRAM_ID,
  getMint
} from '@solana/spl-token';
import { getProgram, POOL_PDA } from '../anchor';

/**
 * SingleDepositForm – 单币存入
 *
 * 流程概要：
 * 1. 读取池子当前 tokenA(tokenB) 储备与 LP mint 总供应量
 * 2. 用户输入想存入的 TokenA(tokenB) 数量 (sourceTokenAmount)
 * 3. 计算 netDepositA (扣 2% fee) 及可铸 LP 数量 ΔL = L*(√(1+R)-1)
 * 4. 按滑点容忍度 (-x%) 得到 minPoolTokenAmount
 * 5. 获取用户 ATA 地址，调用合约 depositSingle(sourceTokenAmount, minPoolTokenAmount)
 * 6. 显示交易签名
 */

const BPS_DENOM = 10_000n;              // basis-point 分母

const SingleDepositForm: React.FC = () => {
  const { wallet, publicKey } = useWallet();

  // ---- UI 状态 ----
  const [tokenSide, setTokenSide] = useState<'A' | 'B'>('A'); // 选择单币类型
  const [amountIn, setAmountIn] = useState<string>(''); // 用户输入 Token 数量
  const [slipPct, setSlipPct] = useState<string>('1');     // 滑点%
  const [estLP, setEstLP] = useState<string>('0');         // 预计铸造 LP
  const [loading, setLoading] = useState(false);
  const [txSig, setTxSig] = useState('');
  const [poolInfo, setPoolInfo] = useState<any>(null);   // Pool 账户
  const [tradeFeeBps, setTradeFeeBps] = useState<bigint>(0n); // 交易费

  // ---- 池子储备 ----
  const [reserveToken, setReserveToken] = useState<bigint>(0n);    // 当前池子 token 数量
  const [poolSupply, setPoolSupply] = useState<bigint>(0n);// LP 总供应量

  // 1. 读取池子储备 & LP 供应
  useEffect(() => {
    if (!wallet) return;
    (async () => {
      try {
        const program = getProgram((wallet as any).adapter ?? wallet);
        const conn = program.provider.connection;

        // 1) 读取池子账户
        const pool = await program.account.swap.fetch(POOL_PDA);
        setPoolInfo(pool);
        setTradeFeeBps(BigInt(pool.tradeFees?.toString() ?? '0'));

        // 2) 按当前选择的 tokenSide 取对应 tokenAccount
        const tokenPda = tokenSide === 'A' ? pool.tokenA : pool.tokenB;

        const [balTok, mintInfo] = await Promise.all([
          conn.getTokenAccountBalance(tokenPda),
          getMint(conn, pool.poolMint),
        ]);
        setReserveToken(BigInt(balTok.value.amount));
        setPoolSupply(BigInt(mintInfo.supply));
      } catch (e) {
        console.error('fetch reserve/poolSupply error', e);
      }
    })();
  }, [wallet, tokenSide]);   // 依赖 tokenSide，切换时重算

  // 2. 计算预计可得 LP
  useEffect(() => {
    if (!amountIn || reserveToken === 0n || poolSupply === 0n) {
      setEstLP('0');
      return;
    }
    try {
      const sourceUnits = BigInt(Math.floor(parseFloat(amountIn) * 1_000_000)); // 6 decimals
      // fee = halfSource * 2%
      const halfSource = (sourceUnits / 2n) > 1n ? (sourceUnits / 2n) : 1n;
      const fee = halfSource * tradeFeeBps / BPS_DENOM;
      const netDepositA = sourceUnits - fee;
      // R = x / A
      const R = Number(netDepositA) / Number(reserveToken);
      const mintedFloat = Number(poolSupply) * (Math.sqrt(1 + R) - 1);
      const mintedLP = Math.floor(mintedFloat);
      setEstLP((mintedLP / 1_000_000).toFixed(6));
    } catch (e) {
      console.error('estimate LP error', e);
      setEstLP('0');
    }
  }, [amountIn, reserveToken, poolSupply, tokenSide, tradeFeeBps]);

  // 3. 提交交易
  const handleDepositSingle = async () => {
    if (!wallet || !publicKey || !amountIn) return;
    setLoading(true);
    try {
      const program = getProgram((wallet as any).adapter ?? wallet);

      const sourceUnits = BigInt(Math.floor(parseFloat(amountIn) * 1_000_000));
      const halfSource = sourceUnits / 2n;
      const fee = halfSource * tradeFeeBps / BPS_DENOM;
      const netDepositA = sourceUnits - fee;
      const R = Number(netDepositA) / Number(reserveToken);
      const mintedFloat = Number(poolSupply) * (Math.sqrt(1 + R) - 1);
      const mintedLP = BigInt(Math.floor(mintedFloat));

      // 滑点保护：min LP = mintedLP * (100 - slip) / 100
      const slip = parseFloat(slipPct) || 0;
      const minLp = mintedLP * BigInt(100 - slip) / 100n;

      const mintKey  = tokenSide === 'A' ? poolInfo.tokenAMint  : poolInfo.tokenBMint;
      const poolTokenPda = tokenSide === 'A' ? poolInfo.tokenA : poolInfo.tokenB;

      const tx = await program.methods
        .depositSingle(
          new BN(sourceUnits.toString()),
          new BN(minLp.toString())
        )
        .accounts({
          user: publicKey,
          poolToken: poolTokenPda,
          mint: mintKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      setTxSig(tx);
    } catch (err) {
      console.error('deposit-single failed:', err);
      setTxSig('');
    } finally {
      setLoading(false);
    }
  };

  if (!poolInfo) {
    return <p style={{ color: '#fff' }}>加载池子信息中…</p>;
  }

  return (
    <div className="deposit-form">
      <h2>单币存入 (Token&nbsp;{tokenSide})</h2>

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

      <div>
        <label>存入 Token&nbsp;{tokenSide} 数量：</label>
        <input
          type="number"
          value={amountIn}
          onChange={e => setAmountIn(e.target.value)}
          placeholder="如 200.0"
          disabled={loading}
        />
      </div>

      <div>
        <label>滑点容忍度 (%): </label>
        <input
          type="number"
          value={slipPct}
          onChange={e => setSlipPct(e.target.value)}
          disabled={loading}
        />
      </div>

      <p>预计可获得 LP: {estLP}</p>

      <button onClick={handleDepositSingle} disabled={loading || !amountIn}>
        {loading ? '提交中...' : '立即存入'}
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

export default SingleDepositForm;