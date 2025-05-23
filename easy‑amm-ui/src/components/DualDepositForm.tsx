import { getMint } from '@solana/spl-token';
import React, { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getProgram, POOL_PDA } from '../anchor';

/**
 * DualDepositForm – 双币存入 LP
 *
 * 重要流程：
 * 1. 读取池子储备 tokenA / tokenB 与 LP mint 总供应量
 * 2. 用户输入想要的 LP 数量 (poolTokenAmount)
 * 3. 计算应当提供的 tokenARequired、tokenBRequired
 * 4. 根据滑点容忍度(+x%) 得到 maxTokenA / maxTokenB
 * 5. 调用合约 deposit(poolTokenAmount, maxTokenA, maxTokenB)
 * 6. 显示交易签名
 */

const DualDepositForm: React.FC = () => {
  const { publicKey, wallet } = useWallet();

  // ----- UI 状态 -----
  const [lpAmount, setLpAmount] = useState<string>('');        // 期望获得 LP 数量
  const [slipPct, setSlipPct] = useState<string>('1');         // 滑点百分比
  const [estA, setEstA] = useState<string>('0');               // 估算需提供 tokenA
  const [estB, setEstB] = useState<string>('0');               // 估算需提供 tokenB
  const [loading, setLoading] = useState(false);
  const [txSig, setTxSig] = useState('');

  // ----- 池子状态 -----
  const [reserveA, setReserveA] = useState<bigint>(0n);
  const [reserveB, setReserveB] = useState<bigint>(0n);
  const [poolSupply, setPoolSupply] = useState<bigint>(0n);
  const [poolInfo, setPoolInfo] = useState<any>(null);
  const [tokenAMint, setTokenAMint] = useState<PublicKey | null>(null);
  const [tokenBMint, setTokenBMint] = useState<PublicKey | null>(null);

  // -------------------- 1. 读取池子储备和 LP 供应 --------------------
  useEffect(() => {
    if (!wallet) return;

    (async () => {
      try {
        const program = getProgram((wallet as any).adapter ?? wallet);
        const conn = program.provider.connection;

        // 1) 读取池子账户
        const pool = await program.account.swap.fetch(POOL_PDA);
        setPoolInfo(pool);
        setTokenAMint(pool.tokenAMint);
        setTokenBMint(pool.tokenBMint);

        // 2) 查询 tokenA / tokenB 储备余额
        const [balA, balB, mintInfo] = await Promise.all([
          conn.getTokenAccountBalance(pool.tokenA),
          conn.getTokenAccountBalance(pool.tokenB),
          getMint(conn, pool.poolMint),
        ]);

        setReserveA(BigInt(balA.value.amount));
        setReserveB(BigInt(balB.value.amount));
        setPoolSupply(BigInt(mintInfo.supply));
      } catch (e) {
        console.error('fetch pool info error', e);
      }
    })();
  }, [wallet]);

  // -------------------- 2. 计算需要提供的 Token 数量 --------------------
  useEffect(() => {
    if (!lpAmount || poolSupply === 0n) {
      setEstA('0');
      setEstB('0');
      return;
    }
    try {
      const lpUnits = BigInt(Math.floor(parseFloat(lpAmount) * 1_000_000)); // 6 decimals
      const tokenARequired = (lpUnits * reserveA) / poolSupply;
      const tokenBRequired = (lpUnits * reserveB) / poolSupply;

      setEstA((Number(tokenARequired) / 1_000_000).toFixed(6));
      setEstB((Number(tokenBRequired) / 1_000_000).toFixed(6));
    } catch (e) {
      console.error('estimate deposit error', e);
      setEstA('0');
      setEstB('0');
    }
  }, [lpAmount, reserveA, reserveB, poolSupply]);

  // -------------------- 3. 提交存入交易 --------------------
  const handleDeposit = async () => {
    if (!wallet || !publicKey || !lpAmount || !tokenAMint || !tokenBMint) return;
    setLoading(true);
    try {
      const program = getProgram((wallet as any).adapter ?? wallet);
      const lpUnits = BigInt(Math.floor(parseFloat(lpAmount) * 1_000_000)); // 6 decimals

      // 再次计算实际需要
      const tokenARequired = (lpUnits * reserveA) / poolSupply;
      const tokenBRequired = (lpUnits * reserveB) / poolSupply;

      // 加滑点：+ slipPct %
      const slip = parseFloat(slipPct) || 0;
      const slipFactor = 1 + slip / 100;
      const maxTokenA = BigInt(Math.ceil(Number(tokenARequired) * slipFactor));
      const maxTokenB = BigInt(Math.ceil(Number(tokenBRequired) * slipFactor));

      const tx = await program.methods
        .deposit(
          new BN(lpUnits.toString()),
          new BN(maxTokenA.toString()),
          new BN(maxTokenB.toString())
        )
        .accounts({
          user: publicKey,
          tokenAMint,
          tokenBMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      setTxSig(tx);
    } catch (err) {
      console.error('deposit failed', err);
      setTxSig('');
    } finally {
      setLoading(false);
    }
  };

  // -------------------- 4. 早期返回：等待 poolInfo
  if (!poolInfo) {
    return <p style={{ color: '#fff' }}>加载池子信息中…</p>;
  }

  return (
    <div className="deposit-form">
      <h2>双币存入</h2>

      <div>
        <label>想要获得 LP 数量：</label>
        <input
          type="number"
          value={lpAmount}
          onChange={e => setLpAmount(e.target.value)}
          placeholder="如 2.0 表示 2 LP"
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

      <p>
        预计需要： {estA} Token&nbsp;A&nbsp;&nbsp;/&nbsp;&nbsp;{estB} Token&nbsp;B
      </p>

      <button onClick={handleDeposit} disabled={loading || !lpAmount}>
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

export default DualDepositForm;