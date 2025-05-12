# easy-amm
anchor amm

# easy-amm

A simple Automated Market Maker (AMM) implemented on Solana using the Anchor framework.  
This project demonstrates a minimal on-chain token swap using the constant product formula (x * y = k), inspired by Uniswap v2 and Solana's SPL Token Swap.

## ✨ Features

- Liquidity pool creation
- Constant product (x * y = k) swap logic
- Token deposit and withdrawal
- LP token minting and burning
- Anchor program written in Rust

## 📦 Technologies

- Solana blockchain
- Anchor framework
- SPL Token program
- Rust programming language

## 📁 Directory Structure

```
programs/easy_amm     # Anchor smart contract source code
tests/                # Integration tests using Anchor's test framework
```

## 🧠 Concepts Covered

- PDA (Program Derived Address) authority and signer
- Token transfer via CPI (Cross-Program Invocation)
- Vault and liquidity pool management
- Safe math operations and fee deduction

## 🚀 Getting Started

```bash
anchor build
anchor deploy
anchor test
```

Make sure you have `solana-cli`, `anchor-cli`, and a funded devnet wallet before deploying.

## 📚 Inspired By

- [Uniswap v2 Whitepaper](https://uniswap.org/whitepaper-v2.pdf)
- [SPL Token Swap](https://github.com/solana-labs/solana-program-library/tree/master/token-swap)

## 🏷️ Tags

Solana, Anchor, AMM, Rust, Token Swap, DeFi, Liquidity Pool
