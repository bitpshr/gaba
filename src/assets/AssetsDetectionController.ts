import { toChecksumAddress } from 'ethereumjs-util';
import BaseController, { BaseConfig, BaseState } from '../BaseController';
import type { NetworkState, NetworkType } from '../network/NetworkController';
import type { PreferencesState } from '../user/PreferencesController';
import { safelyExecute, timeoutFetch } from '../util';
import type { AssetsState, Collectible, CollectibleInformation } from './AssetsController';
import type { BalanceMap } from './AssetsContractController';
import { Token } from './TokenRatesController';

const contractMap = require('@metamask/contract-metadata');

const DEFAULT_INTERVAL = 180000;
const MAINNET = 'mainnet';

/**
 * @type ApiCollectibleResponse
 *
 * Collectible object coming from OpenSea api
 *
 * @property token_id - The collectible identifier
 * @property image_original_url - URI of collectible image associated with this collectible
 * @property name - The collectible name
 * @property description - The collectible description
 * @property assetContract - The collectible contract basic information, in this case the address
 */
export interface ApiCollectibleResponse {
  token_id: string;
  image_original_url: string;
  name: string;
  description: string;
  asset_contract: { [address: string]: string };
}

/**
 * @type AssetsConfig
 *
 * Assets controller configuration
 *
 * @property interval - Polling interval used to fetch new token rates
 * @property networkType - Network type ID as per net_version
 * @property selectedAddress - Vault selected address
 * @property tokens - List of tokens associated with the active vault
 */
export interface AssetsDetectionConfig extends BaseConfig {
  interval: number;
  networkType: NetworkType;
  selectedAddress: string;
  tokens: Token[];
}

/**
 * Controller that passively polls on a set interval for assets auto detection
 */
export class AssetsDetectionController extends BaseController<AssetsDetectionConfig, BaseState> {
  private handle?: NodeJS.Timer;

  private getOwnerCollectiblesApi(address: string) {
    return `https://api.opensea.io/api/v1/assets?owner=${address}&limit=300`;
  }

  private async getOwnerCollectibles() {
    const { selectedAddress } = this.config;
    const api = this.getOwnerCollectiblesApi(selectedAddress);
    let response: Response;
    try {
      const openSeaApiKey = this.getOpenSeaApiKey();
      /* istanbul ignore if */
      if (openSeaApiKey) {
        response = await timeoutFetch(api, { headers: { 'X-API-KEY': openSeaApiKey } }, 15000);
      } else {
        response = await timeoutFetch(api, {}, 15000);
      }
    } catch (e) {
      /* istanbul ignore next */
      return [];
    }
    const collectiblesArray = await response.json();
    const collectibles = collectiblesArray.assets;
    return collectibles;
  }

  /**
   * Name of this controller used during composition
   */
  name = 'AssetsDetectionController';

  private getOpenSeaApiKey: () => string;

  private getAssetContractBalancesInSingleCall: (selectedAddress: string, tokensToDetect: string[]) => BalanceMap;

  private addTokens: (tokensToAdd: Token[]) => Promise<Token[]>;

  private addCollectible: (
    address: string,
    tokenId: number,
    opts?: CollectibleInformation,
    detection?: boolean,
  ) => Promise<void>;

  private removeCollectible: (address: string, tokenId: number) => void;

  private assetsState: {
    collectibles: Collectible[];
    ignoredCollectibles: Collectible[];
    ignoredTokens: Token[];
  };

  /**
   * Creates a AssetsDetectionController instance
   *
   * @param config - Initial options used to configure this controller
   * @param state - Initial state to set on this controller
   */
  constructor(
    onAssetStateChange: (listener: (assetsState: AssetsState) => void) => void,
    onPreferencesStateChange: (listener: (preferencesState: PreferencesState) => void) => void,
    onNetworkStateChange: (listener: (networkState: NetworkState) => void) => void,
    getOpenSeaApiKey: () => string,
    getAssetContractBalancesInSingleCall: (selectedAddress: string, tokensToDetect: string[]) => BalanceMap,
    addTokens: (tokensToAdd: Token[]) => Promise<Token[]>,
    addCollectible: (
      address: string,
      tokenId: number,
      opts?: CollectibleInformation,
      detection?: boolean,
    ) => Promise<void>,
    removeCollectible: (address: string, tokenId: number) => void,
    initialAssetsState: AssetsState,
    config?: Partial<AssetsDetectionConfig>,
    state?: Partial<BaseState>,
  ) {
    super(config, state);
    this.defaultConfig = {
      interval: DEFAULT_INTERVAL,
      networkType: 'mainnet',
      selectedAddress: '',
      tokens: [],
    };
    this.initialize();
    this.assetsState = {
      collectibles: initialAssetsState.collectibles,
      ignoredCollectibles: initialAssetsState.ignoredCollectibles,
      ignoredTokens: initialAssetsState.ignoredTokens,
    };
    this.addTokens = addTokens;
    onAssetStateChange(({ collectibles, ignoredCollectibles, ignoredTokens, tokens }) => {
      this.configure({ tokens });
      this.assetsState = {
        collectibles,
        ignoredCollectibles,
        ignoredTokens,
      };
    });
    onPreferencesStateChange(({ selectedAddress }) => {
      const actualSelectedAddress = this.config.selectedAddress;
      if (selectedAddress !== actualSelectedAddress) {
        this.configure({ selectedAddress });
        this.detectAssets();
      }
    });
    onNetworkStateChange(({ provider }) => {
      this.configure({ networkType: provider.type });
    });
    this.getOpenSeaApiKey = getOpenSeaApiKey;
    this.getAssetContractBalancesInSingleCall = getAssetContractBalancesInSingleCall;
    this.addCollectible = addCollectible;
    this.removeCollectible = removeCollectible;
    this.poll();
  }

