# BOT Pulse Launch Copy

## Short release post for X

BOT Pulse is live for the BOT Chain Builder Challenge.

It is a small DePIN heartbeat demo: a simulated gateway registers on BOT Chain testnet, sends heartbeat packet hashes, and the dashboard reads freshness state directly from the deployed contract.

What is real in the demo:
- deployed EVM registry contract on BOT Chain testnet
- device registration event
- live heartbeat transaction
- packet hash anchored on-chain
- public freshness read through BOT Chain RPC
- explorer-verifiable transaction links

Contract: https://scan.bohr.life/address/0x588eb96429A3c22f22848185F2b5FfD08AdfD8Ae
Live app: {{LIVE_URL}}
GitHub: {{GITHUB_URL}}

Built for the DePIN / Real World track.
@BOTChain_ai

## Longer release post

BOT Pulse is a grounded DePIN heartbeat prototype for BOT Chain testnet.

The idea is simple: a device or gateway should be able to prove that it is alive, fresh, and producing data without putting raw device data directly on-chain. BOT Pulse models that flow with a lightweight EVM registry:

1. A gateway registers a `bytes32` device ID.
2. The gateway hashes a metric packet off-chain.
3. The heartbeat transaction anchors the packet hash, metric label, value, and timestamp on BOT Chain testnet.
4. The dashboard reads the deployed contract through BOT Chain RPC and shows owner, heartbeat count, latest metric, latest hash, and fresh/stale state.
5. Judges can verify the contract, deployment, registration, and heartbeat transactions in the BOT Chain explorer.

This is intentionally a testnet MVP: simulated devices, on-chain freshness state, off-chain raw data, and no tokenomics or payouts. The point is to demonstrate a clean path for DePIN gateways, sensors, node operators, and data relays to publish verifier-friendly liveness signals on BOT Chain.

Live app: {{LIVE_URL}}
GitHub: {{GITHUB_URL}}
Contract: https://scan.bohr.life/address/0x588eb96429A3c22f22848185F2b5FfD08AdfD8Ae
Latest heartbeat: https://scan.bohr.life/tx/0x125160efd679ff49d0814e7cbebe4af2d190d26f86e87f0884dcc8801c7f336b

## Product one-liner

BOT Pulse anchors DePIN gateway heartbeat hashes to BOT Chain testnet and displays live freshness state from the deployed contract.

## Submission blurb

BOT Pulse is a DePIN / Real World demo for BOT Chain Builder Challenge. It implements a deployed EVM heartbeat registry where simulated device gateways register IDs and submit packet hashes as heartbeat transactions. The app reads the deployed BOT Chain testnet contract through public RPC and displays freshness, latest metric, heartbeat count, owner, and transaction evidence. The prototype demonstrates a practical path for real-world sensors, gateways, and data relays to publish low-cost, explorer-verifiable liveness signals while keeping raw device data off-chain.

## Demo video narration script

Most DePIN demos show dashboards. BOT Pulse starts one layer lower: can a gateway prove it is alive on-chain?

Here, a simulated device gateway is registered on BOT Chain testnet. Every pulse hashes a data packet off-chain, then anchors that packet hash in a heartbeat transaction.

The app reads the deployed contract through BOT Chain RPC. No mocked freshness card — owner, heartbeat count, latest metric, latest hash, and fresh or stale state come from the registry.

For judges, the evidence is easy to check: open the contract, open the heartbeat transaction, and verify the state on the BOT Chain explorer.

This is a testnet MVP, not production hardware. But the path is real: gateway signs data, chain anchors freshness, dashboard verifies the latest pulse.

BOT Pulse: device liveness, anchored on BOT Chain.

## Recording checklist

- Run `npm run demo:heartbeat` less than 15 minutes before recording.
- Open the deployed Vercel URL, not only localhost.
- Start on the hero and show `Heartbeat uplink confirmed`.
- Scroll to the live contract state and show `fresh`, heartbeat count, latest metric, latest value, and latest hash.
- Open the heartbeat explorer link.
- Mention limitations plainly: simulated device agents, testnet contract, raw device data off-chain.
