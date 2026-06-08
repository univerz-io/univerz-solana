require("dotenv").config();

require("@nomiclabs/hardhat-etherscan");
require("@nomiclabs/hardhat-waffle");
require("hardhat-gas-reporter");
require("solidity-coverage");

// Custom task definition
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    // 1. Declare the baseline default version
    version: "0.8.17",
    settings: {
      optimizer: { enabled: true, runs: 1000 },
    },
    // 2. Explicitly map your legacy folders and third-party node_modules to separate compiler targets
    overrides: {
      "contracts/registry/OwnableDelegateProxy.sol": { version: "0.7.6" },
      "contracts/registry/ProxyRegistryInterface.sol": { version: "0.7.6" },
      "contracts/registry/ProxyRegistry.sol": { version: "0.7.6" },
      "contracts/registry/proxy/OwnedUpgradeabilityProxy.sol": { version: "0.7.6" },
      "contracts/registry/proxy/OwnedUpgradeabilityStorage.sol": { version: "0.7.6" },
      "contracts/registry/proxy/Proxy.sol": { version: "0.7.6" },
      
      // Force Hardhat's graph resolver to route openzeppelin-solidity through the 0.7.6 pipeline
      "openzeppelin-solidity/contracts/access/Ownable.sol": { version: "0.7.6" },
      "openzeppelin-solidity/contracts/utils/Context.sol": { version: "0.7.6" },
      "node_modules/openzeppelin-solidity/contracts/access/Ownable.sol": { version: "0.7.6" },
      "node_modules/openzeppelin-solidity/contracts/utils/Context.sol": { version: "0.7.6" }
    }
  },
  networks: {
    goerli: {
      url: process.env.GOERLI_URL || "",
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    rinkeby: {
      url: process.env.RINKEBY_URL || "",
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};