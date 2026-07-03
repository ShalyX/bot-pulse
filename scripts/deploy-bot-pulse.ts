import { network } from "hardhat";

const { ethers } = await network.create({
  network: "botChainTestnet",
  chainType: "l1",
});

const [deployer] = await ethers.getSigners();
console.log("Deploying BotPulseRegistry to BOT Chain testnet");
console.log("Deployer:", deployer.address);

const registry = await ethers.deployContract("BotPulseRegistry");
await registry.waitForDeployment();

const address = await registry.getAddress();
const deploymentTx = registry.deploymentTransaction();

console.log("Contract:", address);
console.log("Deployment tx:", deploymentTx?.hash ?? "unknown");
console.log(`Explorer: https://scan.bohr.life/address/${address}`);
