/**
 * State change callbacks
 */
export type Listener<T> = (state: T) => void;

/**
 * @type BaseConfig
 *
 * Base controller configuration
 *
 * @property disabled - Determines if this controller is enabled
 */
export interface BaseConfig {
  disabled?: boolean;
}

/**
 * @type BaseState
 *
 * Base state representation
 *
 * @property name - Unique name for this controller
 */
export interface BaseState {
  name?: string;
}

/**
 * Controller class that provides configuration, state management, and subscriptions
 */
export class BaseController<C extends BaseConfig, S extends BaseState> {
  /**
   * Default options used to configure this controller
   */
  defaultConfig: C = {} as C;

  /**
   * Default state set on this controller
   */
  defaultState: S = {} as S;

  /**
   * Determines if listeners are notified of state changes
   */
  disabled = false;

  /**
   * Name of this controller used during composition
   */
  name = 'BaseController';

  private readonly initialConfig: C;

  private readonly initialState: S;

  private internalConfig: C = this.defaultConfig;

  private internalState: S = this.defaultState;

  private internalListeners: Listener<S>[] = [];

  /**
   * Creates a BaseController instance. Both initial state and initial
   * configuration options are merged with defaults upon initialization.
   *
   * @param config - Initial options used to configure this controller
   * @param state - Initial state to set on this controller
   */
  constructor(config: Partial<C> = {} as C, state: Partial<S> = {} as S) {
    // Use assign since generics can't be spread: https://git.io/vpRhY
    this.initialState = state as S;
    this.initialConfig = config as C;
  }

  /**
   * Enables the controller. This sets each config option as a member
   * variable on this instance and triggers any defined setters. This
   * also sets initial state and triggers any listeners.
   *
   * @returns - This controller instance
   */
  protected initialize() {
    this.internalState = this.defaultState;
    this.internalConfig = this.defaultConfig;
    this.configure(this.initialConfig);
    this.update(this.initialState);
    return this;
  }

  /**
   * Retrieves current controller configuration options
   *
   * @returns - Current configuration
   */
  get config() {
    return this.internalConfig;
  }

  /**
   * Retrieves current controller state
   *
   * @returns - Current state
   */
  get state() {
    return this.internalState;
  }

  /**
   * Updates controller configuration
   *
   * @param config - New configuration options
   * @param overwrite - Overwrite config instead of merging
   * @param fullUpdate - Boolean that defines if the update is partial or not
   */
  configure(config: Partial<C>, overwrite = false, fullUpdate = true) {
    if (fullUpdate) {
      this.internalConfig = overwrite ? (config as C) : Object.assign(this.internalConfig, config);

      for (const key in this.internalConfig) {
        if (typeof this.internalConfig[key] !== 'undefined') {
          (this as any)[key as string] = this.internalConfig[key];
        }
      }
    } else {
      for (const key in config) {
        /* istanbul ignore else */
        if (typeof this.internalConfig[key] !== 'undefined') {
          this.internalConfig[key] = config[key] as any;
          (this as any)[key as string] = config[key];
        }
      }
    }
  }

  /**
   * Notifies all subscribed listeners of current state
   */
  notify() {
    if (this.disabled) {
      return;
    }
    this.internalListeners.forEach((listener) => {
      listener(this.internalState);
    });
  }

  /**
   * Adds new listener to be notified of state changes
   *
   * @param listener - Callback triggered when state changes
   */
  subscribe(listener: Listener<S>) {
    this.internalListeners.push(listener);
  }

  /**
   * Removes existing listener from receiving state changes
   *
   * @param listener - Callback to remove
   * @returns - True if a listener is found and unsubscribed
   */
  unsubscribe(listener: Listener<S>) {
    const index = this.internalListeners.findIndex((cb) => listener === cb);
    index > -1 && this.internalListeners.splice(index, 1);
    return index > -1;
  }

  /**
   * Updates controller state
   *
   * @param state - New state
   * @param overwrite - Overwrite state instead of merging
   */
  update(state: Partial<S>, overwrite = false) {
    this.internalState = overwrite ? Object.assign({}, state as S) : Object.assign({}, this.internalState, state);
    this.notify();
  }
}

export default BaseController;
