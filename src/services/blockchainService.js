const { ethers } = require('ethers');
const logger = require('../utils/logger');

// ERC20 ABI for transfer function
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function decimals() external view returns (uint8)',
  'function balanceOf(address account) external view returns (uint256)'
];

class BlockchainService {
  constructor() {
    // RPC URLs for different chains
    this.rpcUrls = {
      1: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
      56: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
      137: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
      // Add more chains as needed
    };

    // Private key for withdrawAddress (should be stored securely in .env)
    this.privateKey = process.env.WITHDRAW_PRIVATE_KEY || '';
    
    if (!this.privateKey) {
      logger.warn('WITHDRAW_PRIVATE_KEY not set in environment variables');
    }
  }

  /**
   * Get provider for a specific chain
   */
  getProvider(chainId, customRpcUrl = null) {
    // Use custom RPC URL if provided, otherwise use configured RPC URLs
    const rpcUrl = customRpcUrl || this.rpcUrls[chainId];
    if (!rpcUrl) {
      throw new Error(`RPC URL not configured for chainId: ${chainId}`);
    }
    return new ethers.providers.JsonRpcProvider(rpcUrl);
  }

  /**
   * Get wallet instance for withdrawAddress
   */
  getWallet(chainId, customRpcUrl = null) {
    if (!this.privateKey) {
      throw new Error('WITHDRAW_PRIVATE_KEY not configured');
    }
    const provider = this.getProvider(chainId, customRpcUrl);
    return new ethers.Wallet(this.privateKey, provider);
  }

  /**
   * Send native token (ETH, BNB, etc.)
   */
  async sendNativeToken(fromAddress, toAddress, amount, chainId, customRpcUrl = null) {
    try {
      const wallet = this.getWallet(chainId, customRpcUrl);
      
      // Verify the wallet address matches fromAddress
      if (wallet.address.toLowerCase() !== fromAddress.toLowerCase()) {
        throw new Error(`Wallet address ${wallet.address} does not match fromAddress ${fromAddress}`);
      }

      const tx = await wallet.sendTransaction({
        to: toAddress,
        value: ethers.utils.parseEther(amount.toString())
      });

      logger.info('Native token transfer transaction sent:', {
        txHash: tx.hash,
        from: fromAddress,
        to: toAddress,
        amount: amount,
        chainId: chainId
      });

      // Wait for transaction confirmation
      const receipt = await tx.wait();
      
      return {
        success: true,
        txHash: tx.hash,
        receipt: receipt
      };
    } catch (error) {
      logger.error('Error sending native token:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send ERC20 token
   */
  async sendERC20Token(tokenAddress, fromAddress, toAddress, amount, chainId, decimals = 18, customRpcUrl = null) {
    try {
      const wallet = this.getWallet(chainId, customRpcUrl);
      
      // Verify the wallet address matches fromAddress
      if (wallet.address.toLowerCase() !== fromAddress.toLowerCase()) {
        throw new Error(`Wallet address ${wallet.address} does not match fromAddress ${fromAddress}`);
      }

      // Create contract instance
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

      // Get actual decimals from contract if not provided
      let tokenDecimals = decimals;
      try {
        tokenDecimals = await contract.decimals();
      } catch (err) {
        logger.warn(`Could not fetch decimals from contract, using provided value: ${decimals}`);
      }

      // Calculate amount with decimals
      const amountBN = ethers.utils.parseUnits(amount.toString(), tokenDecimals);

      // Send transfer transaction
      const tx = await contract.transfer(toAddress, amountBN);

      logger.info('ERC20 token transfer transaction sent:', {
        txHash: tx.hash,
        tokenAddress: tokenAddress,
        from: fromAddress,
        to: toAddress,
        amount: amount,
        chainId: chainId
      });

      // Wait for transaction confirmation
      const receipt = await tx.wait();

      return {
        success: true,
        txHash: tx.hash,
        receipt: receipt
      };
    } catch (error) {
      logger.error('Error sending ERC20 token:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send token (native or ERC20) from withdrawAddress to walletAddress
   */
  async sendToken(tokenAddress, fromAddress, toAddress, amount, chainId, chainName, decimals = 18, customRpcUrl = null) {
    try {
      // Check if native token
      const isNativeToken = !tokenAddress || 
                           tokenAddress === '0x0000000000000000000000000000000000000000' ||
                           tokenAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

      if (isNativeToken) {
        return await this.sendNativeToken(fromAddress, toAddress, amount, chainId, customRpcUrl);
      } else {
        return await this.sendERC20Token(tokenAddress, fromAddress, toAddress, amount, chainId, decimals, customRpcUrl);
      }
    } catch (error) {
      logger.error('Error in sendToken:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new BlockchainService();
