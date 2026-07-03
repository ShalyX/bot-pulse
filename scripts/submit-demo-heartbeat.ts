import { network } from "hardhat";
import { keccak256, toUtf8Bytes } from "ethers";

const CONTRACT_ADDRESS = process.env["BOT_PULSE_CONTRACT"] ?? "0x588eb96429A3c22f22848185F2b5FfD08AdfD8Ae";

const { ethers } = await network.create({
  network: "botChainTestnet",
  chainType: "l1",
});

const [sender] = await ethers.getSigners();
const registry = await ethers.getContractAt("BotPulseRegistry", CONTRACT_ADDRESS);

const deviceId = keccak256(toUtf8Bytes("gateway-lagos-01"));
const metadataURI = "ipfs://bot-pulse/gateway-lagos-01.json";
const packet = JSON.stringify({
  deviceId: "gateway-lagos-01",
  metricType: "latency_ms",
  value: 42,
  region: "Lagos",
  observedAt: new Date().toISOString(),
  nonce: crypto.randomUUID(),
});
const packetHash = keccak256(toUtf8Bytes(packet));

console.log("BOT Pulse demo interaction");
console.log("Sender:", sender.address);
console.log("Contract:", CONTRACT_ADDRESS);
console.log("Device ID:", deviceId);
console.log("Packet hash:", packetHash);

try {
  await registry.getDevice(deviceId);
  console.log("Device already registered");
} catch {
  console.log("Registering device...");
  const registerTx = await registry.registerDevice(deviceId, metadataURI);
  console.log("Register tx:", registerTx.hash);
  await registerTx.wait();
}

console.log("Submitting heartbeat...");
const heartbeatTx = await registry.submitHeartbeat(deviceId, packetHash, "latency_ms", 42);
console.log("Heartbeat tx:", heartbeatTx.hash);
await heartbeatTx.wait();

const device = await registry.getDevice(deviceId);
const fresh = await registry.isFresh(deviceId);

console.log("Heartbeat count:", device.heartbeatCount.toString());
console.log("Latest metric:", device.latestMetricType);
console.log("Latest value:", device.latestValue.toString());
console.log("Fresh:", fresh);
console.log(`Heartbeat explorer: https://scan.bohr.life/tx/${heartbeatTx.hash}`);
