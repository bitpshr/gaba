import { EventEmitter } from 'events';
import { toChecksumAddress } from 'ethereumjs-util';
import BaseController, { BaseConfig, BaseState } from '../BaseController';
import type { PreferencesState } from '../user/PreferencesController';
import type { NetworkState, NetworkType } from '../network/NetworkController';
import { safelyExecute, handleFetch, validateTokenToWatch } from '../util';
import type { Token } from './TokenRatesController';
import type { ApiCollectibleResponse } from './AssetsDetectionController';

const { Mutex } = require('async-mutex');
const random = require('uuid').v1;

/**
 * @type Collectible
 *
 * Collectible representation
 *
 * @property address - Hex address of a ERC721 contract
 * @property description - The collectible description
 * @property image - URI of custom collectible image associated with this tokenId
 * @property name - Name associated with this tokenId and contract address
 * @property tokenId - The collectible identifier
 */
export interface Collectible {
  address: string;
  description?: string;
  image?: string;
  name?: string;
  tokenId: number;
}

/**
 * @type CollectibleContract
 *
 * Collectible contract information representation
 *
 * @property name - Contract name
 * @property logo - Contract logo
 * @property address - Contract address
 * @property symbol - Contract symbol
 * @property description - Contract description
 * @property totalSupply - Contract total supply
 */
export interface CollectibleContract {
  name?: string;
  logo?: string;
  address: string;
  symbol?: string;
  description?: string;
  totalSupply?: string;
}

/**
 * @type ApiCollectibleContractResponse
 *
 * Collectible contract object coming from OpenSea api
 *
 * @property description - The collectible identifier
 * @property image_url - URI of collectible image associated with this collectible
 * @property name - The collectible name
 * @property description - The collectible description
 * @property total_supply - Contract total supply
 */
export interface ApiCollectibleContractResponse {
  description?: string;
  image_url?: string;
  name?: string;
  symbol?: string;
  total_supply?: string;
}

/**
 * @type CollectibleInformation
 *
 * Collectible custom information
 *
 * @property description - The collectible description
 * @property name - Collectible custom name
 * @property image - Image custom image URI
 */
export interface CollectibleInformation {
  description?: string;
  image?: string;
  name?: string;
}

/**
 * @type AssetsConfig
 *
 * Assets controller configuration
 *
 * @property networkType - Network ID as per net_version
 * @property selectedAddress - Vault selected address
 */
export interface AssetsConfig extends BaseConfig {
  networkType: NetworkType;
  selectedAddress: string;
}

/**
 * @type AssetSuggestionResult
 *
 * @property result - Promise resolving to a new suggested asset address
 * @property suggestedAssetMeta - Meta information about this new suggested asset
 */
export interface AssetSuggestionResult {
  result: Promise<string>;
  suggestedAssetMeta: SuggestedAssetMeta;
}

/**
 * @type SuggestedAssetMeta
 *
 * Suggested asset by EIP747 meta data
 *
 * @property error - Synthesized error information for failed asset suggestions
 * @property id - Generated UUID associated with this suggested asset
 * @property status - String status of this this suggested asset
 * @property time - Timestamp associated with this this suggested asset
 * @property type - Type type this suggested asset
 * @property asset - Asset suggested object
 */
export interface SuggestedAssetMeta {
  error?: {
    message: string;
    stack?: string;
  };
  id: string;
  status: string;
  time: number;
  type: string;
  asset: Token;
}

/**
 * @type AssetsState
 *
 * Assets controller state
 *
 * @property allTokens - Object containing tokens per account and network
 * @property allCollectibleContracts - Object containing collectibles contract information
 * @property allCollectibles - Object containing collectibles per account and network
 * @property collectibleContracts - List of collectibles contracts associated with the active vault
 * @property collectibles - List of collectibles associated with the active vault
 * @property suggestedAssets - List of suggested assets associated with the active vault
 * @property tokens - List of tokens associated with the active vault
 * @property ignoredTokens - List of tokens that should be ignored
 * @property ignoredCollectibles - List of collectibles that should be ignored
 */
export interface AssetsState extends BaseState {
  allTokens: { [key: string]: { [key: string]: Token[] } };
  allCollectibleContracts: { [key: string]: { [key: string]: CollectibleContract[] } };
  allCollectibles: { [key: string]: { [key: string]: Collectible[] } };
  collectibleContracts: CollectibleContract[];
  collectibles: Collectible[];
  ignoredTokens: Token[];
  ignoredCollectibles: Collectible[];
  suggestedAssets: SuggestedAssetMeta[];
  tokens: Token[];
}

