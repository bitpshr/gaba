import { toChecksumAddress } from 'ethereumjs-util';
import { normalize as normalizeAddress, signTypedData, signTypedData_v4, signTypedDataLegacy } from 'eth-sig-util';
import Wallet, { thirdparty as importers } from 'ethereumjs-wallet';
import BaseController, { BaseConfig, BaseState, Listener } from '../BaseController';
import PreferencesController from '../user/PreferencesController';
import { Transaction } from '../transaction/TransactionController';
import { PersonalMessageParams } from '../message-manager/PersonalMessageManager';
import { TypedMessageParams } from '../message-manager/TypedMessageManager';

const Keyring = require('eth-keyring-controller');
const { Mutex } = require('async-mutex');
const ethUtil = require('ethereumjs-util');

const privates = new WeakMap();

/**
 * Available keyring types
 */
export enum KeyringTypes {
  simple = 'Simple Key Pair',
  hd = 'HD Key Tree',
}

/**
 * @type KeyringObject
 *
 * Keyring object
 *
 * @property type - Keyring type
 * @property accounts - Associated accounts
 * @function getAccounts - Get associated accounts
 */
export interface KeyringObject {
  type: string;
  accounts: string[];
  getAccounts(): string[];
}

/**
 * @type KeyringState
 *
 * Keyring controller state
 *
 * @property vault - Encrypted string representing keyring data
 * @property keyrings - Group of accounts
 */
export interface KeyringState extends BaseState {
  vault?: string;
  keyrings: Keyring[];
}

/**
 * @type KeyringMemState
 *
 * Keyring mem controller state
 *
 * @property isUnlocked - Whether vault is unlocked
 * @property keyringTypes - Account types
 * @property keyrings - Group of accounts
 */
export interface KeyringMemState extends BaseState {
  isUnlocked: boolean;
  keyringTypes: string[];
  keyrings: Keyring[];
}

/**
 * @type KeyringConfig
 *
 * Keyring controller configuration
 *
 * @property encryptor - Keyring encryptor
 */
export interface KeyringConfig extends BaseConfig {
  encryptor?: any;
}

/**
 * @type Keyring
 *
 * Keyring object to return in fullUpdate
 *
 * @property type - Keyring type
 * @property accounts - Associated accounts
 * @property index - Associated index
 */
export interface Keyring {
  accounts: string[];
  type: string;
  index?: number;
}

/**
 * Controller responsible for establishing and managing user identity
 */
export class KeyringController extends BaseController<KeyringConfig, KeyringState> {
  private mutex = new Mutex();

  /**
   * Name of this controller used during composition
   */
  name = 'KeyringController';

  private removeIdentity: PreferencesController['removeIdentity'];

  private syncIdentities: PreferencesController['syncIdentities'];

  private updateIdentities: PreferencesController['updateIdentities'];

  private updateSelectedAddress: PreferencesController['updateSelectedAddress'];

  /**
   * Creates a KeyringController instance
   *
   * @param config - Initial options used to configure this controller
   * @param state - Initial state to set on this controller
   */
  constructor(
    removeIdentity: PreferencesController['removeIdentity'],
    syncIdentities: PreferencesController['syncIdentities'],
    updateIdentities: PreferencesController['updateIdentities'],
    updateSelectedAddress: PreferencesController['updateSelectedAddress'],
    config?: Partial<KeyringConfig>,
    state?: Partial<KeyringState>,
  ) {
    super(config, state);
    privates.set(this, { keyring: new Keyring(Object.assign({ initState: state }, config)) });
    this.defaultState = {
      ...privates.get(this).keyring.store.getState(),
      keyrings: [],
    };
    this.removeIdentity = removeIdentity;
    this.syncIdentities = syncIdentities;
    this.updateIdentities = updateIdentities;
    this.updateSelectedAddress = updateSelectedAddress;
    this.initialize();
    this.fullUpdate();
  }

