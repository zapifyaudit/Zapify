export const CONFIG = {
  chainId: 4663,
  chainName: 'Robinhood Chain',
  rpcUrls: [
    process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
    'https://robinhoodchain.blockscout.com/api/eth-rpc'
  ],
  explorerApi: process.env.BLOCKSCOUT_API_URL || 'https://robinhoodchain.blockscout.com/api/v2',
  dexChain: process.env.DEXSCREENER_CHAIN || 'robinhood',
  maxFundingLookups: 12
};