/**
 * Controller that stores assets and exposes convenience methods
 */
export class AssetsController extends BaseController<AssetsConfig, AssetsState> {
  private mutex = new Mutex();

  private getCollectibleApi(contractAddress: string, tokenId: number) {
    return `https://api.opensea.io/api/v1/asset/${contractAddress}/${tokenId}`;
  }

  private getCollectibleContractInformationApi(contractAddress: string) {
    return `https://api.opensea.io/api/v1/asset_contract/${contractAddress}`;
  }

  private failSuggestedAsset(suggestedAssetMeta: SuggestedAssetMeta, error: Error) {
    suggestedAssetMeta.status = 'failed';
    suggestedAssetMeta.error = {
      message: error.toString(),
      stack: error.stack,
    };
    this.hub.emit(`${suggestedAssetMeta.id}:finished`, suggestedAssetMeta);
  }

  /**
   * Request individual collectible information from OpenSea api
   *
   * @param contractAddress - Hex address of the collectible contract
   * @param tokenId - The collectible identifier
   * @returns - Promise resolving to the current collectible name and image
   */
  private async getCollectibleInformationFromApi(
    contractAddress: string,
    tokenId: number,
  ): Promise<CollectibleInformation> {
    const tokenURI = this.getCollectibleApi(contractAddress, tokenId);
    let collectibleInformation: ApiCollectibleResponse;
    /* istanbul ignore if */
    if (this.openSeaApiKey) {
      collectibleInformation = await handleFetch(tokenURI, { headers: { 'X-API-KEY': this.openSeaApiKey } });
    } else {
      collectibleInformation = await handleFetch(tokenURI);
    }
    const { name, description, image_original_url } = collectibleInformation;
    return { image: image_original_url, name, description };
  }

  /**
   * Request individual collectible information from contracts that follows Metadata Interface
   *
   * @param contractAddress - Hex address of the collectible contract
   * @param tokenId - The collectible identifier
   * @returns - Promise resolving to the current collectible name and image
   */
  private async getCollectibleInformationFromTokenURI(
    contractAddress: string,
    tokenId: number,
  ): Promise<CollectibleInformation> {
    const tokenURI = await this.getCollectibleTokenURI(contractAddress, tokenId);
    const object = await handleFetch(tokenURI);
    const image = object.hasOwnProperty('image') ? 'image' : /* istanbul ignore next */ 'image_url';
    return { image: object[image], name: object.name };
  }

  /**
   * Request individual collectible information (name, image url and description)
   *
   * @param contractAddress - Hex address of the collectible contract
   * @param tokenId - The collectible identifier
   * @returns - Promise resolving to the current collectible name and image
   */
  private async getCollectibleInformation(contractAddress: string, tokenId: number): Promise<CollectibleInformation> {
    let information;
    // First try with OpenSea
    information = await safelyExecute(async () => {
      return await this.getCollectibleInformationFromApi(contractAddress, tokenId);
    });
    if (information) {
      return information;
    }
    // Then following ERC721 standard
    information = await safelyExecute(async () => {
      return await this.getCollectibleInformationFromTokenURI(contractAddress, tokenId);
    });
    /* istanbul ignore next */
    if (information) {
      return information;
    }
    /* istanbul ignore next */
    return {};
  }

  /**
   * Request collectible contract information from OpenSea api
   *
   * @param contractAddress - Hex address of the collectible contract
   * @returns - Promise resolving to the current collectible name and image
   */
  private async getCollectibleContractInformationFromApi(
    contractAddress: string,
  ): Promise<ApiCollectibleContractResponse> {
    const api = this.getCollectibleContractInformationApi(contractAddress);
    let collectibleContractObject;
    /* istanbul ignore if */
    if (this.openSeaApiKey) {
      collectibleContractObject = await handleFetch(api, { headers: { 'X-API-KEY': this.openSeaApiKey } });
    } else {
      collectibleContractObject = await handleFetch(api);
    }
    const { name, symbol, image_url, description, total_supply } = collectibleContractObject;
    return { name, symbol, image_url, description, total_supply };
  }