  /**
   * Adds a new account to the default (first) HD seed phrase keyring
   *
   * @returns - Promise resolving to current state when the account is added
   */
  async addNewAccount(): Promise<KeyringMemState> {
    const primaryKeyring = privates.get(this).keyring.getKeyringsByType('HD Key Tree')[0];
    /* istanbul ignore if */
    if (!primaryKeyring) {
      throw new Error('No HD keyring found');
    }
    const oldAccounts = await privates.get(this).keyring.getAccounts();
    await privates.get(this).keyring.addNewAccount(primaryKeyring);
    const newAccounts = await privates.get(this).keyring.getAccounts();

    await this.verifySeedPhrase();

    this.updateIdentities(newAccounts);
    newAccounts.forEach((selectedAddress: string) => {
      if (!oldAccounts.includes(selectedAddress)) {
        this.updateSelectedAddress(selectedAddress);
      }
    });
    return this.fullUpdate();
  }

  /**
   * Adds a new account to the default (first) HD seed phrase keyring without updating identities in preferences
   *
   * @returns - Promise resolving to current state when the account is added
   */
  async addNewAccountWithoutUpdate(): Promise<KeyringMemState> {
    const primaryKeyring = privates.get(this).keyring.getKeyringsByType('HD Key Tree')[0];
    /* istanbul ignore if */
    if (!primaryKeyring) {
      throw new Error('No HD keyring found');
    }
    await privates.get(this).keyring.addNewAccount(primaryKeyring);
    await this.verifySeedPhrase();
    return this.fullUpdate();
  }

  /**
   * Effectively the same as creating a new keychain then populating it
   * using the given seed phrase
   *
   * @param password - Password to unlock keychain
   * @param seed - Seed phrase to restore keychain
   * @returns - Promise resolving to th restored keychain object
   */
  async createNewVaultAndRestore(password: string, seed: string) {
    const releaseLock = await this.mutex.acquire();
    try {
      this.updateIdentities([]);
      const vault = await privates.get(this).keyring.createNewVaultAndRestore(password, seed);
      this.updateIdentities(await privates.get(this).keyring.getAccounts());
      this.fullUpdate();
      return vault;
    } finally {
      releaseLock();
    }
  }

  /**
   * Create a new primary keychain and wipe any previous keychains
   *
   * @param password - Password to unlock the new vault
   * @returns - Newly-created keychain object
   */
  async createNewVaultAndKeychain(password: string) {
    const releaseLock = await this.mutex.acquire();
    try {
      const vault = await privates.get(this).keyring.createNewVaultAndKeychain(password);
      this.updateIdentities(await privates.get(this).keyring.getAccounts());
      this.fullUpdate();
      return vault;
    } finally {
      releaseLock();
    }
  }

  /**
   * Returns the status of the vault
   *
   * @returns - Boolean returning true if the vault is unlocked
   */
  isUnlocked(): boolean {
    return privates.get(this).keyring.memStore.getState().isUnlocked;
  }

  /**
   * Gets the seed phrase of the HD keyring
   *
   * @param password - Password of the keyring
   * @returns - Promise resolving to the seed phrase
   */
  exportSeedPhrase(password: string) {
    if (privates.get(this).keyring.password === password) {
      return privates.get(this).keyring.keyrings[0].mnemonic;
    }
    throw new Error('Invalid password');
  }

  /**
   * Gets the private key from the keyring controlling an address
   *
   * @param password - Password of the keyring
   * @param address - Address to export
   * @returns - Promise resolving to the private key for an address
   */
  exportAccount(password: string, address: string): Promise<string> {
    if (privates.get(this).keyring.password === password) {
      return privates.get(this).keyring.exportAccount(address);
    }
    throw new Error('Invalid password');
  }

  /**
   * Returns the public addresses of all accounts for the current keyring
   *
   * @returns - A promise resolving to an array of addresses
   */
  getAccounts(): Promise<string[]> {
    return privates.get(this).keyring.getAccounts();
  }

