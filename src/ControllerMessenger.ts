type ActionHandler<Action, ActionType> = (
  ...args: ExtractActionParameters<Action, ActionType>
) => ExtractActionResponse<Action, ActionType>;
type ExtractActionParameters<Action, T> = Action extends { type: T; handler: (...args: infer H) => any } ? H : never;
type ExtractActionResponse<Action, T> = Action extends { type: T; handler: (...args: any) => infer H } ? H : never;

type ExtractEvenHandler<Event, T> = Event extends { type: T; payload: infer P }
  ? P extends any[]
    ? (...payload: P) => void
    : never
  : never;
type ExtractEventPayload<Event, T> = Event extends { type: T; payload: infer P } ? P : never;

type ActionConstraint = { type: string; handler: (...args: any) => unknown };
type EventConstraint = { type: string; payload: unknown[] };

/**
 * A namespaced string
 *
 * This type verifies that the string T is prefixed by the string Name followed by a colon.
 */
export type Namespaced<Name extends string, T> = T extends `${Name}:${string}` ? T : never;

/**
 * A restricted controller messenger.
 *
 * This acts as a wrapper around the controller messenger instance that restricts access to actions
 * and events.
 */
export class RestrictedControllerMessenger<
  N extends string,
  Action extends ActionConstraint,
  Event extends EventConstraint,
  AllowedAction extends string,
  AllowedEvent extends string
