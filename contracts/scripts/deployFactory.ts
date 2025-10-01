// scripts/deployFactory.ts
import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  // ---- Your desired settings ----
  const TREASURY               = "0x53dEa4ED05C6AEaE13f6bDC827761eFc42695225";
  const PLATFORM_FEE_BPS       = 95;                          // uint16
  const CREATION_FEE_WEI       = ethers.parseEther("0.01");   // 0.01 BNB

  // Reference values used when CREATING POOLS (not factory deploy args)
  const X0_WEI                 = ethers.parseEther("6");      // 6 BNB
  const Y0_UNITS               = 99_000_000_000_000_000_000_000_000_000n; // 99e27
  const TARGET_CAP_DEFAULT_WEI = ethers.parseEther("40");     // 40 BNB

  // If your constructor includes a router:
  const PANCAKE_ROUTER_TESTNET = "0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3";

  console.log("=== Deploying CoinrushFactory ===");
  console.log("Deployer:                  ", await deployer.getAddress());
  console.log("Treasury:                  ", TREASURY);
  console.log("Platform fee (bps):        ", PLATFORM_FEE_BPS);
  console.log("Creation fee (BNB):        ", "0.01");
  console.log("— Reference for create() —");
  console.log("x0 (wei):                  ", X0_WEI.toString());
  console.log("y0 (units wei):            ", Y0_UNITS.toString());
  console.log("targetCapDefault (wei):    ", TARGET_CAP_DEFAULT_WEI.toString());

  const Factory = await ethers.getContractFactory("CoinrushFactory");

  // Introspect constructor inputs from artifact
  const ctorInputs: Array<{ type: string; name: string }> =
    (Factory.interface as any).deploy?.inputs ?? [];
  const sig = `constructor(${ctorInputs.map(i => `${i.type} ${i.name || ""}`.trim()).join(", ")})`;
  console.log("Detected:", sig || "constructor()");

  // Build args by input name/type (robust to order & arity)
  const args: any[] = [];
  for (const inp of ctorInputs) {
    const t = inp.type;
    const n = (inp.name || "").toLowerCase();

    if (t === "address") {
      if (n.includes("treas")) { args.push(TREASURY); continue; }
      if (n.includes("router") || /pancake|uniswap|dex/.test(n)) { args.push(PANCAKE_ROUTER_TESTNET); continue; }
      // Fallback: unknown address param → assume router-like if named so; otherwise throw
      throw new Error(`Don't know how to fill address param "${inp.name}"`);
    }

    if (t === "uint16") {
      if (n.includes("bps") || n.includes("feebps") || n.includes("platform")) { args.push(PLATFORM_FEE_BPS); continue; }
      throw new Error(`Don't know how to fill uint16 param "${inp.name}"`);
    }

    if (t === "uint256") {
      if (n.includes("creation")) { args.push(CREATION_FEE_WEI); continue; }
      if (n.includes("x0"))       { args.push(X0_WEI); continue; }
      if (n.includes("y0"))       { args.push(Y0_UNITS); continue; }
      if (n.includes("target"))   { args.push(TARGET_CAP_DEFAULT_WEI); continue; }
      // If your constructor is 6/7-arg and names don’t include the above,
      // add custom mappings here as needed.
      throw new Error(`Don't know how to fill uint256 param "${inp.name}"`);
    }

    throw new Error(`Unsupported constructor param type "${t}" for "${inp.name}"`);
  }

  // Deploy (no stray "overrides" string at the end!)
  const contract = await Factory.deploy(...args);
  await contract.waitForDeployment();

  const addr = await contract.getAddress();
  console.log("CoinrushFactory deployed at:", addr);

  // Optional: log gas used
  const r = await contract.deploymentTransaction()?.wait();
  if (r) console.log("Gas used:", r.gasUsed?.toString());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
