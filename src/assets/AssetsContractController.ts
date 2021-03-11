import BaseController, { BaseConfig, BaseState } from '../BaseController';

// TODO: Destructuring this line introduces a compilation error
// eslint-disable-next-line prefer-destructuring
const BN = require('ethereumjs-util').BN;
const Web3 = require('web3');
const abiERC20 = require('human-standard-token-abi');
const abiERC721 = require('human-standard-collectible-abi');
const abiSingleCallBalancesContract = require('single-call-balance-checker-abi');

const ERC721METADATA_INTERFACE_ID = '0x5b5e139f';
const ERC721ENUMERABLE_INTERFACE_ID = '0x780e9d63';
const SINGLE_CALL_BALANCES_ADDRESS = '0xb1f8e55c7f64d203c1400b9d8555d050f94adf39';

/**
 * @type AssetsContractConfig
 *
 * Assets Contract controller configuration
 *
 * @property provider - Provider used to create a new web3 instance
 */
export interface AssetsContractConfig extends BaseConfig {
  provider: any;
}

/**
 * @type BalanceMap
 *
 * Key value object containing the balance for each tokenAddress
 *
 * @property [tokenAddress] - Address of the token
 */
export interface BalanceMap {
  [tokenAddress: string]: string;
}

/**
 * Controller that interacts with contracts on mainnet through web3
 */
export class AssetsContractController extends BaseController<AssetsContractConfig, BaseState> {
  private web3: any;