> {
  private controllerMessenger: ControllerMessenger<Action, Event>;

  private controllerName: N;

  private allowedActions: AllowedAction[];

  private allowedEvents: AllowedEvent[];

  /**
   * Constructs a restricted controller messenger
   *
   * The provided allowlists grant the ability to call the listed actions and subscribe to the
   * listed events. The "name" provided grants ownership of any actions and events under that
   * namespace. Ownership allows registering actions and publishing events, as well as
   * unregistering actions and clearing event subscriptions.
   *
   * @param options
   * @param options.controllerMessenger - The controller messenger instance that is being wrapped.
   * @param options.name - The name of the thing this messenger will be handed to (e.g. the
   *   controller name). This grants "ownership" of actions and events under this namespace to the
   *   restricted controller messenger returned.
   * @param options.allowedActions - The list of actions that this restricted controller messenger
   *   should be alowed to call.
   * @param options.allowedEvents - The list of events that this restricted controller messenger
   *   should be allowed to subscribe to.
   */
  constructor({
    controllerMessenger,
    name,
    allowedActions,
    allowedEvents,
  }: {
    controllerMessenger: ControllerMessenger<Action, Event>;
    name: N;
    allowedActions: AllowedAction[];
    allowedEvents: AllowedEvent[];
  }) {
    this.controllerMessenger = controllerMessenger;
    this.controllerName = name;
    this.allowedActions = allowedActions;
    this.allowedEvents = allowedEvents;
  }

  /**
   * Register an action handler.
   *
   * This will make the registered function available to call via the `call` method.
   *
   * The action type this handler is registered under *must* be in the current namespace.
   *
   * @param actionType - The action type. This is a unqiue identifier for this action.
   * @param handler- The action handler. This function gets called when the `call` method is
   *   invoked with the given action type.
   * @throws Will throw when a handler has been registered for this action type already.
   */
  registerActionHandler<T extends Namespaced<N, Action['type']>>(action: T, handler: ActionHandler<Action, T>) {
    /* istanbul ignore if */
    if (!action.startsWith(`${this.controllerName}:`)) {
      throw new Error(`Only allowed registering action handlers prefixed by '${this.controllerName}:'`);
    }
    return this.controllerMessenger.registerActionHandler(action, handler);
  }

  /**
   * Unregister an action handler.
   *
   * This will prevent this action from being called.
   *
   * The action type being unregistered *must* be in the current namespace.
   *
   * @param actionType - The action type. This is a unqiue identifier for this action.
   */
  unregisterActionHandler<T extends Namespaced<N, Action['type']>>(action: T) {
    /* istanbul ignore if */
    if (!action.startsWith(`${this.controllerName}:`)) {
      throw new Error(`Only allowed unregistering action handlers prefixed by '${this.controllerName}:'`);
    }
    return this.controllerMessenger.unregisterActionHandler(action);
  }

  /**
   * Call an action.
   *
   * This function will call the action handler corresponding to the given action type, passing
   * along any parameters given.
   *
   * The action type being called must be on the action allowlist.
   *
   * @param actionType - The action type. This is a unqiue identifier for this action.
   * @param params - The action parameters. These must match the type of the parameters of the
   *   registered action handler.
   * @throws Will throw when no handler has been registered for the given type.
   */
  call<T extends AllowedAction>(
    action: T,
    ...params: ExtractActionParameters<Action, T>
  ): ExtractActionResponse<Action, T> {
    /* istanbul ignore if */
    if (!this.allowedActions.includes(action)) {
      throw new Error(`Action missing from allow list: ${action}`);
    }
    return this.controllerMessenger.call(action, ...params);
  }

  /**
   * Publish an event.
   *
   * Publishes the given payload to all subscribers of the given event type.
   *
   * The event type being published *must* be in the current namespace.
   *
   * @param eventType - The event type. This is a unique identifier for this event.
   * @param payload - The event payload. The type of the parameters for each event handler must
   *   match the type of this payload.
   */
  publish<E extends Namespaced<N, Event['type']>>(event: E, ...payload: ExtractEventPayload<Event, E>) {
    /* istanbul ignore if */
    if (!event.startsWith(`${this.controllerName}:`)) {
      throw new Error(`Only allowed publishing events prefixed by '${this.controllerName}:'`);
    }
    return this.controllerMessenger.publish(event, ...payload);
  }

  /**
   * Subscribe to an event.
   *
   * Registers the given function as an event handler for the given event type.
   *
   * The event type being subscribed to must be on the event allowlist.
   *
   * @param eventType - The event type. This is a unique identifier for this event.
   * @param handler - The event handler. The type of the parameters for this event handler must
   *   match the type of the payload for this event type.
   */
  subscribe<E extends AllowedEvent>(event: E, handler: ExtractEvenHandler<Event, E>) {
    /* istanbul ignore if */
    if (!this.allowedEvents.includes(event)) {
      throw new Error(`Event missing from allow list: ${event}`);
    }
    return this.controllerMessenger.subscribe(event, handler);
  }

  /**
   * Unsubscribe from an event.
   *
   * Unregisters the given function as an event handler for the given event.
   *
   * The event type being unsubscribed to must be on the event allowlist.
   *
   * @param eventType - The event type. This is a unique identifier for this event.
   * @param handler - The event handler to unregister.
   * @throws Will throw when the given event handler is not registered for this event.
   */
  unsubscribe<E extends AllowedEvent>(event: E, handler: ExtractEvenHandler<Event, E>) {
    /* istanbul ignore if */
    if (!this.allowedEvents.includes(event)) {
      throw new Error(`Event missing from allow list: ${event}`);
    }
    return this.controllerMessenger.unsubscribe(event, handler);
  }

  /**
   * Clear subscriptions for a specific event.
   *
   * This will remove all subscribed handlers for this event.
   *
   * The event type being cleared *must* be in the current namespace.
   *
   * @param eventType - The event type. This is a unique identifier for this event.
   */
  clearEventSubscriptions<E extends Namespaced<N, Event['type']>>(event: E) {
    /* istanbul ignore if */
    if (!event.startsWith(`${this.controllerName}:`)) {
      throw new Error(`Only allowed clearing events prefixed by '${this.controllerName}:'`);
    }
    return this.controllerMessenger.clearEventSubscriptions(event);
  }
}

/**
 * A messaging system for controllers.
 *
 * The controller messenger allows registering functions as 'actions' that can be called elsewhere,
 * and it allows publishing and subscribing to events. Both actions and events are identified by
 * unique strings.
 */
export class ControllerMessenger<Action extends ActionConstraint, Event extends EventConstraint> {
  private actions = new Map<Action['type'], unknown>();

  private events = new Map<Event['type'], Set<unknown>>();

  /**
   * Register an action handler.
   *
   * This will make the registered function available to call via the `call` method.
   *
   * @param actionType - The action type. This is a unqiue identifier for this action.
   * @param handler- The action handler. This function gets called when the `call` method is
   *   invoked with the given action type.
   * @throws Will throw when a handler has been registered for this action type already.
   */
  registerActionHandler<T extends Action['type']>(actionType: T, handler: ActionHandler<Action, T>) {
    if (this.actions.has(actionType)) {
      throw new Error(`A handler for ${actionType} has already been registered`);
    }
    this.actions.set(actionType, handler);
  }

  /**
   * Unregister an action handler.
   *
   * This will prevent this action from being called.
   *
   * @param actionType - The action type. This is a unqiue identifier for this action.
   */
  unregisterActionHandler<T extends Action['type']>(actionType: T) {
    this.actions.delete(actionType);
  }

