import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

function pk(): string[] {
  const k = (process.env.PRIVATE_KEY || "").trim();
  if (!k) return [];
  return [k.startsWith("0x") ? k : ("0x" + k)];
}

const BSCTEST_FALLBACK =
  "https://bsc-testnet-rpc.publicnode.com"; // fallback if .env empty

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.25",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true, // enables the IR pipeline (helps with stack-too-deep)
    },
  },
  networks: {
    bsctest: {
      url: process.env.BSCTEST_RPC_URL?.trim() || BSCTEST_FALLBACK,
      chainId: 97,
      accounts: pk(),
    },
  },
};

export default config;