  /**
   * Starts a new polling interval
   *
   * @param interval - Polling interval used to auto detect assets
   */
  async poll(interval?: number): Promise<void> {
    interval && this.configure({ interval }, false, false);
    this.handle && clearTimeout(this.handle);
    await this.detectAssets();
    this.handle = setTimeout(() => {
      this.poll(this.config.interval);
    }, this.config.interval);
  }

  /**
   * Checks whether network is mainnet or not
   *
   * @returns - Whether current network is mainnet
   */
  isMainnet() {
    if (this.config.networkType !== MAINNET || this.disabled) {
      return false;
    }
    return true;
  }

  /**
   * Detect assets owned by current account on mainnet
   */
  async detectAssets() {
    /* istanbul ignore if */
    if (!this.isMainnet()) {
      return;
    }
    this.detectTokens();
    this.detectCollectibles();
  }

  /**
   * Triggers asset ERC20 token auto detection for each contract address in contract metadata on mainnet
   */
  async detectTokens() {
    /* istanbul ignore if */
    if (!this.isMainnet()) {
      return;
    }
    const tokensAddresses = this.config.tokens.filter(/* istanbul ignore next*/ (token) => token.address);
    const tokensToDetect: string[] = [];
    for (const address in contractMap) {
      const contract = contractMap[address];
      if (contract.erc20 && !(address in tokensAddresses)) {
        tokensToDetect.push(address);
      }
    }

    const { selectedAddress } = this.config;
    /* istanbul ignore else */
    if (!selectedAddress) {
      return;
    }
    await safelyExecute(async () => {
      const balances = await this.getAssetContractBalancesInSingleCall(selectedAddress, tokensToDetect);
      const tokensToAdd = [];
      for (const tokenAddress in balances) {
        let ignored;
        /* istanbul ignore else */
        if (this.assetsState.ignoredTokens.length) {
          ignored = this.assetsState.ignoredTokens.find((token) => token.address === toChecksumAddress(tokenAddress));
        }
        if (!ignored) {
          tokensToAdd.push({
            address: tokenAddress,
            decimals: contractMap[tokenAddress].decimals,
            symbol: contractMap[tokenAddress].symbol,
          });
        }
      }
      if (tokensToAdd.length) {
        await this.addTokens(tokensToAdd);
      }
    });
  }

  /**
   * Triggers asset ERC721 token auto detection on mainnet
   * adding new collectibles and removing not owned collectibles
   */
  async detectCollectibles() {
    /* istanbul ignore if */
    if (!this.isMainnet()) {
      return;
    }
    const { selectedAddress } = this.config;
    /* istanbul ignore else */
    if (!selectedAddress) {
      return;
    }
    await safelyExecute(async () => {
      let collectiblesToRemove = this.assetsState.collectibles;
      const apiCollectibles = await this.getOwnerCollectibles();
      const addCollectiblesPromises = apiCollectibles.map(async (collectible: ApiCollectibleResponse) => {
        const {
          token_id,
          image_original_url,
          name,
          description,
          asset_contract: { address },
        } = collectible;

        let ignored;
        /* istanbul ignore else */
        if (this.assetsState.ignoredCollectibles.length) {
          ignored = this.assetsState.ignoredCollectibles.find((c) => {
            /* istanbul ignore next */
            return c.address === toChecksumAddress(address) && c.tokenId === Number(token_id);
          });
        }
        /* istanbul ignore else */
        if (!ignored) {
          await this.addCollectible(
            address,
            Number(token_id),
            {
              description,
              image: image_original_url,
              name,
            },
            true,
          );
        }
        collectiblesToRemove = collectiblesToRemove.filter((c) => {
          return !(c.tokenId === Number(token_id) && c.address === toChecksumAddress(address));
        });
      });
      await Promise.all(addCollectiblesPromises);
      collectiblesToRemove.forEach(({ address, tokenId }) => {
        this.removeCollectible(address, tokenId);
      });
    });
  }
}

export default AssetsDetectionController;