  /**
   *
   * Query if a contract implements an interface
   *
   * @param address - Asset contract address
   * @param interfaceId - Interface identifier
   * @returns - Promise resolving to whether the contract implements `interfaceID`
   */
  private async contractSupportsInterface(address: string, interfaceId: string): Promise<boolean> {
    const contract = this.web3.eth.contract(abiERC721).at(address);
    return new Promise<boolean>((resolve, reject) => {
      contract.supportsInterface(interfaceId, (error: Error, result: boolean) => {
        /* istanbul ignore if */
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });
  }

  /**
   * Name of this controller used during composition
   */
  name = 'AssetsContractController';

  /**
   * Creates a AssetsContractController instance
   *
   * @param config - Initial options used to configure this controller
   * @param state - Initial state to set on this controller
   */
  constructor(config?: Partial<AssetsContractConfig>, state?: Partial<BaseState>) {
    super(config, state);
    this.defaultConfig = {
      provider: undefined,
    };
    this.initialize();
  }

  /**
   * Sets a new provider
   *
   * @property provider - Provider used to create a new underlying Web3 instance
   */
  set provider(provider: any) {
    this.web3 = new Web3(provider);
  }

  /**
   * Query if contract implements ERC721Metadata interface
   *
   * @param address - ERC721 asset contract address
   * @returns - Promise resolving to whether the contract implements ERC721Metadata interface
   */
  async contractSupportsMetadataInterface(address: string): Promise<boolean> {
    return this.contractSupportsInterface(address, ERC721METADATA_INTERFACE_ID);
  }

  /**
   * Query if contract implements ERC721Enumerable interface
   *
   * @param address - ERC721 asset contract address
   * @returns - Promise resolving to whether the contract implements ERC721Enumerable interface
   */
  async contractSupportsEnumerableInterface(address: string): Promise<boolean> {
    return this.contractSupportsInterface(address, ERC721ENUMERABLE_INTERFACE_ID);
  }

  /**
   * Get balance or count for current account on specific asset contract
   *
   * @param address - Asset contract address
   * @param selectedAddress - Current account public address
   * @returns - Promise resolving to BN object containing balance for current account on specific asset contract
   */
  async getBalanceOf(address: string, selectedAddress: string): Promise<typeof BN> {
    const contract = this.web3.eth.contract(abiERC20).at(address);
    return new Promise<typeof BN>((resolve, reject) => {
      contract.balanceOf(selectedAddress, (error: Error, result: typeof BN) => {
        /* istanbul ignore if */
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });
  }

  /**
   * Enumerate assets assigned to an owner
   *
   * @param address - ERC721 asset contract address
   * @param selectedAddress - Current account public address
   * @param index - A collectible counter less than `balanceOf(selectedAddress)`
   * @returns - Promise resolving to token identifier for the 'index'th asset assigned to 'selectedAddress'
   */
  getCollectibleTokenId(address: string, selectedAddress: string, index: number): Promise<number> {
    const contract = this.web3.eth.contract(abiERC721).at(address);
    return new Promise<number>((resolve, reject) => {
      contract.tokenOfOwnerByIndex(selectedAddress, index, (error: Error, result: typeof BN) => {
        /* istanbul ignore if */
        if (error) {
          reject(error);
          return;
        }
        resolve(result.toNumber());
      });
    });
  }

  /**
   * Query for tokenURI for a given asset
   *
   * @param address - ERC721 asset contract address
   * @param tokenId - ERC721 asset identifier
   * @returns - Promise resolving to the 'tokenURI'
   */
  async getCollectibleTokenURI(address: string, tokenId: number): Promise<string> {
    const supportsMetadata = await this.contractSupportsMetadataInterface(address);
    /* istanbul ignore if */
    if (!supportsMetadata) {
      return '';
    }
    const contract = this.web3.eth.contract(abiERC721).at(address);
    return new Promise<string>((resolve, reject) => {
      contract.tokenURI(tokenId, (error: Error, result: string) => {
        /* istanbul ignore if */
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });
  }

  /**
   * Query for name for a given ERC20 asset
   *
   * @param address - ERC20 asset contract address
   * @returns - Promise resolving to the 'decimals'
   */
  async getTokenDecimals(address: string): Promise<string> {
    const contract = this.web3.eth.contract(abiERC20).at(address);
    return new Promise<string>((resolve, reject) => {
      contract.decimals((error: Error, result: string) => {
        /* istanbul ignore if */
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });
  }

  /**
   * Query for name for a given asset
   *
   * @param address - ERC721 or ERC20 asset contract address
   * @returns - Promise resolving to the 'name'
   */
  async getAssetName(address: string): Promise<string> {
    const contract = this.web3.eth.contract(abiERC721).at(address);
    return new Promise<string>((resolve, reject) => {
      contract.name((error: Error, result: string) => {
        /* istanbul ignore if */
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });
  }

  /**
   * Query for symbol for a given asset
   *
   * @param address - ERC721 or ERC20 asset contract address
   * @returns - Promise resolving to the 'symbol'
   */
  async getAssetSymbol(address: string): Promise<string> {
    const contract = this.web3.eth.contract(abiERC721).at(address);
    return new Promise<string>((resolve, reject) => {
      contract.symbol((error: Error, result: string) => {
        /* istanbul ignore if */
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });
  }

  /**
   * Query for owner for a given ERC721 asset
   *
   * @param address - ERC721 asset contract address
   * @param tokenId - ERC721 asset identifier
   * @returns - Promise resolving to the owner address
   */
  async getOwnerOf(address: string, tokenId: number): Promise<string> {
    const contract = this.web3.eth.contract(abiERC721).at(address);
    return new Promise<string>((resolve, reject) => {
      contract.ownerOf(tokenId, (error: Error, result: string) => {
        /* istanbul ignore if */
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });
  }

  /**
   * Returns contract instance of
   *
   * @returns - Promise resolving to the 'tokenURI'
   */
  async getBalancesInSingleCall(selectedAddress: string, tokensToDetect: string[]) {
    const contract = this.web3.eth.contract(abiSingleCallBalancesContract).at(SINGLE_CALL_BALANCES_ADDRESS);
    return new Promise<BalanceMap>((resolve, reject) => {
      contract.balances([selectedAddress], tokensToDetect, (error: Error, result: typeof BN[]) => {
        /* istanbul ignore if */
        if (error) {
          reject(error);
          return;
        }
        const nonZeroBalances: BalanceMap = {};
        /* istanbul ignore else */
        if (result.length > 0) {
          tokensToDetect.forEach((tokenAddress, index) => {
            const balance: typeof BN = result[index];
            /* istanbul ignore else */
            if (!balance.isZero()) {
              nonZeroBalances[tokenAddress] = balance;
            }
          });
        }
        resolve(nonZeroBalances);
      });
    });
  }
}

export default AssetsContractController;