  /**
   * Request collectible contract information from the contract itself
   *
   * @param contractAddress - Hex address of the collectible contract
   * @returns - Promise resolving to the current collectible name and image
   */
  private async getCollectibleContractInformationFromContract(
    contractAddress: string,
  ): Promise<ApiCollectibleContractResponse> {
    const name = await this.getAssetName(contractAddress);
    const symbol = await this.getAssetSymbol(contractAddress);
    return { name, symbol };
  }

  /**
   * Request collectible contract information from OpenSea api
   *
   * @param contractAddress - Hex address of the collectible contract
   * @returns - Promise resolving to the collectible contract name, image and description
   */
  private async getCollectibleContractInformation(contractAddress: string): Promise<ApiCollectibleContractResponse> {
    let information;
    // First try with OpenSea
    information = await safelyExecute(async () => {
      return await this.getCollectibleContractInformationFromApi(contractAddress);
    });
    if (information) {
      return information;
    }
    // Then following ERC721 standard
    information = await safelyExecute(async () => {
      return await this.getCollectibleContractInformationFromContract(contractAddress);
    });
    if (information) {
      return information;
    }
    /* istanbul ignore next */
    return {};
  }

  /**
   * Adds an individual collectible to the stored collectible list
   *
   * @param address - Hex address of the collectible contract
   * @param tokenId - The collectible identifier
   * @param opts - Collectible optional information (name, image and description)
   * @returns - Promise resolving to the current collectible list
   */
  private async addIndividualCollectible(
    address: string,
    tokenId: number,
    opts?: CollectibleInformation,
  ): Promise<Collectible[]> {
    const releaseLock = await this.mutex.acquire();
    try {
      address = toChecksumAddress(address);
      const { allCollectibles, collectibles } = this.state;
      const { networkType, selectedAddress } = this.config;
      const existingEntry = collectibles.find(
        (collectible) => collectible.address === address && collectible.tokenId === tokenId,
      );
      if (existingEntry) {
        return collectibles;
      }
      const { name, image, description } = opts || (await this.getCollectibleInformation(address, tokenId));
      const newEntry: Collectible = { address, tokenId, name, image, description };
      const newCollectibles = [...collectibles, newEntry];
      const addressCollectibles = allCollectibles[selectedAddress];
      const newAddressCollectibles = { ...addressCollectibles, ...{ [networkType]: newCollectibles } };
      const newAllCollectibles = { ...allCollectibles, ...{ [selectedAddress]: newAddressCollectibles } };
      this.update({ allCollectibles: newAllCollectibles, collectibles: newCollectibles });
      return newCollectibles;
    } finally {
      releaseLock();
    }
  }

  /**
   * Adds a collectible contract to the stored collectible contracts list
   *
   * @param address - Hex address of the collectible contract
   * @param detection? - Whether the collectible is manually added or auto-detected
   * @returns - Promise resolving to the current collectible contracts list
   */
  private async addCollectibleContract(address: string, detection?: boolean): Promise<CollectibleContract[]> {
    const releaseLock = await this.mutex.acquire();
    try {
      address = toChecksumAddress(address);
      const { allCollectibleContracts, collectibleContracts } = this.state;
      const { networkType, selectedAddress } = this.config;
      const existingEntry = collectibleContracts.find((collectibleContract) => collectibleContract.address === address);
      if (existingEntry) {
        return collectibleContracts;
      }
      const contractInformation = await this.getCollectibleContractInformation(address);
      const { name, symbol, image_url, description, total_supply } = contractInformation;
      // If being auto-detected opensea information is expected
      // Oherwise at least name and symbol from contract is needed
      if ((detection && !image_url) || Object.keys(contractInformation).length === 0) {
        return collectibleContracts;
      }
      const newEntry: CollectibleContract = {
        address,
        description,
        logo: image_url,
        name,
        symbol,
        totalSupply: total_supply,
      };
      const newCollectibleContracts = [...collectibleContracts, newEntry];
      const addressCollectibleContracts = allCollectibleContracts[selectedAddress];
      const newAddressCollectibleContracts = {
        ...addressCollectibleContracts,
        ...{ [networkType]: newCollectibleContracts },
      };
      const newAllCollectibleContracts = {
        ...allCollectibleContracts,
        ...{ [selectedAddress]: newAddressCollectibleContracts },
      };
      this.update({
        allCollectibleContracts: newAllCollectibleContracts,
        collectibleContracts: newCollectibleContracts,
      });
      return newCollectibleContracts;
    } finally {
      releaseLock();
    }
  }

