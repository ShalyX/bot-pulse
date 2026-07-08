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

type RegistryDevice = {
  id: string;
  snapshot: DeviceSnapshot;
  fresh: boolean;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const initialDeviceId = "gateway-lagos-01";
const initialMetadata = "ipfs://bot-pulse/gateway-lagos-01.json";

const proofSteps = [
  "Register a device ID from an EVM wallet",
  "Hash the latest service packet off-chain",
  "Submit the packet hash as a BOT Chain heartbeat transaction",
  "Read the contract to show freshness, proof age, and owner",
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

function formatMetricLabel(value: string) {
  if (value === "latency_ms") return "Latency (ms)";
  if (value === "temperature_c") return "Temperature (C)";
  if (value === "uptime_pct") return "Uptime (%)";
  if (value === "watt_hours") return "Watt hours";
  if (value === "pm25") return "PM2.5";
  return value ? value.replace(/_/g, " ") : "none";
}

function minutesSince(value: bigint) {
  if (value === 0n) return null;
  return Math.max(0, Math.floor((Date.now() - Number(value) * 1000) / 60000));
}

function formatSlaClock(value: bigint) {
  const minutes = minutesSince(value);
  if (minutes === null) return "no heartbeat yet";
  if (minutes < 1) return "just checked in";
  if (minutes === 1) return "1 min since last proof";
  return `${minutes} min since last proof`;
}

function formatBreachEta(value: bigint) {
  const minutes = minutesSince(value);
  if (minutes === null) return "needs first heartbeat";
  const remaining = 15 - minutes;
  if (remaining <= 0) return "SLA window expired";
  if (remaining === 1) return "1 min until SLA breach";
  return `${remaining} min until SLA breach`;
}

function metadataName(metadataURI: string, id: string) {
  const cleaned = metadataURI.split("/").pop()?.replace(/\.json$/i, "").replace(/-/g, " ").trim();
  if (cleaned) return cleaned;
  return `device ${shortAddress(id)}`;
}

function slaState(snapshot: DeviceSnapshot | null | undefined, loading = false) {
  if (loading) return "Loading BOT Chain state";
  if (!snapshot) return "No device loaded";
  if (!snapshot.active) return "Device inactive";
  if (snapshot.fresh) return "SLA covered";
  return snapshot.lastSeenAt > 0n ? "SLA breach" : "No heartbeat yet";
}

async function readDeviceSnapshot(contract: Contract, id: string): Promise<DeviceSnapshot> {
  const [rawDevice, fresh] = await Promise.all([
    contract.getDevice(id),
    contract.isFresh(id) as Promise<boolean>,
  ]);

  return {
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
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
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
  const [registryDevices, setRegistryDevices] = useState<RegistryDevice[]>([]);
  const [publicLoading, setPublicLoading] = useState(true);
  const [publicError, setPublicError] = useState("");
  const [txLog, setTxLog] = useState<TxLog[]>([]);
  const [status, setStatus] = useState("Loading BOT Chain contract state...");
  const [busy, setBusy] = useState(false);
  const [pulseNonce, setPulseNonce] = useState(0);

  const deviceId = useMemo(() => keccak256(toUtf8Bytes(deviceLabel.trim() || initialDeviceId)), [deviceLabel]);
  const onCorrectChain = chainId === BOT_CHAIN_TESTNET.chainId;
  const connectedAccount = account.toLowerCase();
  const deviceOwner = device?.owner.toLowerCase() ?? "";
  const isDeviceOwner = Boolean(connectedAccount && deviceOwner && connectedAccount === deviceOwner);
  const deviceBelongsToAnotherWallet = Boolean(account && device?.active && deviceOwner && !isDeviceOwner);
  const slaClock = device ? formatSlaClock(device.lastSeenAt) : publicLoading ? "checking RPC" : "no heartbeat yet";
  const breachEta = device ? formatBreachEta(device.lastSeenAt) : publicLoading ? "checking RPC" : "register first";
  const liveSlaState = slaState(device, publicLoading);
  const registerButtonLabel = !account
    ? "Connect wallet first"
    : deviceBelongsToAnotherWallet
      ? "Use My Device"
      : device?.active && isDeviceOwner
        ? "Registered"
        : "Register Device";
  const heartbeatButtonLabel = !account
    ? "Connect wallet first"
    : !device?.active
      ? "Register device first"
      : !isDeviceOwner
        ? "Use your own device"
        : "Prove Uptime";

  useEffect(() => {
    let cancelled = false;

    async function loadPublicDeviceState() {
      setPublicLoading(true);
      setPublicError("");
      try {
        const contract = new Contract(
          BOT_PULSE_CONTRACT_ADDRESS,
          BOT_PULSE_ABI,
          new JsonRpcProvider(BOT_CHAIN_TESTNET.rpcUrl),
        );
        const [selectedSnapshot, deviceIds] = await withTimeout(
          Promise.all([
            readDeviceSnapshot(contract, deviceId),
            contract.listDeviceIds() as Promise<string[]>,
          ]),
          10000,
          "BOT Chain RPC read timed out",
        );
        const registry = await Promise.all(
          deviceIds.slice(0, 6).map(async (id) => ({
            id,
            snapshot: await readDeviceSnapshot(contract, id),
            fresh: await contract.isFresh(id) as boolean,
          })),
        );

        if (cancelled) return;
        setDevice(selectedSnapshot);
        setRegistryDevices(registry);
        setStatus(`Loaded ${deviceLabel} from BOT Chain. Connect a wallet only if you want to register or send a new heartbeat.`);
      } catch {
        if (!cancelled) {
          setDevice(null);
          setRegistryDevices([]);
          setPublicError("BOT Chain RPC read failed. The contract link still opens on the explorer; retry refresh before sending a transaction.");
          setStatus("BOT Chain RPC read failed. Use the explorer link to verify the contract, or retry Refresh State.");
        }
      } finally {
        if (!cancelled) setPublicLoading(false);
      }
    }

    void loadPublicDeviceState();

    return () => {
      cancelled = true;
    };
  }, [deviceId, deviceLabel]);

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
      const [selectedSnapshot, deviceIds] = await withTimeout(
        Promise.all([
          readDeviceSnapshot(contract, deviceId),
          contract.listDeviceIds() as Promise<string[]>,
        ]),
        10000,
        "BOT Chain RPC read timed out",
      );
      const registry = await Promise.all(
        deviceIds.slice(0, 6).map(async (id) => ({
          id,
          snapshot: await readDeviceSnapshot(contract, id),
          fresh: await contract.isFresh(id) as boolean,
        })),
      );
      setDevice(selectedSnapshot);
      setRegistryDevices(registry);
      setPublicError("");
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
    setStatus("Seeded challenge gateway belongs to another wallet. Personal device label selected — register it first, then send a pulse.");
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
    <main className="min-h-screen overflow-hidden bg-[#07110c] text-[#f7f1e8]">
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_18%_8%,rgba(58,255,155,0.22),transparent_30rem),radial-gradient(circle_at_82%_12%,rgba(242,108,47,0.2),transparent_26rem),linear-gradient(180deg,#07110c_0%,#0b1810_42%,#10150f_100%)]" />
      <div className="relative z-10">
        <nav className="mx-auto mt-5 flex max-w-7xl items-center justify-between rounded-full border border-white/10 bg-white/[0.06] px-4 py-3 shadow-2xl shadow-black/30 backdrop-blur-xl sm:px-5">
          <a href="#top" className="flex items-center gap-3" aria-label="BOT Pulse home">
            <div className="relative flex size-11 items-center justify-center rounded-2xl border border-[#8dffbe]/30 bg-[#102619] text-xl font-black text-[#8dffbe] shadow-[0_0_34px_rgba(141,255,190,0.22)]">
              <span className="absolute inset-1 rounded-xl border border-white/10" />
              ⌁
            </div>
            <div>
              <p className="text-sm font-black uppercase tracking-[0.34em] text-white">BOT Pulse</p>
              <p className="text-xs font-semibold text-[#adc7b5]">SLA heartbeat watchtower</p>
            </div>
          </a>

          <div className="hidden items-center gap-5 text-sm font-bold text-[#adc7b5] md:flex">
            <a href="#product" className="transition hover:text-white">Product</a>
            <a href="#live-state" className="transition hover:text-white">Live proof</a>
            <a href="#interact" className="transition hover:text-white">Try it</a>
            <a href="#evidence" className="transition hover:text-white">Evidence</a>
          </div>

          <button
            onClick={connectWallet}
            disabled={busy}
            className="rounded-full border border-[#8dffbe]/30 bg-[#8dffbe] px-4 py-2 text-sm font-black text-[#07110c] shadow-[0_0_30px_rgba(141,255,190,0.22)] transition hover:scale-[1.02] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {account ? shortAddress(account) : busy ? "Opening…" : "Connect"}
          </button>
        </nav>

        <section id="top" className="mx-auto grid max-w-7xl gap-8 px-5 pb-10 pt-14 sm:px-8 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:pb-16 lg:pt-20">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-3 rounded-full border border-[#8dffbe]/20 bg-[#8dffbe]/10 px-4 py-2 text-sm font-black uppercase tracking-[0.2em] text-[#8dffbe]">
              <span className="size-2 rounded-full bg-[#8dffbe] shadow-[0_0_18px_rgba(141,255,190,0.8)]" />
              BOT Chain testnet · DePIN liveness
            </div>

            <div className="space-y-5">
              <h1 className="max-w-5xl text-6xl font-black leading-[0.88] tracking-[-0.08em] text-white sm:text-7xl lg:text-8xl">
                Public uptime proof for small DePIN fleets.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-[#c8d8cd] sm:text-xl">
                BOT Pulse turns gateway check-ins into a visible SLA layer: a device registers, submits packet hashes to BOT Chain, and the page reads the contract to show whether the latest heartbeat is still covered.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["Window", "15 min", "freshness SLA"],
                ["Now", liveSlaState, breachEta],
                ["Network", "BOT", "testnet chain 968"],
              ].map(([label, value, sub]) => (
                <div key={label} className="rounded-[1.75rem] border border-white/10 bg-white/[0.06] p-4 shadow-2xl shadow-black/20 backdrop-blur">
                  <p className="text-xs font-black uppercase tracking-[0.24em] text-[#8dffbe]">{label}</p>
                  <p className="mt-2 text-2xl font-black text-white">{value}</p>
                  <p className="text-sm font-semibold text-[#9ab0a2]">{sub}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <a href="#interact" className="rounded-full bg-[#f26c2f] px-6 py-3 text-center font-black text-white shadow-[0_16px_40px_rgba(242,108,47,0.28)] transition hover:scale-[1.02] hover:bg-[#ff8a4f]">
                Send a heartbeat
              </a>
              <a href={explorerAddress(BOT_PULSE_CONTRACT_ADDRESS)} target="_blank" rel="noreferrer" className="rounded-full border border-white/12 bg-white/[0.07] px-6 py-3 text-center font-black text-white transition hover:border-[#8dffbe]/50 hover:text-[#8dffbe]">
                Verify contract
              </a>
              <a href="#product" className="rounded-full border border-white/12 bg-transparent px-6 py-3 text-center font-black text-[#c8d8cd] transition hover:border-white/30 hover:text-white">
                See landing story
              </a>
            </div>
          </div>

          <div id="live-state" className={`pulse-stage relative min-h-[620px] overflow-hidden rounded-[2.5rem] border border-white/10 bg-[#0b1c12]/[0.88] p-5 shadow-[0_30px_90px_rgba(0,0,0,0.45)] backdrop-blur-xl ${pulseNonce ? "pulse-confirmed" : ""}`} key={pulseNonce}>
            <div className="absolute inset-0 bg-[linear-gradient(rgba(141,255,190,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(141,255,190,0.08)_1px,transparent_1px)] bg-[size:42px_42px]" />
            <div className="pulse-wave"></div>
            <div className="pulse-wave"></div>
            <div className="pulse-wave"></div>
            <div className="pulse-wave"></div>

            <div className="relative z-10 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.26em] text-[#8dffbe]">Live contract read</p>
                <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-white">Gateway liveness panel</h2>
              </div>
              <span className={`rounded-full px-4 py-2 text-sm font-black ${device?.fresh ? "bg-[#8dffbe] text-[#07110c]" : "bg-[#f26c2f] text-white"}`}>
                {publicLoading ? "syncing" : device?.fresh ? "covered" : "stale"}
              </span>
            </div>

            <div className="absolute left-1/2 top-32 z-10 h-64 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-[#8dffbe]/70 to-transparent"></div>
            <div className="absolute left-1/2 top-40 z-10 flex -translate-x-1/2 flex-col items-center gap-5">
              {["packet hash", "BOT tx", "freshness read", "breach clock"].map((label) => (
                <div key={label} className="uplink-dot rounded-full border border-[#8dffbe]/25 bg-[#0f2518]/95 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-[#8dffbe] shadow-[0_0_24px_rgba(141,255,190,0.16)]">
                  {label}
                </div>
              ))}
            </div>

            <div className="absolute inset-x-5 bottom-5 z-10 rounded-[2rem] border border-white/10 bg-[#08120d]/95 p-5 shadow-2xl shadow-black/40">
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                {[
                  ["State", liveSlaState],
                  ["Clock", slaClock],
                  ["Proofs", device ? device.heartbeatCount.toString() : "—"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-white/8 bg-white/[0.05] p-3">
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-[#adc7b5]">{label}</p>
                    <p className="mt-1 break-words text-lg font-black text-white">{value}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-[#f26c2f]">{deviceLabel || "Gateway"}</p>
              <h2 className="mt-2 text-3xl font-black tracking-[-0.05em] text-white">
                {device?.fresh ? "Heartbeat inside the SLA window." : device?.lastSeenAt && device.lastSeenAt > 0n ? "Missed heartbeat is visible." : "Ready for first uptime proof."}
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-[#adc7b5]">
                No fake fleet rows: the dashboard renders devices read from the deployed registry, then links users back to the BOT Chain explorer for verification.
              </p>
            </div>
          </div>
        </section>

        <section id="product" className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:py-12">
          <div className="rounded-[2.25rem] border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl lg:p-8">
            <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.28em] text-[#8dffbe]">Product story</p>
                <h2 className="mt-3 text-4xl font-black tracking-[-0.06em] text-white sm:text-5xl">From “device pinged” to proof customers can inspect.</h2>
              </div>
              <p className="text-base leading-8 text-[#c8d8cd]">
                BOT Pulse is intentionally narrow: it does not pretend to be production DePIN infrastructure. It demonstrates a useful primitive for operators, reviewers, and customers — public liveness evidence with a short breach clock and explorer-verifiable transaction trail.
              </p>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {[
                ["01", "Register", "A wallet registers a gateway label and metadata URI on the deployed BOT Chain registry."],
                ["02", "Commit", "Each heartbeat stores the latest packet hash and metric value without exposing raw device data."],
                ["03", "Inspect", "The frontend reads the contract, calculates freshness, and sends users to explorer evidence."],
              ].map(([number, title, body]) => (
                <article key={title} className="rounded-[1.75rem] border border-white/10 bg-[#09150f] p-5">
                  <p className="text-sm font-black text-[#f26c2f]">{number}</p>
                  <h3 className="mt-4 text-2xl font-black tracking-[-0.04em] text-white">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-[#adc7b5]">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="interact" className="mx-auto grid max-w-7xl gap-6 px-5 py-8 sm:px-8 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[2rem] border border-white/10 bg-[#0c1a12]/90 p-5 shadow-2xl shadow-black/30 backdrop-blur-xl">
            <div className="mb-5">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-[#8dffbe]">SLA proof controls</p>
              <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] text-white">Register a device, then prove uptime.</h2>
              <p className="mt-2 max-h-28 overflow-auto break-words rounded-2xl border border-white/8 bg-white/[0.055] p-3 text-sm leading-6 text-[#c8d8cd]">{status}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-sm font-bold">
                <a href={BOT_CHAIN_TESTNET.faucetUrl} target="_blank" rel="noreferrer" className="rounded-full bg-[#f26c2f]/15 px-3 py-2 text-[#ffb089] hover:bg-[#f26c2f]/25">
                  Faucet: get test BOT
                </a>
                <a href={BOT_CHAIN_TESTNET.explorerUrl} target="_blank" rel="noreferrer" className="rounded-full bg-[#8dffbe]/12 px-3 py-2 text-[#8dffbe] hover:bg-[#8dffbe]/20">
                  BOT explorer
                </a>
              </div>
              {deviceBelongsToAnotherWallet ? (
                <p className="mt-3 rounded-2xl bg-[#f26c2f]/15 p-3 text-sm font-bold text-[#ffb089]">
                  Seeded challenge gateway is owned by {shortAddress(device?.owner ?? "")}. Use your own device label to register and send pulses from your wallet.
                </p>
              ) : null}
              {chainId && !onCorrectChain ? (
                <p className="mt-3 rounded-2xl bg-[#f26c2f]/15 p-3 text-sm font-bold text-[#ffb089]">
                  Wrong chain detected. Switch to BOT Chain testnet chain ID 968.
                </p>
              ) : null}
            </div>

            <div className="grid gap-4">
              <label className="grid gap-2 text-sm font-bold text-[#adc7b5]">
                Device label
                <input value={deviceLabel} onChange={(event) => { setDeviceLabel(event.target.value); setDevice(null); }} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none focus:border-[#8dffbe]" />
              </label>
              <label className="grid gap-2 text-sm font-bold text-[#adc7b5]">
                Metadata URI
                <input value={metadataURI} onChange={(event) => setMetadataURI(event.target.value)} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none focus:border-[#8dffbe]" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-bold text-[#adc7b5]">
                  Metric type
                  <select value={metricType} onChange={(event) => setMetricType(event.target.value)} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none focus:border-[#8dffbe]">
                    <option value="latency_ms">latency_ms</option>
                    <option value="temperature_c">temperature_c</option>
                    <option value="uptime_pct">uptime_pct</option>
                    <option value="watt_hours">watt_hours</option>
                    <option value="pm25">pm25</option>
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-bold text-[#adc7b5]">
                  Metric value
                  <input value={metricValue} onChange={(event) => setMetricValue(event.target.value.replace(/[^0-9-]/g, ""))} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none focus:border-[#8dffbe]" />
                </label>
              </div>
              {!account ? (
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <button onClick={connectWallet} disabled={busy} className="rounded-2xl bg-[#8dffbe] px-5 py-3 font-black text-[#07110c] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50">
                    Connect wallet to register or send heartbeat
                  </button>
                  <button onClick={refreshDevice} disabled={busy} className="rounded-2xl border border-white/12 bg-white/[0.06] px-5 py-3 font-black text-white transition hover:border-[#8dffbe]/45 disabled:cursor-not-allowed disabled:opacity-50">
                    Refresh state
                  </button>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  <button onClick={registerDevice} disabled={busy || Boolean(device?.active && isDeviceOwner)} className="rounded-2xl bg-white px-5 py-3 font-black text-[#07110c] transition hover:bg-[#8dffbe] disabled:cursor-not-allowed disabled:opacity-50">
                    {registerButtonLabel}
                  </button>
                  <button onClick={sendHeartbeat} disabled={busy || !device?.active || !isDeviceOwner} className="rounded-2xl bg-[#f26c2f] px-5 py-3 font-black text-white transition hover:bg-[#ff8a4f] disabled:cursor-not-allowed disabled:opacity-50">
                    {heartbeatButtonLabel}
                  </button>
                  <button onClick={refreshDevice} disabled={busy} className="rounded-2xl border border-white/12 bg-white/[0.06] px-5 py-3 font-black text-white transition hover:border-[#8dffbe]/45 disabled:cursor-not-allowed disabled:opacity-50">
                    Refresh state
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-[#0c1a12]/90 p-5 shadow-2xl shadow-black/30 backdrop-blur-xl" id="contract">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-[#8dffbe]">On-chain SLA state</p>
                <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] text-white">Freshness becomes accountability.</h2>
              </div>
              <span className={`rounded-full px-4 py-2 text-sm font-black ${device?.fresh ? "bg-[#8dffbe] text-[#07110c]" : "bg-[#f26c2f] text-white"}`}>
                {publicLoading ? "loading" : device?.fresh ? "fresh" : "SLA breach"}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["SLA state", liveSlaState],
                ["breach clock", breachEta],
                ["proof age", slaClock],
                ["owner", device ? shortAddress(device.owner) : "—"],
                ["heartbeat count", device ? device.heartbeatCount.toString() : "—"],
                ["latest metric", formatMetricLabel(device?.latestMetricType || "")],
                ["latest value", device ? device.latestValue.toString() : "—"],
                ["last seen", device ? formatTimestamp(device.lastSeenAt) : "—"],
                ["active", device ? (device.active ? "yes" : "no") : "—"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-white/8 bg-white/[0.055] p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-[#adc7b5]">{label}</p>
                  <p className="mt-2 break-words text-lg font-black text-white">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-[#8dffbe]/15 bg-black/30 p-4 font-mono text-xs leading-6 text-[#adc7b5]">
              deviceId: {deviceId}<br />
              latestHash: {device?.latestDataHash || "—"}
            </div>
          </div>
        </section>

        <section id="evidence" className="mx-auto grid max-w-7xl gap-6 px-5 py-8 sm:px-8 lg:grid-cols-[1.2fr_.8fr]">
          <div className="rounded-[2rem] border border-white/10 bg-[#0c1a12]/90 p-5 shadow-2xl shadow-black/30 backdrop-blur-xl">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-[#8dffbe]">Live registry</p>
                <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] text-white">Only devices read from the contract.</h2>
              </div>
              <div className="rounded-full bg-[#8dffbe] px-4 py-2 text-sm font-black text-[#07110c]">
                {publicLoading ? "reading RPC" : publicError ? "RPC unavailable" : `${registryDevices.length} on-chain`}
              </div>
            </div>

            {publicError ? (
              <p className="rounded-2xl bg-[#f26c2f]/15 p-4 text-sm font-bold leading-6 text-[#ffb089]">{publicError}</p>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              {registryDevices.map((entry, index) => {
                const state = slaState(entry.snapshot);
                return (
                  <article key={entry.id} className="rounded-[1.5rem] border border-white/10 bg-white/[0.055] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black capitalize text-white">{metadataName(entry.snapshot.metadataURI, entry.id)}</p>
                        <p className="mt-1 break-all font-mono text-xs text-[#8ea497]">{entry.id}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${entry.snapshot.fresh ? "bg-[#8dffbe]/18 text-[#8dffbe]" : "bg-[#f26c2f]/18 text-[#ffb089]"}`}>
                        {state}
                      </span>
                    </div>
                    <div className="my-5 grid gap-3 rounded-2xl border border-white/8 bg-black/20 p-4 sm:grid-cols-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-[#adc7b5]">metric</p>
                        <p className="mt-1 text-base font-black leading-tight text-white">{formatMetricLabel(entry.snapshot.latestMetricType)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-[#adc7b5]">value</p>
                        <p className="mt-1 text-lg font-black text-white">{entry.snapshot.latestValue.toString()}</p>
                      </div>
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-[#adc7b5]">proofs</p>
                        <p className="mt-1 text-lg font-black text-white">{entry.snapshot.heartbeatCount.toString()}</p>
                      </div>
                    </div>
                    <div className="grid gap-2 text-xs font-bold text-[#adc7b5] sm:grid-cols-2">
                      <span>Owner: {shortAddress(entry.snapshot.owner)}</span>
                      <span>{formatSlaClock(entry.snapshot.lastSeenAt)}</span>
                    </div>
                    {index === 0 ? (
                      <p className="mt-3 rounded-2xl bg-[#8dffbe]/12 p-3 text-xs font-bold leading-5 text-[#8dffbe]">
                        Seeded challenge gateway. More rows appear only after wallets register more devices on-chain.
                      </p>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>

          <aside className="rounded-[2rem] border border-white/10 bg-[#f7f1e8] p-5 text-[#07110c] shadow-2xl shadow-black/30">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#d9481e]">Evidence trail</p>
            <h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">Every visible status must come from a contract read or submitted tx.</h2>
            {txLog.length ? (
              <ol className="mt-6 space-y-3">
                {txLog.map((entry) => (
                  <li key={`${entry.label}-${entry.hash}`} className="rounded-2xl bg-[#07110c]/[0.07] p-3 text-sm leading-6 text-[#334238]">
                    <a href={explorerTx(entry.hash)} target="_blank" rel="noreferrer" className="font-black text-[#d9481e] hover:text-[#07110c]">
                      {entry.label}: {shortAddress(entry.hash)}
                    </a>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="mt-6 rounded-2xl bg-[#07110c]/[0.07] p-4 text-sm font-semibold leading-6 text-[#334238]">
                No wallet transaction has been sent in this browser session. Use the contract link to verify the deployed registry, or connect a wallet to produce a new explorer-linked transaction.
              </div>
            )}
            <div className="mt-6 rounded-2xl border border-[#07110c]/10 bg-white/50 p-4 font-mono text-xs leading-6 text-[#334238]">
              {proofSteps.map((step) => (
                <div key={step}>✓ {step}</div>
              ))}
            </div>
          </aside>
        </section>

        <footer className="mx-auto max-w-7xl px-5 pb-8 pt-10 sm:px-8">
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl lg:p-8">
            <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
              <div>
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-2xl bg-[#8dffbe] font-black text-[#07110c]">⌁</div>
                  <div>
                    <p className="text-sm font-black uppercase tracking-[0.3em] text-white">BOT Pulse</p>
                    <p className="text-sm text-[#adc7b5]">A compact BOT Chain testnet heartbeat demo.</p>
                  </div>
                </div>
                <p className="mt-5 max-w-2xl text-sm leading-6 text-[#9ab0a2]">
                  Built for the BOT Chain Builder Challenge. The demo shows a focused liveness primitive, not a production monitoring network or audited DePIN system.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-sm font-black">
                <a href={explorerAddress(BOT_PULSE_CONTRACT_ADDRESS)} target="_blank" rel="noreferrer" className="rounded-full border border-white/12 px-4 py-2 text-[#c8d8cd] hover:border-[#8dffbe]/45 hover:text-[#8dffbe]">Contract</a>
                <a href={BOT_CHAIN_TESTNET.explorerUrl} target="_blank" rel="noreferrer" className="rounded-full border border-white/12 px-4 py-2 text-[#c8d8cd] hover:border-[#8dffbe]/45 hover:text-[#8dffbe]">Explorer</a>
                <a href={BOT_CHAIN_TESTNET.faucetUrl} target="_blank" rel="noreferrer" className="rounded-full border border-white/12 px-4 py-2 text-[#c8d8cd] hover:border-[#8dffbe]/45 hover:text-[#8dffbe]">Faucet</a>
                <a href="#top" className="rounded-full bg-white px-4 py-2 text-[#07110c] hover:bg-[#8dffbe]">Back to top</a>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
