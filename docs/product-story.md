# BOT Pulse Product Story

## The problem

Real-world device networks need more than a pretty dashboard. Gateways, sensors, data relays, and node operators need a cheap way to show that a device is registered, recently alive, and publishing data with a verifiable trail.

Putting every raw device reading on-chain is expensive and unnecessary. But putting nothing on-chain leaves freshness claims dependent on a private backend.

## The BOT Pulse approach

BOT Pulse splits the responsibility:

- raw data stays off-chain;
- each device packet is hashed;
- the packet hash, metric label, metric value, and observed timestamp are anchored in a BOT Chain testnet transaction;
- the dashboard reads the deployed registry contract directly from BOT Chain RPC;
- explorers provide an external verification path for the contract and heartbeat transactions.

The MVP uses simulated device agents, but the interface maps to real DePIN gateways: register a device ID, submit heartbeat packets, and expose freshness state for verifiers.

## What the demo proves

- A deployed `BotPulseRegistry` contract exists on BOT Chain testnet.
- A gateway device ID can be registered on-chain.
- Heartbeat transactions update the latest packet hash and metric state.
- Freshness is computed from the contract's latest heartbeat timestamp.
- The website can load live state from BOT Chain RPC without requiring wallet connection first.
- Users with a funded BOT Chain testnet wallet can register their own device label and send a pulse from the UI.

## What it does not claim

- It is not production hardware.
- It is not an audited DePIN protocol.
- It does not include token rewards, settlement, or device identity hardware.
- It stores packet hashes and freshness metadata on-chain, not raw sensor data.

## Why BOT Chain fits

DePIN systems produce frequent small proofs: liveness, uptime, freshness, data availability, gateway observations, relay checks. BOT Pulse shows how those small proof-of-freshness events can be represented as EVM transactions on BOT Chain testnet and verified through familiar wallet, RPC, and explorer tooling.

## Evidence links

- Contract: https://scan.bohr.life/address/0x588eb96429A3c22f22848185F2b5FfD08AdfD8Ae
- Deployment tx: https://scan.bohr.life/tx/0x30b40b0cf3b54c575db6926379d31d605e89210d87d46ddb81c26cd35bbfaeb3
- Registration tx: https://scan.bohr.life/tx/0x94655b48d262f0664e88081b8f5b487fe5662aaf6da811bb94d24b19706ef530
- Latest heartbeat tx: https://scan.bohr.life/tx/0x6accffb04d604a0c6fa299db190574741b5b2b9c450398a9bfd82a9c29592251
