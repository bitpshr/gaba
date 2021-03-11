import BaseController, { BaseConfig, BaseState } from '../BaseController';
import { safelyExecute } from '../util';
import type { PreferencesState } from '../user/PreferencesController';
import { Token } from './TokenRatesController';
import type { AssetsState } from './AssetsController';

const { BN } = require('ethereumjs-util');

export { BN };

/**
 * @type TokenBalancesConfig
 *
 * Token balances controller configuration
 *
 * @property interval - Polling interval used to fetch new token balances
 * @property tokens - List of tokens to track balances for
 */
export interface TokenBalancesConfig extends BaseConfig {
  interval: number;
  tokens: Token[];
}

/**
 * @type TokenBalancesState
 *
 * Token balances controller state
 *
 * @property contractBalances - Hash of token contract addresses to balances
 */
export interface TokenBalancesState extends BaseState {
  contractBalances: { [address: string]: typeof BN };
}

/**
 * Controller that passively polls on a set interval token balances
 * for tokens stored in the AssetsController
 */
export class TokenBalancesController extends BaseController<TokenBalancesConfig, TokenBalancesState> {
  private handle?: NodeJS.Timer;

  /**
   * Name of this controller used during composition
   */
  name = 'TokenBalancesController';

  private selectedAddress: string;

  private getBalanceOfAssetContract: (tokenAddress: string, address: string) => Promise<typeof BN>;

  /**
   * Creates a TokenBalancesController instance
   *
   * @param config - Initial options used to configure this controller
   * @param state - Initial state to set on this controller
   */
  constructor(
    onAssetStateChange: (listener: (tokenState: AssetsState) => void) => void,
    onPreferencesStateChange: (listener: (preferencesState: PreferencesState) => void) => void,
    selectedAddress: string,
    getBalanceOfAssetContract: (assetContractAddress: string, address: string) => Promise<typeof BN>,
    config?: Partial<TokenBalancesConfig>,
    state?: Partial<TokenBalancesState>,
  ) {
    super(config, state);
    this.defaultConfig = {
      interval: 180000,
      tokens: [],
    };
    this.defaultState = { contractBalances: {} };
    this.initialize();
    onAssetStateChange(({ tokens }) => {
      this.configure({ tokens });
      this.updateBalances();
    });
    this.selectedAddress = selectedAddress;
    onPreferencesStateChange((preferencesState) => {
      this.selectedAddress = preferencesState.selectedAddress;
    });
    this.getBalanceOfAssetContract = getBalanceOfAssetContract;
    this.poll();
  }

  /**
   * Starts a new polling interval
   *
   * @param interval - Polling interval used to fetch new token balances
   */
  async poll(interval?: number): Promise<void> {
    interval && this.configure({ interval }, false, false);
    this.handle && clearTimeout(this.handle);
    await safelyExecute(() => this.updateBalances());
    this.handle = setTimeout(() => {
      this.poll(this.config.interval);
    }, this.config.interval);
  }

  /**
   * Updates balances for all tokens
   *
   * @returns Promise resolving when this operation completes
   */
  async updateBalances() {
    if (this.disabled) {
      return;
    }
    const { tokens } = this.config;
    const newContractBalances: { [address: string]: typeof BN } = {};
    for (const i in tokens) {
      const { address } = tokens[i];
      try {
        newContractBalances[address] = await this.getBalanceOfAssetContract(address, this.selectedAddress);
        tokens[i].balanceError = null;
      } catch (error) {
        newContractBalances[address] = 0;
        tokens[i].balanceError = error;
      }
    }
    this.update({ contractBalances: newContractBalances });
  }
}

export default TokenBalancesController;
