import { stub } from 'sinon';
import AddressBookController from './user/AddressBookController';
import EnsController from './third-party/EnsController';
import ComposableController from './ComposableController';
import PreferencesController from './user/PreferencesController';
import TokenRatesController from './assets/TokenRatesController';
import { AssetsController } from './assets/AssetsController';
import { NetworkController, NetworksChainId } from './network/NetworkController';
import { AssetsContractController } from './assets/AssetsContractController';
import CurrencyRateController from './assets/CurrencyRateController';

describe('ComposableController', () => {
  it('should compose controller state', () => {
    const controller = new ComposableController([
      new AddressBookController(),
      new AssetsController(),
      new AssetsContractController(),
      new EnsController(),
      new CurrencyRateController(),
      new NetworkController(),
      new PreferencesController(),
      new TokenRatesController(),
    ]);
    expect(controller.state).toEqual({
      AddressBookController: { addressBook: {} },
      AssetsContractController: {},
      AssetsController: {
        allCollectibleContracts: {},
        allCollectibles: {},
        allTokens: {},
        collectibleContracts: [],
        collectibles: [],
        ignoredCollectibles: [],
        ignoredTokens: [],
        suggestedAssets: [],
        tokens: [],
      },
      CurrencyRateController: {
        conversionDate: 0,
        conversionRate: 0,
        currentCurrency: 'usd',
        nativeCurrency: 'ETH',
        usdConversionRate: 0,
      },
      EnsController: {
        ensEntries: {},
      },
      NetworkController: {
        network: 'loading',
        provider: { type: 'mainnet', chainId: NetworksChainId.mainnet },
      },
      PreferencesController: {
        featureFlags: {},
        frequentRpcList: [],
        identities: {},
        ipfsGateway: 'https://ipfs.io/ipfs/',
        lostIdentities: {},
        selectedAddress: '',
      },
      TokenRatesController: { contractExchangeRates: {} },
    });
  });

  it('should compose flat controller state', () => {
    const controller = new ComposableController([
      new AddressBookController(),
      new AssetsController(),
      new AssetsContractController(),
      new EnsController(),
      new CurrencyRateController(),
      new NetworkController(),
      new PreferencesController(),
      new TokenRatesController(),
    ]);
    expect(controller.flatState).toEqual({
      addressBook: {},
      allCollectibleContracts: {},
      allCollectibles: {},
      allTokens: {},
      collectibleContracts: [],
      collectibles: [],
      contractExchangeRates: {},
      conversionDate: 0,
      conversionRate: 0,
      currentCurrency: 'usd',
      ensEntries: {},
      featureFlags: {},
      frequentRpcList: [],
      identities: {},
      ignoredCollectibles: [],
      ignoredTokens: [],
      ipfsGateway: 'https://ipfs.io/ipfs/',
      lostIdentities: {},
      nativeCurrency: 'ETH',
      network: 'loading',
      provider: { type: 'mainnet', chainId: NetworksChainId.mainnet },
      selectedAddress: '',
      suggestedAssets: [],
      tokens: [],
      usdConversionRate: 0,
    });
  });

  it('should set initial state', () => {
    const state = {
      AddressBookController: {
        addressBook: [
          {
            1: {
              address: 'bar',
              chainId: '1',
              isEns: false,
              memo: '',
              name: 'foo',
            },
          },
        ],
      },
    };
    const controller = new ComposableController([new AddressBookController()], state);
    expect(controller.state).toEqual(state);
  });

  it('should notify listeners of nested state change', () => {
    const addressBookController = new AddressBookController();
    const controller = new ComposableController([addressBookController]);
    const listener = stub();
    controller.subscribe(listener);
    addressBookController.set('0x32Be343B94f860124dC4fEe278FDCBD38C102D88', 'foo');
    expect(listener.calledOnce).toBe(true);
    expect(listener.getCall(0).args[0]).toEqual({
      AddressBookController: {
        addressBook: {
          1: {
            '0x32Be343B94f860124dC4fEe278FDCBD38C102D88': {
              address: '0x32Be343B94f860124dC4fEe278FDCBD38C102D88',
              chainId: '1',
              isEns: false,
              memo: '',
              name: 'foo',
            },
          },
        },
      },
    });
  });
});
