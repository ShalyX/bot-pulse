import "dotenv/config";
import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    botChainTestnet: {
      type: "http",
      chainType: "l1",
      url: "https://rpc.bohr.life",
      accounts: [configVariable("BOTCHAIN_PRIVATE_KEY")],
    },
    botChainMainnet: {
      type: "http",
      chainType: "l1",
      url: "https://rpc.botchain.ai",
      accounts: [configVariable("BOTCHAIN_PRIVATE_KEY")],
    },
  },
});
