import { toChecksumAddress } from 'ethereumjs-util';
import BaseController, { BaseConfig, BaseState } from '../BaseController';
import { safelyExecute, handleFetch } from '../util';

import type { AssetsState } from './AssetsController';
import type { CurrencyRateState } from './CurrencyRateController';

/**
 * @type CoinGeckoResponse
 *
 * CoinGecko API response representation
 *
 */
export interface CoinGeckoResponse {
  [address: string]: {
    [currency: string]: number;
  };
}

/**
 * @type Token
 *
 * Token representation
 *
 * @property address - Hex address of the token contract
 * @property decimals - Number of decimals the token uses
 * @property symbol - Symbol of the token
 * @property image - Image of the token, url or bit32 image
 */
export interface Token {
  address: string;
  decimals: number;
  symbol: string;
  image?: string;
  balanceError?: Error | null;
}

/**
 * @type TokenRatesConfig
 *
 * Token rates controller configuration
 *
 * @property interval - Polling interval used to fetch new token rates
 * @property tokens - List of tokens to track exchange rates for
 */
export interface TokenRatesConfig extends BaseConfig {
  interval: number;
  nativeCurrency: string;
  tokens: Token[];
}

/**
 * @type TokenRatesState
 *
 * Token rates controller state
 *
 * @property contractExchangeRates - Hash of token contract addresses to exchange rates
 */
export interface TokenRatesState extends BaseState {
  contractExchangeRates: { [address: string]: number };
}

/**
 * Controller that passively polls on a set interval for token-to-fiat exchange rates
 * for tokens stored in the AssetsController
 */
export class TokenRatesController extends BaseController<TokenRatesConfig, TokenRatesState> {
  private handle?: NodeJS.Timer;

  private tokenList: Token[] = [];

  private getPricingURL(query: string) {
    return `https://api.coingecko.com/api/v3/simple/token_price/ethereum?${query}`;
  }

  /**
   * Name of this controller used during composition
   */
  name = 'TokenRatesController';

  /**
   * Creates a TokenRatesController instance
   *
   * @param config - Initial options used to configure this controller
   * @param state - Initial state to set on this controller
   */
  constructor(
    onAssetStateChange: (listener: (tokenState: AssetsState) => void) => void,
    onCurrencyRateStateChange: (listener: (tokenState: CurrencyRateState) => void) => void,
    config?: Partial<TokenRatesConfig>,
    state?: Partial<TokenRatesState>,
  ) {
    super(config, state);
    this.defaultConfig = {
      disabled: true,
      interval: 180000,
      nativeCurrency: 'eth',
      tokens: [],
    };
    this.defaultState = { contractExchangeRates: {} };
    this.initialize();
    this.configure({ disabled: false }, false, false);
    onAssetStateChange((assetsState) => {
      this.configure({ tokens: assetsState.tokens });
    });
    onCurrencyRateStateChange((currencyRateState) => {
      this.configure({ nativeCurrency: currencyRateState.nativeCurrency });
    });
    this.poll();
  }

  /**
   * Sets a new polling interval
   *
   * @param interval - Polling interval used to fetch new token rates
   */
  async poll(interval?: number): Promise<void> {
    interval && this.configure({ interval }, false, false);
    this.handle && clearTimeout(this.handle);
    await safelyExecute(() => this.updateExchangeRates());
    this.handle = setTimeout(() => {
      this.poll(this.config.interval);
    }, this.config.interval);
  }

  /**
   * Sets a new token list to track prices
   *
   * @param tokens - List of tokens to track exchange rates for
   */
  set tokens(tokens: Token[]) {
    this.tokenList = tokens;
    !this.disabled && safelyExecute(() => this.updateExchangeRates());
  }

  /**
   * Fetches a pairs of token address and native currency
   *
   * @param query - Query according to tokens in tokenList and native currency
   * @returns - Promise resolving to exchange rates for given pairs
   */
  async fetchExchangeRate(query: string): Promise<CoinGeckoResponse> {
    return handleFetch(this.getPricingURL(query));
  }

  /**
   * Updates exchange rates for all tokens
   *
   * @returns Promise resolving when this operation completes
   */
  async updateExchangeRates() {
    if (this.tokenList.length === 0) {
      return;
    }
    const newContractExchangeRates: { [address: string]: number } = {};
    const { nativeCurrency } = this.config;
    const pairs = this.tokenList.map((token) => token.address).join(',');
    const query = `contract_addresses=${pairs}&vs_currencies=${nativeCurrency.toLowerCase()}`;
    const prices = await this.fetchExchangeRate(query);
    this.tokenList.forEach((token) => {
      const address = toChecksumAddress(token.address);
      const price = prices[token.address.toLowerCase()];
      newContractExchangeRates[address] = price ? price[nativeCurrency.toLowerCase()] : 0;
    });
    this.update({ contractExchangeRates: newContractExchangeRates });
  }
}

export default TokenRatesController;
