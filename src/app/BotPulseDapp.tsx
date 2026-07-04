"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  keccak256,
  toUtf8Bytes,
  type Eip1193Provider,
} from "ethers";
import {
  BOT_CHAIN_TESTNET,
  BOT_PULSE_ABI,
  BOT_PULSE_CONTRACT_ADDRESS,
} from "./botPulseContract";

type DeviceSnapshot = {
  owner: string;
  metadataURI: string;
  registeredAt: bigint;
  lastSeenAt: bigint;
  heartbeatCount: bigint;
  latestDataHash: string;
  latestMetricType: string;
  latestValue: bigint;
  active: boolean;
  fresh: boolean;
};

type TxLog = {
  label: string;
  hash: string;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const initialDeviceId = "gateway-lagos-01";
const initialMetadata = "ipfs://bot-pulse/gateway-lagos-01.json";

const devices = [
  {
    id: "LG-GW-01",
    name: "Lagos Gateway",
    metric: "latency_ms",
    value: "42",
    status: "fresh",
    region: "West Africa",
    tx: "0x4b18…6f93",
  },
  {
    id: "ACC-SOLAR-04",
    name: "Solar Meter",
    metric: "watt_hours",
    value: "812",
    status: "fresh",
    region: "Accra",
    tx: "ready",
  },
  {
    id: "NBI-AIR-02",
    name: "Air Sensor",
    metric: "pm25",
    value: "18",
    status: "watch",
    region: "Nairobi",
    tx: "ready",
  },
];

const proofSteps = [
  "Device signs packet off-chain",
  "Gateway hashes metric + timestamp + nonce",
  "Heartbeat tx is sent to BOT Chain testnet",
  "Dashboard reads event logs and freshness state",
];

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function explorerTx(hash: string) {
  return `${BOT_CHAIN_TESTNET.explorerUrl}/tx/${hash}`;
}

function explorerAddress(address: string) {
  return `${BOT_CHAIN_TESTNET.explorerUrl}/address/${address}`;
}

function formatTimestamp(value: bigint) {
  if (value === 0n) return "never";
  return new Date(Number(value) * 1000).toLocaleString();
}

function readableWalletError(error: unknown, fallback: string) {
  const maybeError = error as { code?: number; shortMessage?: string; reason?: string; message?: string };
  const rawMessage = maybeError.shortMessage ?? maybeError.reason ?? maybeError.message ?? "";
  const message = rawMessage.toLowerCase();

  if (maybeError.code === 4001 || message.includes("user rejected") || message.includes("user denied")) {
    return "Wallet request rejected. Try again when ready.";
  }
  if (message.includes("device exists")) {
    return "This device is already registered. You can send a pulse now.";
  }
  if (message.includes("not device owner")) {
    return "This device belongs to another wallet. Use your own device label, register it, then send a pulse.";
  }
  if (message.includes("unknown device")) {
    return "Device is not registered yet. Register it first, then send a pulse.";
  }
  if (message.includes("device inactive")) {
    return "This device is inactive. Register a new device label before sending a pulse.";
  }
  if (message.includes("insufficient funds") || message.includes("insufficient balance")) {
    return "Wallet needs BOT testnet gas from the faucet before sending this transaction.";
  }
  if (message.includes("no evm wallet")) {
    return "No EVM wallet found. Open this page inside MetaMask/Rabby or install a wallet extension.";
  }

  return fallback;
}

async function getBrowserProvider() {
  if (!window.ethereum) {
    throw new Error("No EVM wallet found. Install MetaMask/Rabby and add BOT Chain testnet.");
  }
  return new BrowserProvider(window.ethereum);
}

async function ensureBotChain() {
  if (!window.ethereum) return;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BOT_CHAIN_TESTNET.chainIdHex }],
    });
  } catch (error) {
    const maybeError = error as { code?: number };
    if (maybeError.code !== 4902) throw error;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: BOT_CHAIN_TESTNET.chainIdHex,
          chainName: BOT_CHAIN_TESTNET.chainName,
          nativeCurrency: BOT_CHAIN_TESTNET.nativeCurrency,
          rpcUrls: [BOT_CHAIN_TESTNET.rpcUrl],
          blockExplorerUrls: [BOT_CHAIN_TESTNET.explorerUrl],
        },
      ],
    });
  }
}