  /**
   * Removes an individual collectible from the stored token list and saves it in ignored collectibles list
   *
   * @param address - Hex address of the collectible contract
   * @param tokenId - Token identifier of the collectible
   */
  private removeAndIgnoreIndividualCollectible(address: string, tokenId: number) {
    address = toChecksumAddress(address);
    const { allCollectibles, collectibles, ignoredCollectibles } = this.state;
    const { networkType, selectedAddress } = this.config;
    const newIgnoredCollectibles = [...ignoredCollectibles];
    const newCollectibles = collectibles.filter((collectible) => {
      if (collectible.address === address && collectible.tokenId === tokenId) {
        const alreadyIgnored = newIgnoredCollectibles.find((c) => c.address === address && c.tokenId === tokenId);
        !alreadyIgnored && newIgnoredCollectibles.push(collectible);
        return false;
      }
      return true;
    });
    const addressCollectibles = allCollectibles[selectedAddress];
    const newAddressCollectibles = { ...addressCollectibles, ...{ [networkType]: newCollectibles } };
    const newAllCollectibles = { ...allCollectibles, ...{ [selectedAddress]: newAddressCollectibles } };
    this.update({
      allCollectibles: newAllCollectibles,
      collectibles: newCollectibles,
      ignoredCollectibles: newIgnoredCollectibles,
    });
  }

  /**
   * Removes an individual collectible from the stored token list
   *
   * @param address - Hex address of the collectible contract
   * @param tokenId - Token identifier of the collectible
   */
  private removeIndividualCollectible(address: string, tokenId: number) {
    address = toChecksumAddress(address);
    const { allCollectibles, collectibles } = this.state;
    const { networkType, selectedAddress } = this.config;
    const newCollectibles = collectibles.filter(
      (collectible) => !(collectible.address === address && collectible.tokenId === tokenId),
    );
    const addressCollectibles = allCollectibles[selectedAddress];
    const newAddressCollectibles = { ...addressCollectibles, ...{ [networkType]: newCollectibles } };
    const newAllCollectibles = { ...allCollectibles, ...{ [selectedAddress]: newAddressCollectibles } };
    this.update({ allCollectibles: newAllCollectibles, collectibles: newCollectibles });
  }

  /**
   * Removes a collectible contract to the stored collectible contracts list
   *
   * @param address - Hex address of the collectible contract
   * @returns - Promise resolving to the current collectible contracts list
   */
  private removeCollectibleContract(address: string): CollectibleContract[] {
    address = toChecksumAddress(address);
    const { allCollectibleContracts, collectibleContracts } = this.state;
    const { networkType, selectedAddress } = this.config;
    const newCollectibleContracts = collectibleContracts.filter(
      (collectibleContract) => !(collectibleContract.address === address),
    );
    const addressCollectibleContracts = allCollectibleContracts[selectedAddress];
    const newAddressCollectibleContracts = {
      ...addressCollectibleContracts,
      ...{ [networkType]: newCollectibleContracts },
    };
    const newAllCollectibleContracts = {
      ...allCollectibleContracts,
      ...{ [selectedAddress]: newAddressCollectibleContracts },
    };
    this.update({
      allCollectibleContracts: newAllCollectibleContracts,
      collectibleContracts: newCollectibleContracts,
    });
    return newCollectibleContracts;
  }

  /**
   * EventEmitter instance used to listen to specific EIP747 events
   */
  hub = new EventEmitter();

  /**
   * Optional API key to use with opensea
   */
  openSeaApiKey?: string;

  /**
   * Name of this controller used during composition
   */
  name = 'AssetsController';

  private getAssetName: (address: string) => Promise<string>;

  private getAssetSymbol: (address: string) => Promise<string>;

  private getCollectibleTokenURI: (address: string, tokenId: number) => Promise<string>;

