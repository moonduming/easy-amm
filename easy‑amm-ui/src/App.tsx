import { useEffect, useMemo, useState } from 'react';
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from '@solana/wallet-adapter-react';
import {
  WalletModalProvider,
  WalletMultiButton,
} from '@solana/wallet-adapter-react-ui';
import {
  SolflareWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { clusterApiUrl, PublicKey } from '@solana/web3.js';
import { getProgram, POOL_PDA } from './anchor';
import './App.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import DualDepositForm from './components/DualDepositForm';
import SwapForm from './components/SwapForm';
import SingleDepositForm from './components/SingleDepositForm';
import DualWithdrawForm from './components/DualWithdrawForm';
import SingleWithdrawForm from './components/SingleWithdrawForm';


const endpoint = clusterApiUrl(WalletAdapterNetwork.Devnet);

// ---------------- PoolInfo -----------------
function PoolInfo() {
  const { wallet, publicKey } = useWallet();
  const [amountA, setAmountA] = useState<string>('0');
  const [amountB, setAmountB] = useState<string>('0');

  const decimals = 6;
  const humanA = (Number(amountA) / 10 ** decimals).toFixed(4);
  const humanB = (Number(amountB) / 10 ** decimals).toFixed(4);

  useEffect(() => {
    if (!wallet || !publicKey) return;

    (async () => {
      try {
        const program = getProgram(wallet.adapter ?? wallet);
        const swap = await program.account.swap.fetch(POOL_PDA);

        const conn = program.provider.connection;
        const tokenAPub = new PublicKey(swap.tokenA);
        const tokenBPub = new PublicKey(swap.tokenB);

        const [balA, balB] = await Promise.all([
          conn.getTokenAccountBalance(tokenAPub),
          conn.getTokenAccountBalance(tokenBPub),
        ]);

        setAmountA(balA.value.amount);
        setAmountB(balB.value.amount);
      } catch (err) {
        console.error('获取池子余额失败', err);
        setAmountA('0');
        setAmountB('0');
      }
    })();
  }, [wallet, publicKey]);

  if (!wallet) {
    return <p style={{ color: '#fff' }}>请先连接钱包…</p>;
  }

  const ratio =
    Number(amountB) === 0 ? 'N/A' : (Number(amountA) / Number(amountB)).toFixed(4);

  return (
    <div className="pool-info">
      <h2>池子状态</h2>
      <p>A 代币数量: {humanA}</p>
      <p>B 代币数量: {humanB}</p>
      <p>兑换比 A/B: {ratio}</p>
    </div>
  );
}

// ---------------- Main -----------------
function App() {
  const wallets = useMemo(
    () => [
      new SolflareWalletAdapter({ network: WalletAdapterNetwork.Devnet }),
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <main className="container">
            <header className="header">
              <h1>easy-amm UI</h1>
              <WalletMultiButton className="wallet-button" />
            </header>

            <section className="content">
              <div className="app-grid">
                <div className="card">
                  <PoolInfo />
                </div>
                <div className="card">
                  <SingleDepositForm />
                </div>
                <div className="card">
                  <SingleWithdrawForm />
                </div>
                <div className="card">
                  <SwapForm />
                </div>
                <div className="card">
                  <DualDepositForm />
                </div>
                <div className="card">
                  <DualWithdrawForm />
                </div>
              </div>
            </section>
          </main>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export default App;