export default function BotPulseDapp() {
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState<bigint | null>(null);
  const [deviceLabel, setDeviceLabel] = useState(initialDeviceId);
  const [metadataURI, setMetadataURI] = useState(initialMetadata);
  const [metricType, setMetricType] = useState("latency_ms");
  const [metricValue, setMetricValue] = useState("42");
  const [device, setDevice] = useState<DeviceSnapshot | null>(null);
  const [txLog, setTxLog] = useState<TxLog[]>([]);
  const [status, setStatus] = useState("Connect a wallet to interact with the deployed BOT Chain contract.");
  const [busy, setBusy] = useState(false);
  const [pulseNonce, setPulseNonce] = useState(0);

  const deviceId = useMemo(() => keccak256(toUtf8Bytes(deviceLabel.trim() || initialDeviceId)), [deviceLabel]);
  const onCorrectChain = chainId === BOT_CHAIN_TESTNET.chainId;
  const connectedAccount = account.toLowerCase();
  const deviceOwner = device?.owner.toLowerCase() ?? "";
  const isDeviceOwner = Boolean(connectedAccount && deviceOwner && connectedAccount === deviceOwner);
  const deviceBelongsToAnotherWallet = Boolean(account && device?.active && deviceOwner && !isDeviceOwner);

  useEffect(() => {
    if (!window.ethereum) return;

    let cancelled = false;

    async function detectConnectedWallet() {
      try {
        const accounts = (await window.ethereum?.request({ method: "eth_accounts" })) as string[] | undefined;
        const currentChainId = (await window.ethereum?.request({ method: "eth_chainId" })) as string | undefined;

        if (cancelled) return;
        if (accounts?.[0]) {
          setAccount(accounts[0]);
          setStatus("Wallet already connected. Refreshing BOT Chain state...");
        }
        if (currentChainId) {
          setChainId(BigInt(currentChainId));
        }
      } catch {
        // Passive detection should never block the UI.
      }
    }

    function handleAccountsChanged(accounts: unknown) {
      const nextAccount = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : "";
      setAccount(nextAccount);
      setStatus(nextAccount ? "Wallet account detected. Ready for BOT Chain actions." : "Wallet disconnected.");
    }

    function handleChainChanged(nextChainId: unknown) {
      if (typeof nextChainId === "string") {
        setChainId(BigInt(nextChainId));
      }
    }

    const walletProvider = window.ethereum as Eip1193Provider & {
      on?: (event: string, listener: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
    };

    void detectConnectedWallet();
    walletProvider.on?.("accountsChanged", handleAccountsChanged);
    walletProvider.on?.("chainChanged", handleChainChanged);

    return () => {
      cancelled = true;
      walletProvider.removeListener?.("accountsChanged", handleAccountsChanged);
      walletProvider.removeListener?.("chainChanged", handleChainChanged);
    };
  }, []);

  async function syncBotChainAfterConnect() {
    setBusy(true);
    try {
      await ensureBotChain();
      const currentChainId = (await window.ethereum?.request({ method: "eth_chainId" })) as string | undefined;
      if (currentChainId) {
        setChainId(BigInt(currentChainId));
      }
      setStatus("Wallet connected. Loading deployed BOT Pulse state...");
      await refreshDevice();
    } catch (error) {
      const maybeError = error as { code?: number; message?: string };
      setStatus(maybeError.message ?? "Wallet connected, but BOT Chain switch/state refresh failed.");
    } finally {
      setBusy(false);
    }
  }

  async function getContract(withSigner = false) {
    if (!withSigner) {
      const provider = new JsonRpcProvider(BOT_CHAIN_TESTNET.rpcUrl);
      return new Contract(BOT_PULSE_CONTRACT_ADDRESS, BOT_PULSE_ABI, provider);
    }
    const provider = await getBrowserProvider();
    const signer = await provider.getSigner();
    return new Contract(BOT_PULSE_CONTRACT_ADDRESS, BOT_PULSE_ABI, signer);
  }

  async function connectWallet() {
    setBusy(true);
    setStatus("Opening wallet connection request...");
    try {
      if (!window.ethereum) {
        throw new Error("No EVM wallet found. Open this page inside MetaMask/Rabby browser or install a wallet extension.");
      }

      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const connectedAccount = accounts?.[0];
      if (!connectedAccount) {
        throw new Error("Wallet did not return an account. Unlock the wallet and try again.");
      }

      setAccount(connectedAccount);
      setStatus("Wallet connected. Checking BOT Chain network...");
      setBusy(false);

      // Do the slower network switch + contract read after the account state has rendered.
      window.setTimeout(() => {
        void syncBotChainAfterConnect();
      }, 0);
    } catch (error) {
      const maybeError = error as { code?: number; message?: string };
      if (maybeError.code === 4001) {
        setStatus("Wallet request rejected. Click Connect Wallet again when ready.");
      } else {
        setStatus(maybeError.message ?? "Wallet connection failed.");
      }
      setBusy(false);
    }
  }

  async function refreshDevice() {
    setBusy(true);
    try {
      const contract = await getContract(false);
      const [rawDevice, fresh] = await Promise.all([
        contract.getDevice(deviceId),
        contract.isFresh(deviceId) as Promise<boolean>,
      ]);
      setDevice({
        owner: rawDevice.owner as string,
        metadataURI: rawDevice.metadataURI as string,
        registeredAt: rawDevice.registeredAt as bigint,
        lastSeenAt: rawDevice.lastSeenAt as bigint,
        heartbeatCount: rawDevice.heartbeatCount as bigint,
        latestDataHash: rawDevice.latestDataHash as string,
        latestMetricType: rawDevice.latestMetricType as string,
        latestValue: rawDevice.latestValue as bigint,
        active: rawDevice.active as boolean,
        fresh,
      });
      setStatus(`Loaded ${deviceLabel} from BOT Chain.`);
    } catch (error) {
      setDevice(null);
      setStatus(readableWalletError(error, "Could not load device state from BOT Chain."));
    } finally {
      setBusy(false);
    }
  }

  function selectMyDeviceLabel() {
    if (!account) return;
    const personalLabel = `gateway-${account.slice(2, 8).toLowerCase()}`;
    setDeviceLabel(personalLabel);
    setMetadataURI(`ipfs://bot-pulse/${personalLabel}.json`);
    setDevice(null);
    setStatus("Demo device belongs to another wallet. Personal device label selected — register it first, then send a pulse.");
  }

  async function registerDevice() {
    if (deviceBelongsToAnotherWallet) {
      selectMyDeviceLabel();
      return;
    }

    setBusy(true);
    try {
      await ensureBotChain();
      const contract = await getContract(true);
      setStatus("Submitting device registration transaction...");
      const tx = await contract.registerDevice(deviceId, metadataURI);
      setTxLog((logs) => [{ label: "Device registration", hash: tx.hash }, ...logs]);
      await tx.wait();
      setPulseNonce((n) => n + 1);
      setStatus("Device registered on BOT Chain.");
      await refreshDevice();
    } catch (error) {
      const readable = readableWalletError(error, "Device registration failed. Please try again.");
      setStatus(readable);
      if (readable.includes("already registered")) {
        await refreshDevice();
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendHeartbeat() {
    if (!account) {
      setStatus("Connect a wallet before sending a pulse.");
      return;
    }
    if (!device?.active) {
      setStatus("Register this device with your wallet before sending a pulse.");
      return;
    }
    if (!isDeviceOwner) {
      setStatus("This device belongs to another wallet. Click Use My Device, register your own device, then send a pulse.");
      return;
    }

    setBusy(true);
    try {
      await ensureBotChain();
      const numericValue = BigInt(metricValue || "0");
      const packet = JSON.stringify({
        deviceLabel,
        metricType,
        value: metricValue,
        observedAt: new Date().toISOString(),
        nonce: crypto.randomUUID(),
      });
      const packetHash = keccak256(toUtf8Bytes(packet));
      const contract = await getContract(true);
      setStatus("Submitting heartbeat pulse to BOT Chain...");
      const tx = await contract.submitHeartbeat(deviceId, packetHash, metricType, numericValue);
      setTxLog((logs) => [{ label: `${metricType} pulse`, hash: tx.hash }, ...logs]);
      await tx.wait();
      setPulseNonce((n) => n + 1);
      setStatus("Pulse confirmed. Freshness state updated from contract.");
      await refreshDevice();
    } catch (error) {
      setStatus(readableWalletError(error, "Heartbeat submission failed. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid-paper min-h-screen overflow-hidden px-5 py-5 text-foreground sm:px-8 lg:px-10">
      <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-black/10 bg-paper/80 px-5 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-signal text-lg font-black text-white shadow-lg shadow-orange-900/20">
            ∿
          </div>
          <div>
            <p className="text-sm font-black uppercase tracking-[0.28em] text-moss">BOT Pulse</p>
            <p className="text-xs text-ink-soft">DePIN heartbeat proofs</p>
          </div>
        </div>
        <div className="hidden items-center gap-3 text-sm font-semibold text-ink-soft sm:flex">
          <a href="#demo" className="hover:text-foreground">Demo</a>
          <a href="#interact" className="hover:text-foreground">Interact</a>
          <a href="#contract" className="hover:text-foreground">Contract</a>
        </div>
        <button
          onClick={connectWallet}
          disabled={busy}
          className="rounded-full bg-foreground px-4 py-2 text-sm font-bold text-paper transition hover:bg-signal-strong disabled:cursor-not-allowed disabled:opacity-60"
        >
          {account ? shortAddress(account) : busy ? "Opening Wallet…" : "Connect Wallet"}
        </button>
      </nav>

      <section className="mx-auto grid max-w-7xl gap-8 py-12 lg:grid-cols-[0.92fr_1.08fr] lg:items-center lg:py-16">
        <div className="space-y-7">
          <div className="inline-flex items-center gap-2 rounded-full border border-moss/20 bg-paper/80 px-4 py-2 text-sm font-bold text-moss">
            <span className="size-2 rounded-full bg-signal"></span>
            BOT Chain Builder Challenge · DePIN / Real World
          </div>

          <div className="space-y-5">
            <h1 className="max-w-4xl text-5xl font-black leading-[0.95] tracking-[-0.07em] text-foreground sm:text-7xl">
              Device pulses, anchored on BOT Chain.
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-ink-soft sm:text-xl">
              Register a simulated DePIN gateway, send a live heartbeat transaction, and verify freshness directly from the deployed BOT Chain contract.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Chain", "BOT testnet", "968"],
              ["Contract", shortAddress(BOT_PULSE_CONTRACT_ADDRESS), "deployed"],
              ["Proof", "event log", "hash"],
            ].map(([label, value, sub]) => (
              <div key={label} className="rounded-3xl border border-black/10 bg-paper/75 p-4 soft-shadow">
                <p className="text-xs font-black uppercase tracking-[0.22em] text-clay">{label}</p>
                <p className="mt-2 text-2xl font-black">{value}</p>
                <p className="text-sm text-ink-soft">{sub}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <a href="#interact" className="rounded-full bg-signal px-6 py-3 text-center font-black text-white shadow-xl shadow-orange-900/20 transition hover:bg-signal-strong">
              Send live pulse
            </a>
            <a href={explorerAddress(BOT_PULSE_CONTRACT_ADDRESS)} target="_blank" rel="noreferrer" className="rounded-full border border-black/15 bg-paper px-6 py-3 text-center font-black text-foreground transition hover:border-signal hover:text-signal-strong">
              View contract
            </a>
            <a href={BOT_CHAIN_TESTNET.faucetUrl} target="_blank" rel="noreferrer" className="rounded-full border border-black/15 bg-paper px-6 py-3 text-center font-black text-foreground transition hover:border-signal hover:text-signal-strong">
              Get test BOT
            </a>
            <a href={BOT_CHAIN_TESTNET.explorerUrl} target="_blank" rel="noreferrer" className="rounded-full border border-black/15 bg-paper px-6 py-3 text-center font-black text-foreground transition hover:border-signal hover:text-signal-strong">
              Open explorer
            </a>
          </div>
        </div>

        <div id="demo" className={`pulse-stage rounded-[2.5rem] border border-black/10 bg-paper/70 p-5 soft-shadow backdrop-blur ${pulseNonce ? "pulse-confirmed" : ""}`} key={pulseNonce}>
          <div className="pulse-wave"></div>
          <div className="pulse-wave"></div>
          <div className="pulse-wave"></div>
          <div className="pulse-wave"></div>

          <div className="absolute left-1/2 top-12 h-60 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-signal/60 to-transparent"></div>
          <div className="absolute left-1/2 top-28 flex -translate-x-1/2 flex-col items-center gap-5">
            {["BOT block", "event log", "fresh", "packet", "nonce"].map((label) => (
              <div key={label} className="uplink-dot rounded-full border border-black/10 bg-paper px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-moss soft-shadow">
                {label}
              </div>
            ))}
          </div>

          <div className="absolute inset-x-6 bottom-6 rounded-[2rem] border border-black/10 bg-[#fff8ec]/95 p-5">
            <div className="mx-auto mb-4 flex size-24 items-center justify-center rounded-[2rem] bg-gradient-to-br from-signal to-clay text-4xl font-black text-white shadow-xl shadow-orange-900/25">
              ⌁
            </div>
            <div className="text-center">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-clay">{deviceLabel || "Gateway"}</p>
              <h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">
                {device?.fresh ? "Heartbeat uplink confirmed" : "Ready for heartbeat uplink"}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-soft">
                Confirmed wallet transactions trigger the pulse animation and refresh state from BOT Chain RPC.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="interact" className="mx-auto grid max-w-7xl gap-6 pb-12 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-[2rem] border border-black/10 bg-paper/85 p-5 soft-shadow">
          <div className="mb-5">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-clay">Live contract controls</p>
            <h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">Register device, then send pulse.</h2>
            <p className="mt-2 max-h-28 overflow-auto break-words rounded-2xl bg-paper-strong p-3 text-sm leading-6 text-ink-soft">{status}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-sm font-bold">
              <a href={BOT_CHAIN_TESTNET.faucetUrl} target="_blank" rel="noreferrer" className="rounded-full bg-signal/15 px-3 py-2 text-signal-strong hover:bg-signal/25">
                Faucet: get test BOT
              </a>
              <a href={BOT_CHAIN_TESTNET.explorerUrl} target="_blank" rel="noreferrer" className="rounded-full bg-moss/15 px-3 py-2 text-moss hover:bg-moss/25">
                BOT explorer
              </a>
            </div>
            {deviceBelongsToAnotherWallet ? (
              <p className="mt-2 rounded-2xl bg-signal/15 p-3 text-sm font-bold text-signal-strong">
                This demo device is owned by {shortAddress(device?.owner ?? "")}. Use your own device label to register and send pulses from your wallet.
              </p>
            ) : null}
            {chainId && !onCorrectChain ? (
              <p className="mt-2 rounded-2xl bg-signal/15 p-3 text-sm font-bold text-signal-strong">
                Wrong chain detected. Switch to BOT Chain testnet chain ID 968.
              </p>
            ) : null}
          </div>

          <div className="grid gap-4">
            <label className="grid gap-2 text-sm font-bold text-ink-soft">
              Device label
              <input value={deviceLabel} onChange={(event) => { setDeviceLabel(event.target.value); setDevice(null); }} className="rounded-2xl border border-black/10 bg-white/70 px-4 py-3 text-foreground outline-none focus:border-signal" />
            </label>
            <label className="grid gap-2 text-sm font-bold text-ink-soft">
              Metadata URI
              <input value={metadataURI} onChange={(event) => setMetadataURI(event.target.value)} className="rounded-2xl border border-black/10 bg-white/70 px-4 py-3 text-foreground outline-none focus:border-signal" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold text-ink-soft">
                Metric type
                <select value={metricType} onChange={(event) => setMetricType(event.target.value)} className="rounded-2xl border border-black/10 bg-white/70 px-4 py-3 text-foreground outline-none focus:border-signal">
                  <option value="latency_ms">latency_ms</option>
                  <option value="temperature_c">temperature_c</option>
                  <option value="uptime_pct">uptime_pct</option>
                  <option value="watt_hours">watt_hours</option>
                  <option value="pm25">pm25</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm font-bold text-ink-soft">
                Metric value
                <input value={metricValue} onChange={(event) => setMetricValue(event.target.value.replace(/[^0-9-]/g, ""))} className="rounded-2xl border border-black/10 bg-white/70 px-4 py-3 text-foreground outline-none focus:border-signal" />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <button onClick={registerDevice} disabled={busy || !account || Boolean(device?.active && isDeviceOwner)} className="rounded-2xl bg-foreground px-5 py-3 font-black text-paper transition hover:bg-moss disabled:cursor-not-allowed disabled:opacity-50">
                {deviceBelongsToAnotherWallet ? "Use My Device" : device?.active && isDeviceOwner ? "Registered" : "Register Device"}
              </button>
              <button onClick={sendHeartbeat} disabled={busy || !account || !device?.active || !isDeviceOwner} className="rounded-2xl bg-signal px-5 py-3 font-black text-white transition hover:bg-signal-strong disabled:cursor-not-allowed disabled:opacity-50">
                Send Pulse
              </button>
              <button onClick={refreshDevice} disabled={busy} className="rounded-2xl border border-black/15 bg-paper px-5 py-3 font-black text-foreground transition hover:border-moss disabled:cursor-not-allowed disabled:opacity-50">
                Refresh State
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-[2rem] border border-black/10 bg-paper/85 p-5 soft-shadow" id="contract">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-clay">On-chain device state</p>
              <h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">Freshness from BOT RPC</h2>
            </div>
            <span className={`rounded-full px-4 py-2 text-sm font-black text-white ${device?.fresh ? "bg-moss" : "bg-clay"}`}>
              {device?.fresh ? "fresh" : "not fresh"}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["owner", device ? shortAddress(device.owner) : "—"],
              ["heartbeat count", device ? device.heartbeatCount.toString() : "—"],
              ["latest metric", device?.latestMetricType || "—"],
              ["latest value", device ? device.latestValue.toString() : "—"],
              ["last seen", device ? formatTimestamp(device.lastSeenAt) : "—"],
              ["active", device ? String(device.active) : "—"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-paper-strong p-4">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-clay">{label}</p>
                <p className="mt-2 break-words text-lg font-black">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-2xl bg-foreground p-4 font-mono text-xs leading-6 text-paper/80">
            deviceId: {deviceId}<br />
            latestHash: {device?.latestDataHash || "—"}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 pb-12 lg:grid-cols-[1.2fr_.8fr]">
        <div className="rounded-[2rem] border border-black/10 bg-paper/85 p-5 soft-shadow">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-clay">Device board</p>
              <h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">Example DePIN nodes</h2>
            </div>
            <div className="rounded-full bg-moss px-4 py-2 text-sm font-black text-white">{devices.length} devices</div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {devices.map((demoDevice) => (
              <article key={demoDevice.id} className="stamped rounded-[1.5rem] bg-paper-strong p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black">{demoDevice.name}</p>
                    <p className="text-sm text-ink-soft">{demoDevice.region}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${demoDevice.status === "fresh" ? "bg-leaf/25 text-moss" : "bg-signal/20 text-signal-strong"}`}>
                    {demoDevice.status}
                  </span>
                </div>
                <div className="my-5 rounded-2xl bg-paper p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-clay">{demoDevice.metric}</p>
                  <p className="mt-1 text-4xl font-black tracking-[-0.06em]">{demoDevice.value}</p>
                </div>
                <div className="flex items-center justify-between text-xs font-bold text-ink-soft">
                  <span>{demoDevice.id}</span>
                  <span>{demoDevice.tx}</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="rounded-[2rem] border border-black/10 bg-foreground p-5 text-paper soft-shadow">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-sky">Tx log</p>
          <h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">Verifier-friendly, not vaporware.</h2>
          <ol className="mt-6 space-y-3">
            {(txLog.length ? txLog : proofSteps.map((step, index) => ({ label: `${index + 1}. ${step}`, hash: "" }))).map((entry) => (
              <li key={`${entry.label}-${entry.hash}`} className="rounded-2xl bg-white/8 p-3 text-sm leading-6 text-paper/80">
                {entry.hash ? (
                  <a href={explorerTx(entry.hash)} target="_blank" rel="noreferrer" className="font-bold text-sky hover:text-white">
                    {entry.label}: {shortAddress(entry.hash)}
                  </a>
                ) : (
                  entry.label
                )}
              </li>
            ))}
          </ol>
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/8 p-4 font-mono text-xs leading-6 text-paper/75">
            registerDevice(bytes32 id, metadataURI)<br />
            submitHeartbeat(id, dataHash, metric, value)<br />
            isFresh(id) → true / false
          </div>
        </aside>
      </section>
    </main>
  );
}