  /**
   * Creates a AssetsController instance
   *
   * @param config - Initial options used to configure this controller
   * @param state - Initial state to set on this controller
   */
  constructor(
    onPreferencesStateChange: (listener: (preferencesState: PreferencesState) => void) => void,
    onNetworkStateChange: (listener: (networkState: NetworkState) => void) => void,
    getAssetName: (address: string) => Promise<string>,
    getAssetSymbol: (address: string) => Promise<string>,
    getCollectibleTokenURI: (address: string, tokenId: number) => Promise<string>,
    config?: Partial<BaseConfig>,
    state?: Partial<AssetsState>,
  ) {
    super(config, state);
    this.defaultConfig = {
      networkType: 'mainnet',
      selectedAddress: '',
    };
    this.defaultState = {
      allCollectibleContracts: {},
      allCollectibles: {},
      allTokens: {},
      collectibleContracts: [],
      collectibles: [],
      ignoredCollectibles: [],
      ignoredTokens: [],
      suggestedAssets: [],
      tokens: [],
    };
    this.initialize();
    this.getAssetName = getAssetName;
    this.getAssetSymbol = getAssetSymbol;
    this.getCollectibleTokenURI = getCollectibleTokenURI;
    onPreferencesStateChange(({ selectedAddress }) => {
      const { allCollectibleContracts, allCollectibles, allTokens } = this.state;
      const { networkType } = this.config;
      this.configure({ selectedAddress });
      this.update({
        collectibleContracts:
          (allCollectibleContracts[selectedAddress] && allCollectibleContracts[selectedAddress][networkType]) || [],
        collectibles: (allCollectibles[selectedAddress] && allCollectibles[selectedAddress][networkType]) || [],
        tokens: (allTokens[selectedAddress] && allTokens[selectedAddress][networkType]) || [],
      });
    });
    onNetworkStateChange(({ provider }) => {
      const { allCollectibleContracts, allCollectibles, allTokens } = this.state;
      const { selectedAddress } = this.config;
      const networkType = provider.type;
      this.configure({ networkType });
      this.update({
        collectibleContracts:
          (allCollectibleContracts[selectedAddress] && allCollectibleContracts[selectedAddress][networkType]) || [],
        collectibles: (allCollectibles[selectedAddress] && allCollectibles[selectedAddress][networkType]) || [],
        tokens: (allTokens[selectedAddress] && allTokens[selectedAddress][networkType]) || [],
      });
    });
  }

  /**
   * Sets an OpenSea API key to retrieve collectible information
   *
   * @param openSeaApiKey - OpenSea API key
   */
  setApiKey(openSeaApiKey: string) {
    this.openSeaApiKey = openSeaApiKey;
  }

  /**
   * Adds a token to the stored token list
   *
   * @param address - Hex address of the token contract
   * @param symbol - Symbol of the token
   * @param decimals - Number of decimals the token uses
   * @param image - Image of the token
   * @returns - Current token list
   */
  async addToken(address: string, symbol: string, decimals: number, image?: string): Promise<Token[]> {
    const releaseLock = await this.mutex.acquire();
    try {
      address = toChecksumAddress(address);
      const { allTokens, tokens } = this.state;
      const { networkType, selectedAddress } = this.config;
      const newEntry: Token = { address, symbol, decimals, image };
      const previousEntry = tokens.find((token) => token.address === address);
      if (previousEntry) {
        const previousIndex = tokens.indexOf(previousEntry);
        tokens[previousIndex] = newEntry;
      } else {
        tokens.push(newEntry);
      }
      const addressTokens = allTokens[selectedAddress];
      const newAddressTokens = { ...addressTokens, ...{ [networkType]: tokens } };
      const newAllTokens = { ...allTokens, ...{ [selectedAddress]: newAddressTokens } };
      const newTokens = [...tokens];
      this.update({ allTokens: newAllTokens, tokens: newTokens });
      return newTokens;
    } finally {
      releaseLock();
    }
  }

  /**
   * Adds a batch of tokens to the stored token list
   *
   * @param tokens - Array of Tokens to be added or updated
   * @returns - Current token list
   */
  async addTokens(tokensToAdd: Token[]): Promise<Token[]> {
    const releaseLock = await this.mutex.acquire();
    const { allTokens, tokens } = this.state;
    const { networkType, selectedAddress } = this.config;

    try {
      tokensToAdd.forEach((tokenToAdd) => {
        const { address, symbol, decimals, image } = tokenToAdd;
        const checksumAddress = toChecksumAddress(address);

        const newEntry: Token = { address: checksumAddress, symbol, decimals, image };
        const previousEntry = tokens.find((token) => token.address === checksumAddress);
        if (previousEntry) {
          const previousIndex = tokens.indexOf(previousEntry);
          tokens[previousIndex] = newEntry;
        } else {
          tokens.push(newEntry);
        }
      });

      const addressTokens = allTokens[selectedAddress];
      const newAddressTokens = { ...addressTokens, ...{ [networkType]: tokens } };
      const newAllTokens = { ...allTokens, ...{ [selectedAddress]: newAddressTokens } };
      const newTokens = [...tokens];
      this.update({ allTokens: newAllTokens, tokens: newTokens });
      return newTokens;
    } finally {
      releaseLock();
    }
  }

