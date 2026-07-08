# BOT Pulse

- Live demo: https://bot-pulse-virid.vercel.app
- GitHub: https://github.com/ShalyX/bot-pulse
- Contract: https://scan.bohr.life/address/0x588eb96429A3c22f22848185F2b5FfD08AdfD8Ae

BOT Pulse is a BOT Chain Builder Challenge DePIN / Real World demo: a small uptime/SLA watchtower where devices or gateways publish heartbeat packet hashes to BOT Chain testnet, and the dashboard turns those proofs into public covered or stale service status.

The project is intentionally grounded: the MVP uses a seeded challenge gateway and a real on-chain registry contract. It demonstrates the path real DePIN gateways, sensors, node operators, or data relays could use to prove liveness, expose missed service windows, and recover status with a fresh BOT Chain transaction.

## BOT Chain testnet

- Chain ID: `968`
- RPC: `https://rpc.bohr.life`
- Explorer: `https://scan.bohr.life/`
- Faucet: `https://faucet.botchain.ai/basic`
- Native token: `BOT`

## What the demo proves

1. A user connects an EVM wallet on BOT Chain testnet from the website.
2. A device/gateway registers a `bytes32` device ID from the UI or CLI.
3. The operator treats each heartbeat as a public uptime check against a 15-minute service window.
4. The device submits heartbeat packet hashes with metric labels and values.
5. BOT Chain stores the latest freshness state and emits verifier-friendly events.
6. The dashboard reads the deployed contract through BOT Chain RPC and displays owner, heartbeat count, latest metric, packet hash, proof age, breach clock, and covered/stale status.
7. Confirmed heartbeat transactions trigger the animated pulse uplink and append explorer links to the tx log.
8. Judges can verify the contract address, deployment tx, and heartbeat interaction tx on the BOT Chain explorer.

## Contract

`contracts/BotPulseRegistry.sol`

Core calls:

- `registerDevice(bytes32 deviceId, string metadataURI)`
- `submitHeartbeat(bytes32 deviceId, bytes32 dataHash, string metricType, int256 value)`
- `getDevice(bytes32 deviceId)`
- `isFresh(bytes32 deviceId)`
- `listDeviceIds()`

Events:

- `DeviceRegistered`
- `HeartbeatSubmitted`
- `DeviceMetadataUpdated`
- `DeviceDeactivated`

## Local setup

```bash
npm install
npm run check
```

## Deploy to BOT Chain testnet

Create `.env` from `.env.example`, fund the deployer with test BOT from the faucet, then run:

```bash
npm run deploy:bot-testnet
```

Expected output includes:

- contract address
- deployment transaction hash
- explorer URL

## Frontend

```bash
npm run dev
```

Then open `http://localhost:3000`.

Wallet interaction notes:

- Open the site in a browser with an injected EVM wallet such as MetaMask or Rabby.
- If testing from a phone, open the URL inside the wallet's in-app browser; normal mobile Chrome/Safari usually has no `window.ethereum` provider.
- Click `Connect Wallet` first. The app explicitly calls `eth_requestAccounts`, then switches/adds BOT Chain testnet.
- If the button appears inactive, check whether the wallet popup opened behind the current window or was blocked by the wallet extension.

## Submission packet checklist

- Project name: BOT Pulse
- Track: DePIN / Real World
- Contract address: `0x588eb96429A3c22f22848185F2b5FfD08AdfD8Ae`
- Deployment tx hash: `0x30b40b0cf3b54c575db6926379d31d605e89210d87d46ddb81c26cd35bbfaeb3`
- Device registration tx hash: `0x94655b48d262f0664e88081b8f5b487fe5662aaf6da811bb94d24b19706ef530`
- Heartbeat tx hash: `0x0fb8d8dade9fa6cf87513227602a43e525dfa614b54e7c45d60ed872e8899436`
- Heartbeat explorer: `https://scan.bohr.life/tx/0x0fb8d8dade9fa6cf87513227602a43e525dfa614b54e7c45d60ed872e8899436`
- GitHub repo: `https://github.com/ShalyX/bot-pulse`
- Live demo: `https://bot-pulse-virid.vercel.app`

## Reproduce the live heartbeat state

1. Run `npm run demo:heartbeat` shortly before recording so the deployed device shows `fresh` / `SLA covered` on load.
2. Run `npm run dev` and open the printed local URL.
3. The app should show the seeded challenge gateway as `fresh` / `SLA covered` from BOT Chain RPC.
4. Scroll to **SLA proof controls** and verify owner, heartbeat count, latest metric/value, latest hash, and proof age.
5. Open the heartbeat explorer URL above to verify the latest pulse transaction.

## Honest limitations

- MVP uses simulated/signed device agents, not production hardware.
- The contract stores packet hashes and freshness state; raw device data is expected to live off-chain.
- SLA status is currently derived from the contract's 15-minute freshness window; there are no automated penalties or payouts in this MVP.
- This is a testnet challenge prototype, not an audited DePIN protocol.
