export function rpcNice(e: any): string {
    const s =
      e?.info?.error?.message ||
      e?.error?.message ||
      e?.data?.message ||
      e?.shortMessage ||
      e?.message ||
      "";
    const lower = s.toLowerCase();
  
    if (lower.includes("insufficient funds")) return "Not enough BNB for gas or value.";
    if (lower.includes("user rejected")) return "Transaction rejected in your wallet.";
    if (lower.includes("owner") || lower.includes("authorized")) return "Only the pool owner can migrate.";
    if (lower.includes("target") || lower.includes("cap")) return "Target not reached on-chain yet.";
    if (lower.includes("execution reverted")) return s.replace(/^.*execution reverted:\s*/i, "");
    if (lower.includes("internal json-rpc")) return "RPC/node error. Try again or switch RPC.";
  
    return s || "Action failed. Please try again.";
  }
  