  /**
   * Adds a new suggestedAsset to state. Parameters will be validated according to
   * asset type being watched. A `<suggestedAssetMeta.id>:pending` hub event will be emitted once added.
   *
   * @param asset - Asset to be watched. For now only ERC20 tokens are accepted.
   * @param type - Asset type
   * @returns - Object containing a promise resolving to the suggestedAsset address if accepted
   */
  async watchAsset(asset: Token, type: string): Promise<AssetSuggestionResult> {
    const suggestedAssetMeta: SuggestedAssetMeta = {
      asset,
      id: random(),
      status: 'pending',
      time: Date.now(),
      type,
    };
    try {
      switch (type) {
        case 'ERC20':
          validateTokenToWatch(asset);
          break;
        default:
          throw new Error(`Asset of type ${type} not supported`);
      }
    } catch (error) {
      this.failSuggestedAsset(suggestedAssetMeta, error);
      return Promise.reject(error);
    }

    const result: Promise<string> = new Promise((resolve, reject) => {
      this.hub.once(`${suggestedAssetMeta.id}:finished`, (meta: SuggestedAssetMeta) => {
        switch (meta.status) {
          case 'accepted':
            return resolve(meta.asset.address);
          case 'rejected':
            return reject(new Error('User rejected to watch the asset.'));
          case 'failed':
            return reject(new Error(meta.error!.message));
        }
      });
    });
    const { suggestedAssets } = this.state;
    suggestedAssets.push(suggestedAssetMeta);
    this.update({ suggestedAssets: [...suggestedAssets] });
    this.hub.emit('pendingSuggestedAsset', suggestedAssetMeta);
    return { result, suggestedAssetMeta };
  }

  /**
   * Accepts to watch an asset and updates it's status and deletes the suggestedAsset from state,
   * adding the asset to corresponding asset state. In this case ERC20 tokens.
   * A `<suggestedAssetMeta.id>:finished` hub event is fired after accepted or failure.
   *
   * @param suggestedAssetID - ID of the suggestedAsset to accept
   * @returns - Promise resolving when this operation completes
   */
  async acceptWatchAsset(suggestedAssetID: string): Promise<void> {
    const { suggestedAssets } = this.state;
    const index = suggestedAssets.findIndex(({ id }) => suggestedAssetID === id);
    const suggestedAssetMeta = suggestedAssets[index];
    try {
      switch (suggestedAssetMeta.type) {
        case 'ERC20':
          const { address, symbol, decimals, image } = suggestedAssetMeta.asset;
          await this.addToken(address, symbol, decimals, image);
          suggestedAssetMeta.status = 'accepted';
          this.hub.emit(`${suggestedAssetMeta.id}:finished`, suggestedAssetMeta);
          break;
        default:
          throw new Error(`Asset of type ${suggestedAssetMeta.type} not supported`);
      }
    } catch (error) {
      this.failSuggestedAsset(suggestedAssetMeta, error);
    }
    const newSuggestedAssets = suggestedAssets.filter(({ id }) => id !== suggestedAssetID);
    this.update({ suggestedAssets: [...newSuggestedAssets] });
  }

  /**
   * Rejects a watchAsset request based on its ID by setting its status to "rejected"
   * and emitting a `<suggestedAssetMeta.id>:finished` hub event.
   *
   * @param suggestedAssetID - ID of the suggestedAsset to accept
   */
  rejectWatchAsset(suggestedAssetID: string) {
    const { suggestedAssets } = this.state;
    const index = suggestedAssets.findIndex(({ id }) => suggestedAssetID === id);
    const suggestedAssetMeta = suggestedAssets[index];
    if (!suggestedAssetMeta) {
      return;
    }
    suggestedAssetMeta.status = 'rejected';
    this.hub.emit(`${suggestedAssetMeta.id}:finished`, suggestedAssetMeta);
    const newSuggestedAssets = suggestedAssets.filter(({ id }) => id !== suggestedAssetID);
    this.update({ suggestedAssets: [...newSuggestedAssets] });
  }

