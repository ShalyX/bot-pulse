# BOT Pulse

BOT Pulse is a BOT Chain Builder Challenge DePIN / Real World demo: a small EVM heartbeat registry where devices or gateways publish signed data packet hashes to BOT Chain testnet.

The project is intentionally grounded: the MVP uses simulated device agents and a real on-chain registry contract. It demonstrates the path real DePIN gateways, sensors, node operators, or data relays could use to anchor liveness and freshness proofs cheaply on BOT Chain.

## BOT Chain testnet

- Chain ID: `968`
- RPC: `https://rpc.bohr.life`
- Explorer: `https://scan.bohr.life/`
- Faucet: `https://faucet.botchain.ai/basic`
- Native token: `BOT`

## What the demo proves

1. A user connects an EVM wallet on BOT Chain testnet from the website.
2. A device/gateway registers a `bytes32` device ID from the UI or CLI.
3. The device submits heartbeat packet hashes with metric labels and values.
4. BOT Chain stores the latest freshness state and emits verifier-friendly events.
5. The dashboard reads the deployed contract through BOT Chain RPC and displays owner, heartbeat count, latest metric, packet hash, and fresh/stale state.
6. Confirmed heartbeat transactions trigger the animated pulse uplink and append explorer links to the tx log.
7. Judges can verify the contract address, deployment tx, and heartbeat interaction tx on the BOT Chain explorer.

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
- Heartbeat tx hash: `0x125160efd679ff49d0814e7cbebe4af2d190d26f86e87f0884dcc8801c7f336b`
- Heartbeat explorer: `https://scan.bohr.life/tx/0x125160efd679ff49d0814e7cbebe4af2d190d26f86e87f0884dcc8801c7f336b`
- GitHub repo: add the final public repo URL before submission.
- Demo video/live demo: add the final recording or hosted URL before submission.
- X showcase post tagging `@BOTChain_ai`: add the final post URL before submission.

## Demo recording flow

1. Run `npm run demo:heartbeat` shortly before recording so the deployed device shows `fresh` on load.
2. Run `npm run dev` and open the printed local URL.
3. Start on the hero: show the deployed contract card, `Heartbeat uplink confirmed`, and the BOT Chain links.
4. Scroll to **Live contract controls** and show the public RPC-loaded state: owner, heartbeat count, latest metric/value, latest hash, and `fresh` badge.
5. Open the heartbeat explorer URL above to verify the latest pulse transaction.
6. Optional wallet path: connect a BOT Chain testnet-funded wallet, register a personal device label if prompted, then send a pulse from the UI.

## Honest limitations

- MVP uses simulated/signed device agents, not production hardware.
- The contract stores packet hashes and freshness state; raw device data is expected to live off-chain.
- No tokenomics or payout settlement is included in the MVP.
- This is a testnet challenge prototype, not an audited DePIN protocol.