  /**
   * Unregister all action handlers.
   *
   * This prevents all actions from being called.
   */
  clearActions() {
    this.actions.clear();
  }

  /**
   * Call an action.
   *
   * This function will call the action handler corresponding to the given action type, passing
   * along any parameters given.
   *
   * @param actionType - The action type. This is a unqiue identifier for this action.
   * @param params - The action parameters. These must match the type of the parameters of the
   *   registered action handler.
   * @throws Will throw when no handler has been registered for the given type.
   */
  call<T extends Action['type']>(
    actionType: T,
    ...params: ExtractActionParameters<Action, T>
  ): ExtractActionResponse<Action, T> {
    const handler = this.actions.get(actionType) as ActionHandler<Action, T>;
    if (!handler) {
      throw new Error(`A handler for ${actionType} has not been registered`);
    }
    return handler(...params);
  }

  /**
   * Publish an event.
   *
   * Publishes the given payload to all subscribers of the given event type.
   *
   * @param eventType - The event type. This is a unique identifier for this event.
   * @param payload - The event payload. The type of the parameters for each event handler must
   *   match the type of this payload.
   */
  publish<E extends Event['type']>(eventType: E, ...payload: ExtractEventPayload<Event, E>) {
    const subscribers = this.events.get(eventType) as Set<ExtractEvenHandler<Event, E>>;

    if (subscribers) {
      for (const eventHandler of subscribers) {
        eventHandler(...payload);
      }
    }
  }

  /**
   * Subscribe to an event.
   *
   * Registers the given function as an event handler for the given event type.
   *
   * @param eventType - The event type. This is a unique identifier for this event.
   * @param handler - The event handler. The type of the parameters for this event handler must
   *   match the type of the payload for this event type.
   */
  subscribe<E extends Event['type']>(eventType: E, handler: ExtractEvenHandler<Event, E>) {
    let subscribers = this.events.get(eventType);
    if (!subscribers) {
      subscribers = new Set();
    }
    subscribers.add(handler);
    this.events.set(eventType, subscribers);
  }

  /**
   * Unsubscribe from an event.
   *
   * Unregisters the given function as an event handler for the given event.
   *
   * @param eventType - The event type. This is a unique identifier for this event.
   * @param handler - The event handler to unregister.
   * @throws Will throw when the given event handler is not registered for this event.
   */
  unsubscribe<E extends Event['type']>(eventType: E, handler: ExtractEvenHandler<Event, E>) {
    const subscribers = this.events.get(eventType);

    if (!subscribers || !subscribers.has(handler)) {
      throw new Error(`Subscription not found for event: '${eventType}'`);
    }

    subscribers.delete(handler);
    this.events.set(eventType, subscribers);
  }

  /**
   * Clear subscriptions for a specific event.
   *
   * This will remove all subscribed handlers for this event.
   *
   * @param eventType - The event type. This is a unique identifier for this event.
   */
  clearEventSubscriptions<E extends Event['type']>(eventType: E) {
    this.events.delete(eventType);
  }

  /**
   * Clear all subscriptions.
   *
   * This will remove all subscribed handlers for all events.
   */
  clearSubscriptions() {
    this.events.clear();
  }

  /**
   * Get a restricted controller messenger
   *
   * Returns a wrapper around the controller messenger instance that restricts access to actions
   * and events. The provided allowlists grant the ability to call the listed actions and subscribe
   * to the listed events. The "name" provided grants ownership of any actions and events under
   * that namespace. Ownership allows registering actions and publishing events, as well as
   * unregistering actions and clearing event subscriptions.
   *
   * @param options
   * @param options.name - The name of the thing this messenger will be handed to (e.g. the
   *   controller name). This grants "ownership" of actions and events under this namespace to the
   *   restricted controller messenger returned.
   * @param options.allowedActions - The list of actions that this restricted controller messenger
   *   should be alowed to call.
   * @param options.allowedEvents - The list of events that this restricted controller messenger
   *   should be allowed to subscribe to.
   */
  getRestricted<N extends string, AllowedAction extends string, AllowedEvent extends string>({
    name,
    allowedActions,
    allowedEvents,
  }: {
    name: N;
    allowedActions: Extract<Action['type'], AllowedAction>[] | [];
    allowedEvents: Extract<Event['type'], AllowedEvent>[] | [];
  }) {
    return new RestrictedControllerMessenger<N, Action, Event, AllowedAction, AllowedEvent>({
      controllerMessenger: this,
      name,
      allowedActions,
      allowedEvents,
    });
  }
}
