// src/lib/routers.ts
export const PCS_FACTORY: Record<number, string> = {
    56: '0xca143ce32fe78f1f7019d7d551a6402fc5350c73', // mainnet
    97: '0x6725F303b657a9451d8BA641348b6761A6CC7a17', // testnet
  };
  
  export const PANCAKE_V2_ROUTER: Record<number, string> = {
    56: '0x10ED43C718714eb63d5aA57B78B54704E256024E', // mainnet
    97: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1', // testnet
  };
  
  export const WBNB_ADDR: Record<number, string> = {
    56: '0xBB4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    97: '0xae13d989dac2f0debff460ac112a837c89baa7cd',
  };
  
  export function pancakeSwapLink(chain: number, token: string, direction: 'buy' | 'sell' = 'buy') {
    const t = token; // ensure checksum elsewhere if you want, PCS accepts lower/upper
    return direction === 'buy'
      ? `https://pancakeswap.finance/swap?chain=${chain === 56 ? 'bsc' : 'bscTestnet'}&inputCurrency=tBNB&outputCurrency=${t}`
      : `https://pancakeswap.finance/swap?chain=${chain === 56 ? 'bsc' : 'bscTestnet'}&inputCurrency=${t}&outputCurrency=tBNB`;
  }
  