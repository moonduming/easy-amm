import React, { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import { getProgram, POOL_PDA } from '../anchor';

// ---- 兑换公式相关常量 ----
// const DECIMALS = 6;                             // Token 精度，6 位
// const DECIMAL_FACTOR = 10n ** BigInt(DECIMALS); // 10^6

const SLIPPAGE_DENOM = 10_000n;                 // 用 1 bp = 0.01%

/**
 * SwapForm 组件
 * 
 * 重要步骤：
 * 1. 获取钱包对象（publicKey, wallet）
 * 2. 用户输入：兑换方向 & 兑换数量
 * 3. 调用合约 swap 方法发起交易
 * 4. 显示交易签名，或 loading 状态
 */
const SwapForm: React.FC = () => {
  // 1. 获取钱包和账户信息
  const { publicKey, wallet } = useWallet();
  
  // 2. 组件状态
  const [amount, setAmount] = useState<string>('');
  const [swapDirection, setSwapDirection] = useState<'AtoB' | 'BtoA'>('AtoB');
  const [txSig, setTxSig] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [pool, setPool] = useState<any | null>(null);
  const [reserveA, setReserveA] = useState<bigint>(0n);
  const [reserveB, setReserveB] = useState<bigint>(0n);
  const [slipPct, setSlipPct] = useState<string>('1');
  const [estOut, setEstOut] = useState<string>('0');

  // ---- 交易费常量 ----
  const TRADE_FEE_BPS = pool ? BigInt(pool.tradeFees?.toString() ?? '0') : 0n;
  const FEE_DENOM = 10_000n;
  useEffect(() => {
    if (!wallet || pool) return;
    (async () => {
      try {
        const program = getProgram((wallet as any).adapter ?? wallet);
        const swapAccount = await program.account.swap.fetch(POOL_PDA);
        setPool(swapAccount);
      } catch (e) {
        console.error('fetch pool account error', e);
      }
    })();
  }, [wallet, pool]);

  useEffect(() => {
    if (!wallet || !pool) return;
    (async () => {
      try {
        const program = getProgram((wallet as any).adapter ?? wallet);
        const conn = program.provider.connection;
        // 读取池子 tokenAccount 余额
        const [balA, balB] = await Promise.all([
          conn.getTokenAccountBalance(new PublicKey(pool.tokenA)),
          conn.getTokenAccountBalance(new PublicKey(pool.tokenB))
        ]);
        setReserveA(BigInt(balA.value.amount));
        setReserveB(BigInt(balB.value.amount));
      } catch (e) {
        console.error('fetch reserves error', e);
      }
    })();
  }, [wallet, pool]);

  useEffect(() => {
    if (!amount || reserveA === 0n || reserveB === 0n) {
      setEstOut('0');
      return;
    }
    try {
      const amountInUnits = BigInt(Math.floor(parseFloat(amount) * 1_000_000)); // 6 decimals
      if (amountInUnits === 0n) { setEstOut('0'); return; }

      const fees = amountInUnits * TRADE_FEE_BPS / FEE_DENOM;
      const sourceAmt = amountInUnits - fees;

      let dest: bigint;
      if (swapDirection === 'AtoB') {
        const k = reserveA * reserveB;
        const newA = reserveA + sourceAmt;
        const newB = (k + newA - 1n) / newA;
        dest = reserveB - newB;
      } else {
        const k = reserveA * reserveB;
        const newB = reserveB + sourceAmt;
        const newA = (k + newB - 1n) / newB;
        dest = reserveA - newA;
      }
      const human = Number(dest) / 1_000_000;
      setEstOut(human.toFixed(6));
    } catch (e) {
      console.error('estimate error', e);
      setEstOut('0');
    }
  }, [amount, swapDirection, reserveA, reserveB, TRADE_FEE_BPS, FEE_DENOM]);

  if (!wallet) return <p style={{ color: '#fff' }}>请先连接钱包…</p>;
  if (!publicKey) return <p style={{ color: '#fff' }}>钱包已连接但无公钥</p>;
  if (!pool) return <p style={{ color: '#fff' }}>加载池子信息中…</p>;


  const handleSwap = async () => {
    if (!wallet || !publicKey || !amount) return;
    setLoading(true);
    try {
      const program = getProgram((wallet as any).adapter ?? wallet);
      const amountInUnits = BigInt(Math.floor(parseFloat(amount) * 1_000_000)); // 6 decimals

      // 重新计算预估输出（避免用户改动期间数据变化）
      const fees = amountInUnits * TRADE_FEE_BPS / FEE_DENOM;
      const sourceAmt = amountInUnits - fees;
      let dest: bigint;
      if (swapDirection === 'AtoB') {
        const k = reserveA * reserveB;
        const newA = reserveA + sourceAmt;
        const newB = (k + newA - 1n) / newA;
        dest = reserveB - newB;
      } else {
        const k = reserveA * reserveB;
        const newB = reserveB + sourceAmt;
        const newA = (k + newB - 1n) / newB;
        dest = reserveA - newA;
      }

      // 根据用户滑点生成 minimum_amount_out
      const slipBps = BigInt(Math.floor(parseFloat(slipPct) * 100)); // 1% -> 100bps
      const minOut = dest * (SLIPPAGE_DENOM - slipBps) / SLIPPAGE_DENOM;

      const tx = await program.methods
        .exchange(
          swapDirection === 'AtoB',
          new BN(amountInUnits.toString()),
          new BN(minOut.toString())
        )
        .accounts({
          user: publicKey,
          tokenAMint: pool.tokenAMint,
          tokenBMint: pool.tokenBMint,
          tokenProgram: TOKEN_PROGRAM_ID
        })
        .rpc();

      setTxSig(tx);
    } catch (err) {
      console.error('Swap failed:', err);
      setTxSig('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="swap-form">
      <h2>代币兑换</h2>
      {/* 选择兑换方向 */}
      <div>
        <label>兑换方向：</label>
        <select
          value={swapDirection}
          onChange={e => setSwapDirection(e.target.value as 'AtoB' | 'BtoA')}
        >
          <option value="AtoB">A → B</option>
          <option value="BtoA">B → A</option>
        </select>
      </div>

      {/* 输入数量 */}
      <div>
        <label>输入金额：</label>
        <input
          type="number"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="请输入数量"
          disabled={loading}
        />
      </div>

      {/* 滑点容忍度 */}
      <div>
        <label>滑点容忍度 (%)：</label>
        <input
          type="number"
          value={slipPct}
          onChange={e => setSlipPct(e.target.value)}
          placeholder="例如 1 表示 1%"
          disabled={loading}
        />
      </div>

      {/* 预估可得 */}
      <p>预计可获得: {estOut} {swapDirection === 'AtoB' ? 'Token B' : 'Token A'}</p>

      {/* 发送交易 */}
      <button onClick={handleSwap} disabled={loading || !amount}>
        {loading ? '交换中...' : '立即兑换'}
      </button>

      {/* 交易签名链接 */}
      {txSig && (
        <p>
          交易成功！签名: {' '}
          <a
            href={`https://explorer.solana.com/tx/${txSig}?cluster=custom&customUrl=${encodeURIComponent('http://localhost:8899')}`}
            target="_blank"
            rel="noreferrer"
          >
            {txSig}
          </a>
        </p>
      )}
    </div>
  );
};

export default SwapForm;