  /**
   * Imports an account with the specified import strategy
   *
   * @param strategy - Import strategy name
   * @param args - Array of arguments to pass to the underlying stategy
   * @returns - Promise resolving to current state when the import is complete
   */
  async importAccountWithStrategy(strategy: string, args: any[]): Promise<KeyringMemState> {
    let privateKey;
    switch (strategy) {
      case 'privateKey':
        const [importedKey] = args;
        if (!importedKey) {
          throw new Error('Cannot import an empty key.');
        }
        const prefixed = ethUtil.addHexPrefix(importedKey);
        if (!ethUtil.isValidPrivate(ethUtil.toBuffer(prefixed))) {
          throw new Error('Cannot import invalid private key.');
        }
        privateKey = ethUtil.stripHexPrefix(prefixed);
        break;
      case 'json':
        let wallet;
        const [input, password] = args;
        try {
          wallet = importers.fromEtherWallet(input, password);
        } catch (e) {
          wallet = wallet || (await Wallet.fromV3(input, password, true));
        }
        privateKey = ethUtil.bufferToHex(wallet.getPrivateKey());
        break;
    }
    const newKeyring = await privates.get(this).keyring.addNewKeyring(KeyringTypes.simple, [privateKey]);
    const accounts = await newKeyring.getAccounts();
    const allAccounts = await privates.get(this).keyring.getAccounts();
    this.updateIdentities(allAccounts);
    this.updateSelectedAddress(accounts[0]);
    return this.fullUpdate();
  }

  /**
   * Removes an account from keyring state
   *
   * @param address - Address of the account to remove
   * @returns - Promise resolving current state when this account removal completes
   */
  async removeAccount(address: string): Promise<KeyringMemState> {
    this.removeIdentity(address);
    await privates.get(this).keyring.removeAccount(address);
    return this.fullUpdate();
  }

  /**
   * Deallocates all secrets and locks the wallet
   *
   * @returns - Promise resolving to current state
   */
  setLocked(): Promise<KeyringMemState> {
    return privates.get(this).keyring.setLocked();
  }

  /**
   * Signs message by calling down into a specific keyring
   *
   * @param messageParams - PersonalMessageParams object to sign
   * @returns - Promise resolving to a signed message string
   */
  signMessage(messageParams: PersonalMessageParams) {
    return privates.get(this).keyring.signMessage(messageParams);
  }

  /**
   * Signs personal message by calling down into a specific keyring
   *
   * @param messageParams - PersonalMessageParams object to sign
   * @returns - Promise resolving to a signed message string
   */
  signPersonalMessage(messageParams: PersonalMessageParams) {
    return privates.get(this).keyring.signPersonalMessage(messageParams);
  }

  /**
   * Signs typed message by calling down into a specific keyring
   *
   * @param messageParams - TypedMessageParams object to sign
   * @param version - Compatibility version EIP712
   * @returns - Promise resolving to a signed message string or an error if any
   */
  async signTypedMessage(messageParams: TypedMessageParams, version: string) {
    try {
      const address = normalizeAddress(messageParams.from);
      const { password } = privates.get(this).keyring;
      const privateKey = await this.exportAccount(password, address);
      const privateKeyBuffer = ethUtil.toBuffer(ethUtil.addHexPrefix(privateKey));
      switch (version) {
        case 'V1':
          // signTypedDataLegacy will throw if the data is invalid.
          return signTypedDataLegacy(privateKeyBuffer, { data: messageParams.data as any });
        case 'V3':
          return signTypedData(privateKeyBuffer, { data: JSON.parse(messageParams.data as string) });
        case 'V4':
          return signTypedData_v4(privateKeyBuffer, {
            data: JSON.parse(messageParams.data as string),
          });
      }
    } catch (error) {
      throw new Error(`Keyring Controller signTypedMessage: ${error}`);
    }
  }