  /**
   * Adds a collectible and respective collectible contract to the stored collectible and collectible contracts lists
   *
   * @param address - Hex address of the collectible contract
   * @param tokenId - The collectible identifier
   * @param opts - Collectible optional information (name, image and description)
   * @param detection? - Whether the collectible is manually added or autodetected
   * @returns - Promise resolving to the current collectible list
   */
  async addCollectible(address: string, tokenId: number, opts?: CollectibleInformation, detection?: boolean) {
    address = toChecksumAddress(address);
    const newCollectibleContracts = await this.addCollectibleContract(address, detection);
    // If collectible contract was not added, do not add individual collectible
    const collectibleContract = newCollectibleContracts.find((contract) => contract.address === address);
    // If collectible contract information, add individual collectible
    if (collectibleContract) {
      await this.addIndividualCollectible(address, tokenId, opts);
    }
  }

  /**
   * Removes a token from the stored token list and saves it in ignored tokens list
   *
   * @param address - Hex address of the token contract
   */
  removeAndIgnoreToken(address: string) {
    address = toChecksumAddress(address);
    const { allTokens, tokens, ignoredTokens } = this.state;
    const { networkType, selectedAddress } = this.config;
    const newIgnoredTokens = [...ignoredTokens];
    const newTokens = tokens.filter((token) => {
      if (token.address === address) {
        const alreadyIgnored = newIgnoredTokens.find((t) => t.address === address);
        !alreadyIgnored && newIgnoredTokens.push(token);
        return false;
      }
      return true;
    });
    const addressTokens = allTokens[selectedAddress];
    const newAddressTokens = { ...addressTokens, ...{ [networkType]: newTokens } };
    const newAllTokens = { ...allTokens, ...{ [selectedAddress]: newAddressTokens } };
    this.update({ allTokens: newAllTokens, tokens: newTokens, ignoredTokens: newIgnoredTokens });
  }

  /**
   * Removes a token from the stored token list
   *
   * @param address - Hex address of the token contract
   */
  removeToken(address: string) {
    address = toChecksumAddress(address);
    const { allTokens, tokens } = this.state;
    const { networkType, selectedAddress } = this.config;
    const newTokens = tokens.filter((token) => token.address !== address);
    const addressTokens = allTokens[selectedAddress];
    const newAddressTokens = { ...addressTokens, ...{ [networkType]: newTokens } };
    const newAllTokens = { ...allTokens, ...{ [selectedAddress]: newAddressTokens } };
    this.update({ allTokens: newAllTokens, tokens: newTokens });
  }

  /**
   * Removes a collectible from the stored token list
   *
   * @param address - Hex address of the collectible contract
   * @param tokenId - Token identifier of the collectible
   */
  removeCollectible(address: string, tokenId: number) {
    address = toChecksumAddress(address);
    this.removeIndividualCollectible(address, tokenId);
    const { collectibles } = this.state;
    const remainingCollectible = collectibles.find((collectible) => collectible.address === address);
    if (!remainingCollectible) {
      this.removeCollectibleContract(address);
    }
  }

  /**
   * Removes a collectible from the stored token list and saves it in ignored collectibles list
   *
   * @param address - Hex address of the collectible contract
   * @param tokenId - Token identifier of the collectible
   */
  removeAndIgnoreCollectible(address: string, tokenId: number) {
    address = toChecksumAddress(address);
    this.removeAndIgnoreIndividualCollectible(address, tokenId);
    const { collectibles } = this.state;
    const remainingCollectible = collectibles.find((collectible) => collectible.address === address);
    if (!remainingCollectible) {
      this.removeCollectibleContract(address);
    }
  }

  /**
   * Removes all tokens from the ignored list
   */
  clearIgnoredTokens() {
    this.update({ ignoredTokens: [] });
  }

  /**
   * Removes all collectibles from the ignored list
   */
  clearIgnoredCollectibles() {
    this.update({ ignoredCollectibles: [] });
  }
}

export default AssetsController;
