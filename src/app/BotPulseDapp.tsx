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

type WalletProvider = Eip1193Provider & {
  providers?: WalletProvider[];
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isCoinbaseWallet?: boolean;
  isBraveWallet?: boolean;
  isOKExWallet?: boolean;
  isPhantom?: boolean;
  isTrust?: boolean;
};

type WalletOption = {
  id: string;
  name: string;
  provider: WalletProvider;
};

declare global {
  interface Window {
    ethereum?: WalletProvider;
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

function walletName(provider: WalletProvider, fallback = "Injected wallet") {
  if (provider.isRabby) return "Rabby";
  if (provider.isMetaMask) return "MetaMask";
  if (provider.isCoinbaseWallet) return "Coinbase Wallet";
  if (provider.isBraveWallet) return "Brave Wallet";
  if (provider.isOKExWallet) return "OKX Wallet";
  if (provider.isPhantom) return "Phantom";
  if (provider.isTrust) return "Trust Wallet";
  return fallback;
}

function dedupeWallets(wallets: WalletOption[]) {
  const seen = new Set<WalletProvider>();
  return wallets.filter((wallet) => {
    if (seen.has(wallet.provider)) return false;
    seen.add(wallet.provider);
    return true;
  });
}

async function getBrowserProvider(provider?: WalletProvider) {
  if (!provider) {
    throw new Error("No EVM wallet selected. Choose MetaMask, Rabby, or another injected wallet first.");
  }
  return new BrowserProvider(provider);
}

async function ensureBotChain(provider?: WalletProvider) {
  if (!provider) {
    throw new Error("No EVM wallet selected. Choose a wallet first.");
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BOT_CHAIN_TESTNET.chainIdHex }],
    });
  } catch (error) {
    const maybeError = error as { code?: number };
    if (maybeError.code !== 4902) throw error;
    await provider.request({
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
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BOT_CHAIN_TESTNET.chainIdHex }],
    });
  }

  const currentChainId = await provider.request({ method: "eth_chainId" }) as string;
  if (currentChainId.toLowerCase() !== BOT_CHAIN_TESTNET.chainIdHex) {
    throw new Error(`Wrong network selected (${currentChainId}). Switch to BOT Chain Testnet ${BOT_CHAIN_TESTNET.chainIdHex} before sending transactions.`);
  }
  return BigInt(currentChainId);
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
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState("");

  const deviceId = useMemo(() => keccak256(toUtf8Bytes(deviceLabel.trim() || initialDeviceId)), [deviceLabel]);
  const selectedWallet = useMemo(
    () => wallets.find((wallet) => wallet.id === selectedWalletId)?.provider ?? wallets[0]?.provider,
    [selectedWalletId, wallets],
  );
  const selectedWalletName = wallets.find((wallet) => wallet.provider === selectedWallet)?.name ?? "Select wallet";
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
    if (typeof window === "undefined") return;

    const discovered = new Map<string, WalletOption>();

    function publish() {
      const nextWallets = dedupeWallets(Array.from(discovered.values()));
      setWallets(nextWallets);
      setSelectedWalletId((current) => current || nextWallets[0]?.id || "");
    }

    function addProvider(provider: WalletProvider, name = walletName(provider), id = name) {
      discovered.set(id, { id, name, provider });
      publish();
    }

    function handleAnnouncement(event: Event) {
      const detail = (event as CustomEvent<{ info?: { uuid?: string; name?: string }; provider?: WalletProvider }>).detail;
      if (!detail?.provider) return;
      const name = detail.info?.name || walletName(detail.provider);
      const id = detail.info?.uuid || `${name}-${discovered.size}`;
      addProvider(detail.provider, name, id);
    }

    window.addEventListener("eip6963:announceProvider", handleAnnouncement);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    window.setTimeout(() => {
      const injected = window.ethereum;
      const providers = injected?.providers?.length ? injected.providers : injected ? [injected] : [];
      providers.forEach((provider, index) => addProvider(provider, walletName(provider, `Injected wallet ${index + 1}`), `legacy-${index}-${walletName(provider)}`));
    }, 250);

    return () => window.removeEventListener("eip6963:announceProvider", handleAnnouncement);
  }, []);

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
    if (!selectedWallet) return;

    let cancelled = false;

    async function detectConnectedWallet() {
      try {
        const accounts = (await selectedWallet?.request({ method: "eth_accounts" })) as string[] | undefined;
        const currentChainId = (await selectedWallet?.request({ method: "eth_chainId" })) as string | undefined;

        if (cancelled) return;
        if (accounts?.[0]) {
          setAccount(accounts[0]);
          setStatus(`${selectedWalletName} selected. Locking network to BOT Chain Testnet...`);
        } else {
          setAccount("");
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
      setStatus(nextAccount ? `${selectedWalletName} account detected. BOT Chain Testnet is required for actions.` : "Wallet disconnected.");
    }

    function handleChainChanged(nextChainId: unknown) {
      if (typeof nextChainId === "string") {
        setChainId(BigInt(nextChainId));
        if (nextChainId.toLowerCase() !== BOT_CHAIN_TESTNET.chainIdHex) {
          setStatus(`Wrong network (${nextChainId}). Switch back to BOT Chain Testnet ${BOT_CHAIN_TESTNET.chainIdHex}.`);
        }
      }
    }

    void detectConnectedWallet();
    selectedWallet.on?.("accountsChanged", handleAccountsChanged);
    selectedWallet.on?.("chainChanged", handleChainChanged);

    return () => {
      cancelled = true;
      selectedWallet.removeListener?.("accountsChanged", handleAccountsChanged);
      selectedWallet.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [selectedWallet, selectedWalletName]);

  async function getContract(withSigner = false) {
    if (!withSigner) {
      const provider = new JsonRpcProvider(BOT_CHAIN_TESTNET.rpcUrl);
      return new Contract(BOT_PULSE_CONTRACT_ADDRESS, BOT_PULSE_ABI, provider);
    }
    const provider = await getBrowserProvider(selectedWallet);
    const signer = await provider.getSigner();
    return new Contract(BOT_PULSE_CONTRACT_ADDRESS, BOT_PULSE_ABI, signer);
  }

  async function connectWallet() {
    setBusy(true);
    setStatus(`Opening ${selectedWalletName} connection request...`);
    try {
      if (!selectedWallet) {
        throw new Error("No EVM wallet detected. Install MetaMask/Rabby or open this page in a wallet browser.");
      }

      const lockedChainId = await ensureBotChain(selectedWallet);
      setChainId(lockedChainId);
      const accounts = (await selectedWallet.request({ method: "eth_requestAccounts" })) as string[];
      const connectedAccount = accounts?.[0];
      if (!connectedAccount) {
        throw new Error("Wallet did not return an account. Unlock the selected wallet and try again.");
      }

      setAccount(connectedAccount);
      setStatus(`${selectedWalletName} connected on BOT Chain Testnet. Loading deployed BOT Pulse state...`);
      await refreshDevice();
    } catch (error) {
      const maybeError = error as { code?: number; message?: string };
      if (maybeError.code === 4001) {
        setStatus("Wallet request rejected. Choose your wallet, then click Connect again when ready.");
      } else {
        setStatus(maybeError.message ?? "Wallet connection failed.");
      }
    } finally {
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
      const lockedChainId = await ensureBotChain(selectedWallet);
      setChainId(lockedChainId);
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
      const lockedChainId = await ensureBotChain(selectedWallet);
      setChainId(lockedChainId);
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
    <main className="bot-pulse-shell min-h-screen overflow-hidden bg-[#f4eddb] text-[#14291c]">
      <div className="pointer-events-none fixed inset-0 z-0 bg-[linear-gradient(180deg,#f7f0df_0%,#efe5cf_58%,#e8ddc6_100%)]" />
      <div className="relative z-10 grid-paper">
        <nav className="mx-auto mt-5 flex max-w-7xl items-center justify-between rounded-[1.1rem] border border-[#243524]/12 bg-[#fff9ea] px-4 py-3 shadow-[0_10px_24px_rgba(24,39,28,0.08)] sm:px-5">
          <a href="#top" className="flex items-center gap-3" aria-label="BOT Pulse home">
            <div className="relative flex size-11 items-center justify-center rounded-lg border border-[#21452d]/15 bg-[#1e6b3b] text-xl font-black text-[#d8ff7a] shadow-[0_8px_18px_rgba(24,39,28,0.12)]">
              <span className="absolute inset-1 rounded-xl border border-[#243524]/12" />
              ⌁
            </div>
            <div>
              <p className="type-label text-[#14291c]">BOT Pulse</p>
              <p className="text-xs font-medium text-[#546953]">SLA heartbeat watchtower</p>
            </div>
          </a>

          <div className="hidden items-center gap-5 text-sm font-semibold text-[#50644f] md:flex">
            <a href="#product" className="transition hover:text-[#1e6b3b]">Product</a>
            <a href="#live-state" className="transition hover:text-[#1e6b3b]">Live proof</a>
            <a href="/demo#interact" className="transition hover:text-[#1e6b3b]">Demo page</a>
            <a href="#evidence" className="transition hover:text-[#1e6b3b]">Evidence</a>
          </div>

          <div className="flex items-center gap-2">
            {wallets.length > 1 ? (
              <select
                aria-label="Select wallet"
                value={selectedWalletId}
                onChange={(event) => setSelectedWalletId(event.target.value)}
                className="hidden rounded-lg border border-[#243524]/15 bg-[#fff6e1] px-3 py-2 text-sm font-semibold text-[#14291c] outline-none focus:border-[#1e6b3b] sm:block"
              >
                {wallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>{wallet.name}</option>
                ))}
              </select>
            ) : null}
            <button
              onClick={connectWallet}
              disabled={busy || !selectedWallet}
              className="rounded-lg border border-[#1e6b3b] bg-[#d8ff7a] px-4 py-2 text-sm font-bold text-[#14291c] transition hover:bg-[#c8f35d] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {account ? shortAddress(account) : busy ? "Opening…" : selectedWallet ? `Connect ${selectedWalletName}` : "No wallet"}
            </button>
          </div>
        </nav>

        <section id="top" className="mx-auto grid max-w-7xl gap-8 px-5 pb-10 pt-14 sm:px-8 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:pb-16 lg:pt-20">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-3 rounded-lg border border-[#1e6b3b]/20 bg-[#d8ff7a]/40 px-4 py-2 type-label text-[#1e6b3b]">
              <span className="size-2 rounded-full bg-[#1e6b3b] " />
              BOT Chain testnet · DePIN liveness
            </div>

            <div className="space-y-5">
              <h1 className="type-hero max-w-5xl text-[#14291c]">
                Uptime proof people can inspect before trust is asked for.
              </h1>
              <p className="type-body max-w-2xl text-[#4f614f]">
                BOT Pulse is a dedicated landing page and live demo for a narrow BOT Chain primitive: devices commit heartbeat packet hashes, customers see the breach clock, and every claim links back to contract state.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["Window", "15 min", "freshness SLA"],
                ["Now", liveSlaState, breachEta],
                ["Network", "BOT", "testnet chain 968"],
              ].map(([label, value, sub]) => (
                <div key={label} className="rounded-xl border border-[#243524]/12 bg-[#fff9ea] p-4 shadow-[0_12px_24px_rgba(24,39,28,0.08)] ">
                  <p className="text-xs type-label tracking-[0.24em] text-[#8dffbe]">{label}</p>
                  <p className="mt-2 text-2xl font-black text-[#14291c]">{value}</p>
                  <p className="text-sm font-semibold text-[#9ab0a2]">{sub}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <a href="/demo#interact" className="rounded-full bg-[#f26c2f] px-6 py-3 text-center font-black text-white shadow-[0_12px_24px_rgba(185,74,29,0.20)] transition hover:scale-[1.02] hover:bg-[#ff8a4f]">
                Open live demo
              </a>
              <a href={explorerAddress(BOT_PULSE_CONTRACT_ADDRESS)} target="_blank" rel="noreferrer" className="rounded-full border border-[#14291c]/15 bg-[#fff9ea] px-6 py-3 text-center font-black text-[#14291c] transition hover:border-[#1e6b3b]/50 hover:text-[#1e6b3b]">
                Verify contract
              </a>
              <a href="#product" className="rounded-full border border-[#14291c]/12 bg-transparent px-6 py-3 text-center font-black text-[#5a6b58] transition hover:border-[#14291c]/30 hover:text-[#14291c]">
                Read the product story
              </a>
            </div>
          </div>

          <div id="live-state" className={`pulse-stage relative min-h-[620px] overflow-hidden rounded-[1.5rem] border border-[#243524]/12 bg-[#13291d] p-5 shadow-[0_22px_48px_rgba(24,39,28,0.18)]  ${pulseNonce ? "pulse-confirmed" : ""}`} key={pulseNonce}>
            <div className="absolute inset-0 bg-[linear-gradient(rgba(141,255,190,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(141,255,190,0.08)_1px,transparent_1px)] bg-[size:42px_42px]" />
            <div className="pulse-wave"></div>
            <div className="pulse-wave"></div>
            <div className="pulse-wave"></div>
            <div className="pulse-wave"></div>

            <div className="relative z-10 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs type-label tracking-[0.26em] text-[#8dffbe]">Live contract read</p>
                <h2 className="mt-2 text-2xl font-display font-black tracking-[-0.015em] text-white">Gateway liveness panel</h2>
              </div>
              <span className={`rounded-full px-4 py-2 text-sm font-black ${device?.fresh ? "bg-[#8dffbe] text-[#07110c]" : "bg-[#f26c2f] text-white"}`}>
                {publicLoading ? "syncing" : device?.fresh ? "covered" : "stale"}
              </span>
            </div>

            <div className="absolute left-1/2 top-32 z-10 h-64 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-[#8dffbe]/70 to-transparent"></div>
            <div className="absolute left-1/2 top-40 z-10 flex -translate-x-1/2 flex-col items-center gap-5">
              {["packet hash", "BOT tx", "freshness read", "breach clock"].map((label) => (
                <div key={label} className="uplink-dot rounded-full border border-[#8dffbe]/25 bg-[#0f2518]/95 px-3 py-1 text-xs type-label tracking-[0.18em] text-[#8dffbe] ">
                  {label}
                </div>
              ))}
            </div>

            <div className="absolute inset-x-5 bottom-5 z-10 rounded-[1.25rem] border border-[#243524]/12 bg-[#08120d]/95 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                {[
                  ["State", liveSlaState],
                  ["Clock", slaClock],
                  ["Proofs", device ? device.heartbeatCount.toString() : "—"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-[#f7f0df]/10 bg-white/[0.05] p-3">
                    <p className="text-xs type-label tracking-[0.22em] text-[#adc7b5]">{label}</p>
                    <p className="mt-1 break-words text-lg font-black text-[#f7f0df]">{value}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs type-label tracking-[0.24em] text-[#f26c2f]">{deviceLabel || "Gateway"}</p>
              <h2 className="mt-2 text-3xl font-display font-black tracking-[-0.02em] text-white">
                {device?.fresh ? "Heartbeat inside the SLA window." : device?.lastSeenAt && device.lastSeenAt > 0n ? "Missed heartbeat is visible." : "Ready for first uptime proof."}
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-[#adc7b5]">
                No fake fleet rows: the dashboard renders devices read from the deployed registry, then links users back to the BOT Chain explorer for verification.
              </p>
            </div>
          </div>
        </section>

        <section id="product" className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:py-12">
          <div className="rounded-[1.375rem] border border-[#243524]/12 bg-[#13291d]/[0.92] p-5 shadow-[0_18px_40px_rgba(24,39,28,0.10)]  lg:p-8">
            <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
              <div>
                <p className="text-xs type-label tracking-[0.28em] text-[#8dffbe]">Product story</p>
                <h2 className="mt-3 text-4xl font-display font-black tracking-[-0.025em] text-white sm:text-5xl">From “device pinged” to proof customers can inspect.</h2>
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
                <article key={title} className="rounded-xl border border-[#243524]/12 bg-[#172f22] p-5">
                  <p className="text-sm font-black text-[#f26c2f]">{number}</p>
                  <h3 className="mt-4 text-2xl font-display font-black tracking-[-0.015em] text-white">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-[#adc7b5]">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="demo-page" className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:py-12">
          <div className="relative overflow-hidden rounded-[1.5rem] border border-[#8dffbe]/18 bg-[#f7f1e8] p-5 text-[#07110c] shadow-[0_18px_40px_rgba(24,39,28,0.14)] lg:p-8">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(75,212,134,0.35),transparent_22rem),radial-gradient(circle_at_86%_16%,rgba(242,108,47,0.28),transparent_22rem)]" />
            <div className="relative z-10 grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
              <div>
                <p className="text-xs type-label tracking-[0.28em] text-[#386948]">Dedicated demo route</p>
                <h2 className="mt-3 max-w-3xl text-5xl font-black leading-[0.9] tracking-[-0.04em] sm:text-6xl">No hidden widget. No buried form. The demo has its own page.</h2>
                <p className="mt-5 max-w-2xl text-base font-semibold leading-7 text-[#455348]">
                  Judges can land on the story, then jump into a focused `/demo` route where the browser provider selector, BOT Chain lock, contract readout, tx actions, registry rows, and explorer evidence are all in one place.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <a href="/demo#interact" className="rounded-full bg-[#07110c] px-6 py-3 font-black text-white transition hover:bg-[#183523]">Launch /demo</a>
                  <a href="#interact" className="rounded-full border border-[#07110c]/15 px-6 py-3 font-black text-[#07110c] transition hover:border-[#07110c]/40">Use embedded demo</a>
                </div>
              </div>
              <div className="rounded-[1.25rem] border border-[#07110c]/10 bg-[#07110c] p-4 text-white shadow-2xl">
                <div className="mb-4 flex items-center justify-between border-b border-[#f7f0df]/12 pb-4">
                  <div>
                    <p className="text-xs type-label tracking-[0.24em] text-[#8dffbe]">Demo console</p>
                    <p className="mt-1 text-sm font-semibold text-[#50644f]">BOT Chain Testnet · chain 968 · provider-gated writes</p>
                  </div>
                  <span className="rounded-full bg-[#8dffbe] px-3 py-1 text-xs font-black text-[#07110c]">/demo</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["1", "Select provider", "EIP-6963 + injected wallets; selected provider is reused for signer, listeners, chain switch, and transactions."],
                    ["2", "Read first", "Public RPC loads the registry before any wallet prompt, so the demo still explains itself."],
                    ["3", "Write only when ready", "Register and heartbeat buttons unlock after BOT Chain is selected and an account is connected."],
                    ["4", "Verify", "Every submitted tx is appended as an explorer link instead of pretending off-chain status is proof."],
                  ].map(([step, title, body]) => (
                    <div key={title} className="rounded-xl border border-[#243524]/12 bg-[#13291d]/[0.92] p-4">
                      <p className="text-sm font-black text-[#f26c2f]">{step}</p>
                      <h3 className="mt-2 text-xl font-display font-black tracking-[-0.015em] text-white">{title}</h3>
                      <p className="mt-2 text-sm leading-6 text-[#adc7b5]">{body}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="interact" className="mx-auto grid max-w-7xl gap-6 px-5 py-8 sm:px-8 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[1.25rem] border border-[#243524]/12 bg-[#13291d] p-5 shadow-[0_18px_40px_rgba(24,39,28,0.12)] ">
            <div className="mb-5">
              <p className="text-xs type-label tracking-[0.24em] text-[#8dffbe]">SLA proof controls</p>
              <h2 className="mt-2 text-3xl font-display font-black tracking-[-0.015em] text-white">Register a device, then prove uptime.</h2>
              <p className="mt-2 max-h-28 overflow-auto break-words rounded-xl border border-[#f7f0df]/10 bg-[#13291d]/[0.92] p-3 text-sm leading-6 text-[#c8d8cd]">{status}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-sm font-bold">
                <a href={BOT_CHAIN_TESTNET.faucetUrl} target="_blank" rel="noreferrer" className="rounded-full bg-[#f26c2f]/15 px-3 py-2 text-[#ffb089] hover:bg-[#f26c2f]/25">
                  Faucet: get test BOT
                </a>
                <a href={BOT_CHAIN_TESTNET.explorerUrl} target="_blank" rel="noreferrer" className="rounded-full bg-[#8dffbe]/12 px-3 py-2 text-[#8dffbe] hover:bg-[#8dffbe]/20">
                  BOT explorer
                </a>
              </div>
              {deviceBelongsToAnotherWallet ? (
                <p className="mt-3 rounded-xl bg-[#f26c2f]/15 p-3 text-sm font-bold text-[#ffb089]">
                  Seeded challenge gateway is owned by {shortAddress(device?.owner ?? "")}. Use your own device label to register and send pulses from your wallet.
                </p>
              ) : null}
              {chainId && !onCorrectChain ? (
                <p className="mt-3 rounded-xl bg-[#f26c2f]/15 p-3 text-sm font-bold text-[#ffb089]">
                  Wrong chain detected. Switch to BOT Chain testnet chain ID 968.
                </p>
              ) : null}
            </div>

            <div className="grid gap-4">
              <label className="grid gap-2 text-sm font-semibold text-[#50644f]">
                Browser wallet provider
                <select
                  value={selectedWalletId}
                  onChange={(event) => setSelectedWalletId(event.target.value)}
                  disabled={!wallets.length || busy}
                  className="rounded-xl border border-[#243524]/12 bg-black/20 px-4 py-3 text-white outline-none focus:border-[#8dffbe] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {wallets.length ? wallets.map((wallet) => (
                    <option key={wallet.id} value={wallet.id}>{wallet.name}</option>
                  )) : <option value="">No injected wallet detected</option>}
                </select>
                <span className="text-xs font-semibold text-[#8ea497]">This uses the selected injected provider directly, not a mystery WalletConnect modal. The same provider handles account access, chain switching, signer creation, listeners, and transactions. Writes are forced onto BOT Chain Testnet ({BOT_CHAIN_TESTNET.chainIdHex}) before the account request opens.</span>
              </label>
              <label className="grid gap-2 text-sm font-semibold text-[#50644f]">
                Device label
                <input value={deviceLabel} onChange={(event) => { setDeviceLabel(event.target.value); setDevice(null); }} className="rounded-xl border border-[#243524]/12 bg-black/20 px-4 py-3 text-white outline-none focus:border-[#8dffbe]" />
              </label>
              <label className="grid gap-2 text-sm font-semibold text-[#50644f]">
                Metadata URI
                <input value={metadataURI} onChange={(event) => setMetadataURI(event.target.value)} className="rounded-xl border border-[#243524]/12 bg-black/20 px-4 py-3 text-white outline-none focus:border-[#8dffbe]" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-semibold text-[#50644f]">
                  Metric type
                  <select value={metricType} onChange={(event) => setMetricType(event.target.value)} className="rounded-xl border border-[#243524]/12 bg-black/20 px-4 py-3 text-white outline-none focus:border-[#8dffbe]">
                    <option value="latency_ms">latency_ms</option>
                    <option value="temperature_c">temperature_c</option>
                    <option value="uptime_pct">uptime_pct</option>
                    <option value="watt_hours">watt_hours</option>
                    <option value="pm25">pm25</option>
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-semibold text-[#50644f]">
                  Metric value
                  <input value={metricValue} onChange={(event) => setMetricValue(event.target.value.replace(/[^0-9-]/g, ""))} className="rounded-xl border border-[#243524]/12 bg-black/20 px-4 py-3 text-white outline-none focus:border-[#8dffbe]" />
                </label>
              </div>
              {!account ? (
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <button onClick={connectWallet} disabled={busy || !selectedWallet} className="rounded-xl bg-[#8dffbe] px-5 py-3 font-black text-[#07110c] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50">
                    {selectedWallet ? `Connect ${selectedWalletName} on BOT Chain` : "Install an EVM wallet"}
                  </button>
                  <button onClick={refreshDevice} disabled={busy} className="rounded-xl border border-white/12 bg-[#fff9ea] px-5 py-3 font-black text-white transition hover:border-[#8dffbe]/45 disabled:cursor-not-allowed disabled:opacity-50">
                    Refresh state
                  </button>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  <button onClick={registerDevice} disabled={busy || Boolean(device?.active && isDeviceOwner)} className="rounded-xl bg-white px-5 py-3 font-black text-[#07110c] transition hover:bg-[#8dffbe] disabled:cursor-not-allowed disabled:opacity-50">
                    {registerButtonLabel}
                  </button>
                  <button onClick={sendHeartbeat} disabled={busy || !device?.active || !isDeviceOwner} className="rounded-xl bg-[#f26c2f] px-5 py-3 font-black text-white transition hover:bg-[#ff8a4f] disabled:cursor-not-allowed disabled:opacity-50">
                    {heartbeatButtonLabel}
                  </button>
                  <button onClick={refreshDevice} disabled={busy} className="rounded-xl border border-white/12 bg-[#fff9ea] px-5 py-3 font-black text-white transition hover:border-[#8dffbe]/45 disabled:cursor-not-allowed disabled:opacity-50">
                    Refresh state
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[1.25rem] border border-[#243524]/12 bg-[#13291d] p-5 shadow-[0_18px_40px_rgba(24,39,28,0.12)] " id="contract">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs type-label tracking-[0.24em] text-[#8dffbe]">On-chain SLA state</p>
                <h2 className="mt-2 text-3xl font-display font-black tracking-[-0.015em] text-white">Freshness becomes accountability.</h2>
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
                <div key={label} className="rounded-xl border border-[#f7f0df]/10 bg-[#13291d]/[0.92] p-4">
                  <p className="text-xs type-label tracking-[0.2em] text-[#adc7b5]">{label}</p>
                  <p className="mt-2 break-words text-lg font-black text-[#f7f0df]">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-[#8dffbe]/15 bg-black/30 p-4 font-mono text-xs font-semibold leading-6 text-[#adc7b5]">
              deviceId: {deviceId}<br />
              latestHash: {device?.latestDataHash || "—"}
            </div>
          </div>
        </section>

        <section id="evidence" className="mx-auto grid max-w-7xl gap-6 px-5 py-8 sm:px-8 lg:grid-cols-[1.2fr_.8fr]">
          <div className="rounded-[1.25rem] border border-[#243524]/12 bg-[#13291d] p-5 shadow-[0_18px_40px_rgba(24,39,28,0.12)] ">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs type-label tracking-[0.24em] text-[#8dffbe]">Live registry</p>
                <h2 className="mt-2 text-3xl font-display font-black tracking-[-0.015em] text-white">Only devices read from the contract.</h2>
              </div>
              <div className="rounded-full bg-[#8dffbe] px-4 py-2 text-sm font-black text-[#07110c]">
                {publicLoading ? "reading RPC" : publicError ? "RPC unavailable" : `${registryDevices.length} on-chain`}
              </div>
            </div>

            {publicError ? (
              <p className="rounded-xl bg-[#f26c2f]/15 p-4 text-sm font-bold leading-6 text-[#ffb089]">{publicError}</p>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              {registryDevices.map((entry, index) => {
                const state = slaState(entry.snapshot);
                return (
                  <article key={entry.id} className="rounded-[1.5rem] border border-[#243524]/12 bg-[#13291d]/[0.92] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black capitalize text-white">{metadataName(entry.snapshot.metadataURI, entry.id)}</p>
                        <p className="mt-1 break-all font-mono text-xs font-semibold text-[#8ea497]">{entry.id}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${entry.snapshot.fresh ? "bg-[#8dffbe]/18 text-[#8dffbe]" : "bg-[#f26c2f]/18 text-[#ffb089]"}`}>
                        {state}
                      </span>
                    </div>
                    <div className="my-5 grid gap-3 rounded-xl border border-[#f7f0df]/10 bg-black/20 p-4 sm:grid-cols-3">
                      <div>
                        <p className="text-xs type-label tracking-[0.2em] text-[#adc7b5]">metric</p>
                        <p className="mt-1 text-base font-black leading-tight text-[#f7f0df]">{formatMetricLabel(entry.snapshot.latestMetricType)}</p>
                      </div>
                      <div>
                        <p className="text-xs type-label tracking-[0.2em] text-[#adc7b5]">value</p>
                        <p className="mt-1 text-lg font-black text-[#f7f0df]">{entry.snapshot.latestValue.toString()}</p>
                      </div>
                      <div>
                        <p className="text-xs type-label tracking-[0.2em] text-[#adc7b5]">proofs</p>
                        <p className="mt-1 text-lg font-black text-[#f7f0df]">{entry.snapshot.heartbeatCount.toString()}</p>
                      </div>
                    </div>
                    <div className="grid gap-2 text-xs font-bold text-[#adc7b5] sm:grid-cols-2">
                      <span>Owner: {shortAddress(entry.snapshot.owner)}</span>
                      <span>{formatSlaClock(entry.snapshot.lastSeenAt)}</span>
                    </div>
                    {index === 0 ? (
                      <p className="mt-3 rounded-xl bg-[#8dffbe]/12 p-3 text-xs font-bold leading-5 text-[#8dffbe]">
                        Seeded challenge gateway. More rows appear only after wallets register more devices on-chain.
                      </p>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>

          <aside className="relative overflow-hidden rounded-[1.25rem] border border-[#243524]/12 bg-[#13291d] p-5 text-white shadow-[0_18px_40px_rgba(24,39,28,0.12)] ">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(242,108,47,0.16),transparent_18rem),linear-gradient(rgba(141,255,190,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(141,255,190,0.06)_1px,transparent_1px)] bg-[size:auto,38px_38px,38px_38px]" />
            <div className="relative z-10">
            <p className="text-xs type-label tracking-[0.24em] text-[#8dffbe]">Evidence trail</p>
            <h2 className="mt-2 text-3xl font-display font-black tracking-[-0.015em] text-white">Every visible status must come from a contract read or submitted tx.</h2>
            {txLog.length ? (
              <ol className="mt-6 space-y-3">
                {txLog.map((entry) => (
                  <li key={`${entry.label}-${entry.hash}`} className="rounded-xl border border-[#243524]/12 bg-[#13291d]/[0.92] p-3 text-sm leading-6 text-[#adc7b5]">
                    <a href={explorerTx(entry.hash)} target="_blank" rel="noreferrer" className="font-black text-[#8dffbe] hover:text-white">
                      {entry.label}: {shortAddress(entry.hash)}
                    </a>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="mt-6 rounded-xl border border-[#243524]/12 bg-[#13291d]/[0.92] p-4 text-sm font-semibold leading-6 text-[#adc7b5]">
                No wallet transaction has been sent in this browser session. Use the contract link to verify the deployed registry, or connect a wallet to produce a new explorer-linked transaction.
              </div>
            )}
            <div className="mt-6 rounded-xl border border-[#8dffbe]/15 bg-black/25 p-4 font-mono text-xs font-semibold leading-6 text-[#c8d8cd]">
              {proofSteps.map((step) => (
                <div key={step}>✓ {step}</div>
              ))}
            </div>
            </div>
          </aside>
        </section>

        <footer className="mx-auto max-w-7xl px-5 pb-10 pt-12 sm:px-8">
          <div className="relative overflow-hidden rounded-[1.5rem] border border-[#8dffbe]/18 bg-[#f7f1e8] text-[#07110c] shadow-[0_18px_40px_rgba(24,39,28,0.14)]">
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(141,255,190,0.24),transparent_34%),radial-gradient(circle_at_90%_15%,rgba(242,108,47,0.32),transparent_22rem)]" />
            <div className="relative z-10 grid gap-8 p-6 lg:grid-cols-[1.05fr_0.95fr] lg:p-9">
              <div>
                <div className="flex items-center gap-3">
                  <div className="flex size-12 items-center justify-center rounded-xl bg-[#07110c] text-2xl font-black text-[#8dffbe] shadow-[0_18px_38px_rgba(7,17,12,0.22)]">⌁</div>
                  <div>
                    <p className="text-sm type-label tracking-[0.34em] text-[#07110c]">BOT Pulse</p>
                    <p className="text-sm font-bold text-[#516154]">BOT Chain liveness proof · testnet MVP</p>
                  </div>
                </div>
                <h2 className="mt-7 max-w-3xl text-4xl font-black leading-[0.95] tracking-[-0.025em] sm:text-5xl">
                  A footer should close the argument, not die after four links.
                </h2>
                <p className="mt-5 max-w-2xl text-base font-semibold leading-7 text-[#455348]">
                  The build is intentionally narrow: public uptime evidence, provider-gated wallet writes, a 15-minute freshness window, and explorer-verifiable BOT Chain transactions. No fake fleet, no unaudited production claims.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <a href="/demo#interact" className="rounded-full bg-[#07110c] px-5 py-3 font-black text-white transition hover:bg-[#183523]">Open the demo page</a>
                  <a href={explorerAddress(BOT_PULSE_CONTRACT_ADDRESS)} target="_blank" rel="noreferrer" className="rounded-full border border-[#07110c]/15 px-5 py-3 font-black text-[#07110c] transition hover:border-[#07110c]/45">Verify contract</a>
                  <a href="#top" className="rounded-full border border-[#07110c]/15 px-5 py-3 font-black text-[#07110c] transition hover:border-[#07110c]/45">Back to top</a>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-[#07110c]/10 bg-white/60 p-5">
                  <p className="text-xs type-label tracking-[0.24em] text-[#386948]">Builder proof</p>
                  <div className="mt-4 space-y-3 text-sm font-bold leading-6 text-[#455348]">
                    <p>Contract: <a href={explorerAddress(BOT_PULSE_CONTRACT_ADDRESS)} target="_blank" rel="noreferrer" className="text-[#07110c] underline decoration-[#4bd486]/50 underline-offset-4">{shortAddress(BOT_PULSE_CONTRACT_ADDRESS)}</a></p>
                    <p>Network: BOT Chain Testnet 968</p>
                    <p>Wallet: selected browser provider only for writes</p>
                    <p>Reads: public RPC before connect</p>
                  </div>
                </div>
                <div className="rounded-xl border border-[#07110c]/10 bg-[#07110c] p-5 text-white shadow-2xl">
                  <p className="text-xs type-label tracking-[0.24em] text-[#8dffbe]">Submission links</p>
                  <div className="mt-4 grid gap-2 text-sm font-black">
                    <a href="/demo#interact" className="rounded-full bg-white/[0.08] px-4 py-3 text-white hover:bg-white/[0.14]">Dedicated /demo route</a>
                    <a href={BOT_CHAIN_TESTNET.explorerUrl} target="_blank" rel="noreferrer" className="rounded-full bg-white/[0.08] px-4 py-3 text-white hover:bg-white/[0.14]">BOT explorer</a>
                    <a href={BOT_CHAIN_TESTNET.faucetUrl} target="_blank" rel="noreferrer" className="rounded-full bg-white/[0.08] px-4 py-3 text-white hover:bg-white/[0.14]">Testnet faucet</a>
                    <a href="#evidence" className="rounded-full bg-[#8dffbe] px-4 py-3 text-[#07110c] hover:bg-white">Evidence trail</a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}