  /**
   * Signs a transaction by calling down into a specific keyring
   *
   * @param transaction - Transaction object to sign
   * @param from - Address to sign from, should be in keychain
   * @returns - Promise resolving to a signed transaction string
   */
  signTransaction(transaction: Transaction, from: string) {
    return privates.get(this).keyring.signTransaction(transaction, from);
  }

  /**
   * Attempts to decrypt the current vault and load its keyrings
   *
   * @param password - Password to unlock the keychain
   * @returns - Promise resolving to the current state
   */
  async submitPassword(password: string): Promise<KeyringMemState> {
    await privates.get(this).keyring.submitPassword(password);
    const accounts = await privates.get(this).keyring.getAccounts();
    await this.syncIdentities(accounts);
    return this.fullUpdate();
  }

  /**
   * Adds new listener to be notified of state changes
   *
   * @param listener - Callback triggered when state changes
   */
  subscribe(listener: Listener<KeyringState>) {
    privates.get(this).keyring.store.subscribe(listener);
  }

  /**
   * Removes existing listener from receiving state changes
   *
   * @param listener - Callback to remove
   * @returns - True if a listener is found and unsubscribed
   */
  unsubscribe(listener: Listener<KeyringState>) {
    return privates.get(this).keyring.store.unsubscribe(listener);
  }

  /**
   * Adds new listener to be notified when the wallet is locked
   *
   * @param listener - Callback triggered when wallet is locked
   * @returns - EventEmitter if listener added
   */
  onLock(listener: () => void) {
    return privates.get(this).keyring.on('lock', listener);
  }

  /**
   * Adds new listener to be notified when the wallet is unlocked
   *
   * @param listener - Callback triggered when wallet is unlocked
   * @returns - EventEmitter if listener added
   */
  onUnlock(listener: () => void) {
    return privates.get(this).keyring.on('unlock', listener);
  }

  /**
   * Verifies the that the seed phrase restores the current keychain's accounts
   *
   * @returns - Promise resolving if the verification succeeds
   */
  async verifySeedPhrase(): Promise<string> {
    const primaryKeyring = privates.get(this).keyring.getKeyringsByType(KeyringTypes.hd)[0];
    /* istanbul ignore if */
    if (!primaryKeyring) {
      throw new Error('No HD keyring found.');
    }

    const seedWords = (await primaryKeyring.serialize()).mnemonic;
    const accounts = await primaryKeyring.getAccounts();
    /* istanbul ignore if */
    if (accounts.length === 0) {
      throw new Error('Cannot verify an empty keyring.');
    }

    const TestKeyringClass = privates.get(this).keyring.getKeyringClassForType(KeyringTypes.hd);
    const testKeyring = new TestKeyringClass({ mnemonic: seedWords, numberOfAccounts: accounts.length });
    const testAccounts = await testKeyring.getAccounts();
    /* istanbul ignore if */
    if (testAccounts.length !== accounts.length) {
      throw new Error('Seed phrase imported incorrect number of accounts.');
    }

    testAccounts.forEach((account: string, i: number) => {
      /* istanbul ignore if */
      if (account.toLowerCase() !== accounts[i].toLowerCase()) {
        throw new Error('Seed phrase imported different accounts.');
      }
    });

    return seedWords;
  }

  /**
   * Update keyrings in state and calls KeyringController fullUpdate method returning current state
   *
   * @returns - Promise resolving to current state
   */
  async fullUpdate(): Promise<KeyringMemState> {
    const keyrings: Keyring[] = await Promise.all<Keyring>(
      privates.get(this).keyring.keyrings.map(
        async (keyring: KeyringObject, index: number): Promise<Keyring> => {
          const keyringAccounts = await keyring.getAccounts();
          const accounts = Array.isArray(keyringAccounts)
            ? keyringAccounts.map((address) => toChecksumAddress(address))
            : /* istanbul ignore next */ [];
          return {
            accounts,
            index,
            type: keyring.type,
          };
        },
      ),
    );
    this.update({ keyrings: [...keyrings] });
    return privates.get(this).keyring.fullUpdate();
  }
}

export default KeyringController;
