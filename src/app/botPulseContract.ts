export const BOT_CHAIN_TESTNET = {
  chainId: 968n,
  chainIdHex: "0x3c8",
  chainName: "BOT Chain Testnet",
  rpcUrl: "https://rpc.bohr.life",
  explorerUrl: "https://scan.bohr.life",
  faucetUrl: "https://faucet.botchain.ai/basic",
  nativeCurrency: {
    name: "BOT",
    symbol: "BOT",
    decimals: 18,
  },
} as const;

export const BOT_PULSE_CONTRACT_ADDRESS = "0x588eb96429A3c22f22848185F2b5FfD08AdfD8Ae" as const;

export const BOT_PULSE_ABI = [
  "function registerDevice(bytes32 deviceId, string metadataURI)",
  "function submitHeartbeat(bytes32 deviceId, bytes32 dataHash, string metricType, int256 value)",
  "function getDevice(bytes32 deviceId) view returns (tuple(address owner,string metadataURI,uint64 registeredAt,uint64 lastSeenAt,uint64 heartbeatCount,bytes32 latestDataHash,string latestMetricType,int256 latestValue,bool active))",
  "function isFresh(bytes32 deviceId) view returns (bool)",
  "function deviceCount() view returns (uint256)",
  "function listDeviceIds() view returns (bytes32[])",
  "event DeviceRegistered(bytes32 indexed deviceId, address indexed owner, string metadataURI)",
  "event HeartbeatSubmitted(bytes32 indexed deviceId, address indexed submitter, bytes32 indexed dataHash, string metricType, int256 value, uint256 observedAt)",
] as const;
