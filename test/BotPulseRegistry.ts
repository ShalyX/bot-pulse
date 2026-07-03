import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("BotPulseRegistry", function () {
  const deviceId = ethers.id("gateway-lagos-01");
  const metadataURI = "ipfs://bot-pulse/gateway-lagos-01.json";

  it("registers a device and emits a registration event", async function () {
    const registry = await ethers.deployContract("BotPulseRegistry");
    const [owner] = await ethers.getSigners();

    await expect(registry.registerDevice(deviceId, metadataURI))
      .to.emit(registry, "DeviceRegistered")
      .withArgs(deviceId, owner.address, metadataURI);

    const device = await registry.getDevice(deviceId);
    expect(device.owner).to.equal(owner.address);
    expect(device.metadataURI).to.equal(metadataURI);
    expect(await registry.deviceCount()).to.equal(1n);
  });

  it("anchors heartbeat data and marks a device fresh", async function () {
    const registry = await ethers.deployContract("BotPulseRegistry");
    await registry.registerDevice(deviceId, metadataURI);

    const packetHash = ethers.keccak256(ethers.toUtf8Bytes("latency-ms:42:nonce-1"));

    await expect(registry.submitHeartbeat(deviceId, packetHash, "latency_ms", 42))
      .to.emit(registry, "HeartbeatSubmitted");

    const device = await registry.getDevice(deviceId);
    expect(device.heartbeatCount).to.equal(1n);
    expect(device.latestDataHash).to.equal(packetHash);
    expect(device.latestMetricType).to.equal("latency_ms");
    expect(device.latestValue).to.equal(42n);
    expect(await registry.isFresh(deviceId)).to.equal(true);
  });

  it("turns stale after the freshness window", async function () {
    const registry = await ethers.deployContract("BotPulseRegistry");
    await registry.registerDevice(deviceId, metadataURI);
    await registry.submitHeartbeat(deviceId, ethers.id("packet-1"), "uptime_pct", 9999);

    await networkHelpers.time.increase(16 * 60);

    expect(await registry.isFresh(deviceId)).to.equal(false);
  });

  it("rejects heartbeat submissions from non-owners", async function () {
    const registry = await ethers.deployContract("BotPulseRegistry");
    const [, stranger] = await ethers.getSigners();
    await registry.registerDevice(deviceId, metadataURI);

    await expect(
      registry.connect(stranger).submitHeartbeat(deviceId, ethers.id("packet-2"), "temperature_c", 29),
    ).to.be.revertedWith("not device owner");
  });
});
