import * as sinon from 'sinon';

import { ControllerMessenger } from './ControllerMessenger';

describe('ControllerMessenger', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('should allow registering and calling an action handler', () => {
    type CountAction = { type: 'count'; handler: (increment: number) => void };
    const controllerMessenger = new ControllerMessenger<CountAction, never>();

    let count = 0;
    controllerMessenger.registerActionHandler('count', (increment: number) => {
      count += increment;
    });
    controllerMessenger.call('count', 1);

    expect(count).toEqual(1);
  });

  it('should allow registering and calling multiple different action handlers', () => {
    type MessageAction =
      | { type: 'concat'; handler: (message: string) => void }
      | { type: 'reset'; handler: (initialMessage: string) => void };
    const controllerMessenger = new ControllerMessenger<MessageAction, never>();

    let message = '';
    controllerMessenger.registerActionHandler('reset', (initialMessage: string) => {
      message = initialMessage;
    });
    controllerMessenger.registerActionHandler('concat', (s: string) => {
      message += s;
    });

    controllerMessenger.call('reset', 'hello');
    controllerMessenger.call('concat', ', world');

    expect(message).toEqual('hello, world');
  });

  it('should allow registering and calling an action handler with no parameters', () => {
    type IncrementAction = { type: 'increment'; handler: () => void };
    const controllerMessenger = new ControllerMessenger<IncrementAction, never>();

    let count = 0;
    controllerMessenger.registerActionHandler('increment', () => {
      count += 1;
    });
    controllerMessenger.call('increment');

    expect(count).toEqual(1);
  });

  it('should allow registering and calling an action handler with multiple parameters', () => {
    type MessageAction = { type: 'message'; handler: (to: string, message: string) => void };
    const controllerMessenger = new ControllerMessenger<MessageAction, never>();

    const messages: Record<string, string> = {};
    controllerMessenger.registerActionHandler('message', (to, message) => {
      messages[to] = message;
    });
    controllerMessenger.call('message', '0x123', 'hello');

    expect(messages['0x123']).toEqual('hello');
  });

  it('should allow registering and calling an action handler with a return value', () => {
    type AddAction = { type: 'add'; handler: (a: number, b: number) => number };
    const controllerMessenger = new ControllerMessenger<AddAction, never>();

    controllerMessenger.registerActionHandler('add', (a, b) => {
      return a + b;
    });
    const result = controllerMessenger.call('add', 5, 10);

    expect(result).toEqual(15);
  });

  it('should not allow registering multiple action handlers under the same name', () => {
    type PingAction = { type: 'ping'; handler: () => void };
    const controllerMessenger = new ControllerMessenger<PingAction, never>();

    controllerMessenger.registerActionHandler('ping', () => undefined);

    expect(() => {
      controllerMessenger.registerActionHandler('ping', () => undefined);
    }).toThrow();
  });

  it('should throw when calling unregistered action', () => {
    type PingAction = { type: 'ping'; handler: () => void };
    const controllerMessenger = new ControllerMessenger<PingAction, never>();

    expect(() => {
      controllerMessenger.call('ping');
    }).toThrow();
  });

  it('should throw when calling an action that has been unregistered', () => {
    type PingAction = { type: 'ping'; handler: () => void };
    const controllerMessenger = new ControllerMessenger<PingAction, never>();

    expect(() => {
      controllerMessenger.call('ping');
    }).toThrow();

    let pingCount = 0;
    controllerMessenger.registerActionHandler('ping', () => {
      pingCount += 1;
    });

    controllerMessenger.unregisterActionHandler('ping');

    expect(() => {
      controllerMessenger.call('ping');
    }).toThrow();
    expect(pingCount).toEqual(0);
  });

  it('should throw when calling an action after actions have been reset', () => {
    type PingAction = { type: 'ping'; handler: () => void };
    const controllerMessenger = new ControllerMessenger<PingAction, never>();

    expect(() => {
      controllerMessenger.call('ping');
    }).toThrow();

    let pingCount = 0;
    controllerMessenger.registerActionHandler('ping', () => {
      pingCount += 1;
    });

    controllerMessenger.clearActions();

    expect(() => {
      controllerMessenger.call('ping');
    }).toThrow();
    expect(pingCount).toEqual(0);
  });

  it('should publish event to subscriber', () => {
    type MessageEvent = { type: 'message'; payload: [string] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();

    const handler = sinon.stub();
    controllerMessenger.subscribe('message', handler);
    controllerMessenger.publish('message', 'hello');

    expect(handler.calledWithExactly('hello')).toBeTruthy();
    expect(handler.callCount).toEqual(1);
  });

  it('should allow publishing multiple different events to subscriber', () => {
    type MessageEvent = { type: 'message'; payload: [string] } | { type: 'ping'; payload: [] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();

    const messageHandler = sinon.stub();
    const pingHandler = sinon.stub();
    controllerMessenger.subscribe('message', messageHandler);
    controllerMessenger.subscribe('ping', pingHandler);

    controllerMessenger.publish('message', 'hello');
    controllerMessenger.publish('ping');

    expect(messageHandler.calledWithExactly('hello')).toBeTruthy();
    expect(messageHandler.callCount).toEqual(1);
    expect(pingHandler.calledWithExactly()).toBeTruthy();
    expect(pingHandler.callCount).toEqual(1);
  });

  it('should publish event with no payload to subscriber', () => {
    type PingEvent = { type: 'ping'; payload: [] };
    const controllerMessenger = new ControllerMessenger<never, PingEvent>();

    const handler = sinon.stub();
    controllerMessenger.subscribe('ping', handler);
    controllerMessenger.publish('ping');

    expect(handler.calledWithExactly()).toBeTruthy();
    expect(handler.callCount).toEqual(1);
  });

  it('should publish event with multiple payload parameters to subscriber', () => {
    type MessageEvent = { type: 'message'; payload: [string, string] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();

    const handler = sinon.stub();
    controllerMessenger.subscribe('message', handler);
    controllerMessenger.publish('message', 'hello', 'there');

    expect(handler.calledWithExactly('hello', 'there')).toBeTruthy();
    expect(handler.callCount).toEqual(1);
  });

  it('should publish event once to subscriber even if subscribed multiple times', () => {
    type MessageEvent = { type: 'message'; payload: [string] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();

    const handler = sinon.stub();
    controllerMessenger.subscribe('message', handler);
    controllerMessenger.subscribe('message', handler);
    controllerMessenger.publish('message', 'hello');

    expect(handler.calledWithExactly('hello')).toBeTruthy();
    expect(handler.callCount).toEqual(1);
  });

  it('should publish event to many subscribers', () => {
    type MessageEvent = { type: 'message'; payload: [string] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();

    const handler1 = sinon.stub();
    const handler2 = sinon.stub();
    controllerMessenger.subscribe('message', handler1);
    controllerMessenger.subscribe('message', handler2);
    controllerMessenger.publish('message', 'hello');

    expect(handler1.calledWithExactly('hello')).toBeTruthy();
    expect(handler1.callCount).toEqual(1);
    expect(handler2.calledWithExactly('hello')).toBeTruthy();
    expect(handler2.callCount).toEqual(1);
  });

  it('should not call subscriber after unsubscribing', () => {
    type MessageEvent = { type: 'message'; payload: [string] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();

    const handler = sinon.stub();
    controllerMessenger.subscribe('message', handler);
    controllerMessenger.unsubscribe('message', handler);
    controllerMessenger.publish('message', 'hello');

    expect(handler.callCount).toEqual(0);
  });

  it('should throw when unsubscribing when there are no subscriptions', () => {
    type MessageEvent = { type: 'message'; payload: [string] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();

    const handler = sinon.stub();
    expect(() => controllerMessenger.unsubscribe('message', handler)).toThrow();
  });

  it('should throw when unsubscribing a handler that is not subscribed', () => {
    type MessageEvent = { type: 'message'; payload: [string] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();

    const handler1 = sinon.stub();
    const handler2 = sinon.stub();
    controllerMessenger.subscribe('message', handler1);

    expect(() => controllerMessenger.unsubscribe('message', handler2)).toThrow();
  });

  it('should not call subscriber after clearing event subscriptions', () => {
    type MessageEvent = { type: 'message'; payload: [string] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();

    const handler = sinon.stub();
    controllerMessenger.subscribe('message', handler);
    controllerMessenger.clearEventSubscriptions('message');
    controllerMessenger.publish('message', 'hello');

    expect(handler.callCount).toEqual(0);
  });

  it('should not throw when clearing event that has no subscriptions', () => {
    type MessageEvent = { type: 'message'; payload: [string] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();

    expect(() => controllerMessenger.clearEventSubscriptions('message')).not.toThrow();
  });

  it('should not call subscriber after resetting subscriptions', () => {
    type MessageEvent = { type: 'message'; payload: [string] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();

    const handler = sinon.stub();
    controllerMessenger.subscribe('message', handler);
    controllerMessenger.clearSubscriptions();
    controllerMessenger.publish('message', 'hello');

    expect(handler.callCount).toEqual(0);
  });
});

describe('RestrictedControllerMessenger', () => {
  it('should allow registering and calling an action handler', () => {
    type CountAction = { type: 'CountController:count'; handler: (increment: number) => void };
    const controllerMessenger = new ControllerMessenger<CountAction, never>();
    const restrictedControllerMessenger = controllerMessenger.getRestricted(
      'CountController',
      ['CountController:count'],
      [],
    );

    let count = 0;
    restrictedControllerMessenger.registerActionHandler('CountController:count', (increment: number) => {
      count += increment;
    });
    restrictedControllerMessenger.call('CountController:count', 1);

    expect(count).toEqual(1);
  });

  it('should allow registering and calling multiple different action handlers', () => {
    type MessageAction =
      | { type: 'MessageController:concat'; handler: (message: string) => void }
      | { type: 'MessageController:reset'; handler: (initialMessage: string) => void };
    const controllerMessenger = new ControllerMessenger<MessageAction, never>();
    const restrictedControllerMessenger = controllerMessenger.getRestricted(
      'MessageController',
      ['MessageController:reset', 'MessageController:concat'],
      [],
    );

    let message = '';
    restrictedControllerMessenger.registerActionHandler('MessageController:reset', (initialMessage: string) => {
      message = initialMessage;
    });
    restrictedControllerMessenger.registerActionHandler('MessageController:concat', (s: string) => {
      message += s;
    });

    restrictedControllerMessenger.call('MessageController:reset', 'hello');
    restrictedControllerMessenger.call('MessageController:concat', ', world');

    expect(message).toEqual('hello, world');
  });

  it('should allow registering and calling an action handler with no parameters', () => {
    type IncrementAction = { type: 'CountController:increment'; handler: () => void };
    const controllerMessenger = new ControllerMessenger<IncrementAction, never>();
    const restrictedControllerMessenger = controllerMessenger.getRestricted(
      'CountController',
      ['CountController:increment'],
      [],
    );

    let count = 0;
    restrictedControllerMessenger.registerActionHandler('CountController:increment', () => {
      count += 1;
    });
    restrictedControllerMessenger.call('CountController:increment');

    expect(count).toEqual(1);
  });

  it('should allow registering and calling an action handler with multiple parameters', () => {
    type MessageAction = { type: 'MessageController:message'; handler: (to: string, message: string) => void };
    const controllerMessenger = new ControllerMessenger<MessageAction, never>();
    const restrictedControllerMessenger = controllerMessenger.getRestricted(
      'MessageController',
      ['MessageController:message'],
      [],
    );

    const messages: Record<string, string> = {};
    restrictedControllerMessenger.registerActionHandler('MessageController:message', (to, message) => {
      messages[to] = message;
    });
    restrictedControllerMessenger.call('MessageController:message', '0x123', 'hello');

    expect(messages['0x123']).toEqual('hello');
  });

  it('should allow registering and calling an action handler with a return value', () => {
    type AddAction = { type: 'MathController:add'; handler: (a: number, b: number) => number };
    const controllerMessenger = new ControllerMessenger<AddAction, never>();
    const restrictedControllerMessenger = controllerMessenger.getRestricted(
      'MathController',
      ['MathController:add'],
      [],
    );

    restrictedControllerMessenger.registerActionHandler('MathController:add', (a, b) => {
      return a + b;
    });
    const result = restrictedControllerMessenger.call('MathController:add', 5, 10);

    expect(result).toEqual(15);
  });

  it('should not allow registering multiple action handlers under the same name', () => {
    type CountAction = { type: 'PingController:ping'; handler: () => void };
    const controllerMessenger = new ControllerMessenger<CountAction, never>();
    const restrictedControllerMessenger = controllerMessenger.getRestricted(
      'PingController',
      ['PingController:ping'],
      [],
    );

    restrictedControllerMessenger.registerActionHandler('PingController:ping', () => undefined);

    expect(() => {
      restrictedControllerMessenger.registerActionHandler('PingController:ping', () => undefined);
    }).toThrow();
  });

  it('should throw when calling unregistered action', () => {
    type CountAction = { type: 'PingController:ping'; handler: () => void };
    const controllerMessenger = new ControllerMessenger<CountAction, never>();
    const restrictedControllerMessenger = controllerMessenger.getRestricted(
      'PingController',
      ['PingController:ping'],
      [],
    );

    expect(() => {
      restrictedControllerMessenger.call('PingController:ping');
    }).toThrow();
  });

  it('should throw when calling an action that has been unregistered', () => {
    type PingAction = { type: 'PingController:ping'; handler: () => void };
    const controllerMessenger = new ControllerMessenger<PingAction, never>();
    const restrictedControllerMessenger = controllerMessenger.getRestricted(
      'PingController',
      ['PingController:ping'],
      [],
    );

    expect(() => {
      restrictedControllerMessenger.call('PingController:ping');
    }).toThrow();

    let pingCount = 0;
    restrictedControllerMessenger.registerActionHandler('PingController:ping', () => {
      pingCount += 1;
    });

    restrictedControllerMessenger.unregisterActionHandler('PingController:ping');

    expect(() => {
      restrictedControllerMessenger.call('PingController:ping');
    }).toThrow();
    expect(pingCount).toEqual(0);
  });

  it('should publish event to subscriber', () => {
    type MessageEvent = { type: 'MessageController:message'; payload: [string] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();
    const restrictedControllerMessenger = controllerMessenger.getRestricted(
      'MessageController',
      [],
      ['MessageController:message'],
    );

    const handler = sinon.stub();
    restrictedControllerMessenger.subscribe('MessageController:message', handler);
    restrictedControllerMessenger.publish('MessageController:message', 'hello');

    expect(handler.calledWithExactly('hello')).toBeTruthy();
    expect(handler.callCount).toEqual(1);
  });

  it('should allow publishing multiple different events to subscriber', () => {
    type MessageEvent =
      | { type: 'MessageController:message'; payload: [string] }
      | { type: 'MessageController:ping'; payload: [] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();
    const restrictedControllerMessenger = controllerMessenger.getRestricted(
      'MessageController',
      [],
      ['MessageController:message', 'MessageController:ping'],
    );

    const messageHandler = sinon.stub();
    const pingHandler = sinon.stub();
    restrictedControllerMessenger.subscribe('MessageController:message', messageHandler);
    restrictedControllerMessenger.subscribe('MessageController:ping', pingHandler);

    restrictedControllerMessenger.publish('MessageController:message', 'hello');
    restrictedControllerMessenger.publish('MessageController:ping');

    expect(messageHandler.calledWithExactly('hello')).toBeTruthy();
    expect(messageHandler.callCount).toEqual(1);
    expect(pingHandler.calledWithExactly()).toBeTruthy();
    expect(pingHandler.callCount).toEqual(1);
  });

  it('should publish event with no payload to subscriber', () => {
    type PingEvent = { type: 'PingController:ping'; payload: [] };
    const controllerMessenger = new ControllerMessenger<never, PingEvent>();
    const restrictedControllerMessenger = controllerMessenger.getRestricted(
      'PingController',
      [],
      ['PingController:ping'],
    );

    const handler = sinon.stub();
    restrictedControllerMessenger.subscribe('PingController:ping', handler);
    restrictedControllerMessenger.publish('PingController:ping');

    expect(handler.calledWithExactly()).toBeTruthy();
    expect(handler.callCount).toEqual(1);
  });

  it('should publish event with multiple payload parameters to subscriber', () => {
    type MessageEvent = { type: 'MessageController:message'; payload: [string, string] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();
    const restrictedControllerMessenger = controllerMessenger.getRestricted(
      'MessageController',
      [],
      ['MessageController:message'],
    );

    const handler = sinon.stub();
    restrictedControllerMessenger.subscribe('MessageController:message', handler);
    restrictedControllerMessenger.publish('MessageController:message', 'hello', 'there');

    expect(handler.calledWithExactly('hello', 'there')).toBeTruthy();
    expect(handler.callCount).toEqual(1);
  });

  it('should publish event once to subscriber even if subscribed multiple times', () => {
    type MessageEvent = { type: 'MessageController:message'; payload: [string] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();
    const restrictedControllerMessenger = controllerMessenger.getRestricted(
      'MessageController',
      [],
      ['MessageController:message'],
    );

    const handler = sinon.stub();
    restrictedControllerMessenger.subscribe('MessageController:message', handler);
    restrictedControllerMessenger.subscribe('MessageController:message', handler);
    restrictedControllerMessenger.publish('MessageController:message', 'hello');

    expect(handler.calledWithExactly('hello')).toBeTruthy();
    expect(handler.callCount).toEqual(1);
  });

  it('should publish event to many subscribers', () => {
    type MessageEvent = { type: 'MessageController:message'; payload: [string] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();
    const restrictedControllerMessenger = controllerMessenger.getRestricted(
      'MessageController',
      [],
      ['MessageController:message'],
    );

    const handler1 = sinon.stub();
    const handler2 = sinon.stub();
    restrictedControllerMessenger.subscribe('MessageController:message', handler1);
    restrictedControllerMessenger.subscribe('MessageController:message', handler2);
    restrictedControllerMessenger.publish('MessageController:message', 'hello');

    expect(handler1.calledWithExactly('hello')).toBeTruthy();
    expect(handler1.callCount).toEqual(1);
    expect(handler2.calledWithExactly('hello')).toBeTruthy();
    expect(handler2.callCount).toEqual(1);
  });

  it('should not call subscriber after unsubscribing', () => {
    type MessageEvent = { type: 'MessageController:message'; payload: [string] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();
    const restrictedControllerMessenger = controllerMessenger.getRestricted(
      'MessageController',
      [],
      ['MessageController:message'],
    );

    const handler = sinon.stub();
    restrictedControllerMessenger.subscribe('MessageController:message', handler);
    restrictedControllerMessenger.unsubscribe('MessageController:message', handler);
    restrictedControllerMessenger.publish('MessageController:message', 'hello');

    expect(handler.callCount).toEqual(0);
  });

  it('should throw when unsubscribing when there are no subscriptions', () => {
    type MessageEvent = { type: 'MessageController:message'; payload: [string] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();
    const restrictedControllerMessenger = controllerMessenger.getRestricted(
      'MessageController',
      [],
      ['MessageController:message'],
    );

    const handler = sinon.stub();
    expect(() => restrictedControllerMessenger.unsubscribe('MessageController:message', handler)).toThrow();
  });

  it('should throw when unsubscribing a handler that is not subscribed', () => {
    type MessageEvent = { type: 'MessageController:message'; payload: [string] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();
    const restrictedControllerMessenger = controllerMessenger.getRestricted(
      'MessageController',
      [],
      ['MessageController:message'],
    );

    const handler1 = sinon.stub();
    const handler2 = sinon.stub();
    restrictedControllerMessenger.subscribe('MessageController:message', handler1);

    expect(() => restrictedControllerMessenger.unsubscribe('MessageController:message', handler2)).toThrow();
  });

  it('should not call subscriber after clearing event subscriptions', () => {
    type MessageEvent = { type: 'MessageController:message'; payload: [string] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();
    const restrictedControllerMessenger = controllerMessenger.getRestricted(
      'MessageController',
      [],
      ['MessageController:message'],
    );

    const handler = sinon.stub();
    restrictedControllerMessenger.subscribe('MessageController:message', handler);
    restrictedControllerMessenger.clearEventSubscriptions('MessageController:message');
    restrictedControllerMessenger.publish('MessageController:message', 'hello');

    expect(handler.callCount).toEqual(0);
  });

  it('should not throw when clearing event that has no subscriptions', () => {
    type MessageEvent = { type: 'MessageController:message'; payload: [string] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();
    const restrictedControllerMessenger = controllerMessenger.getRestricted(
      'MessageController',
      [],
      ['MessageController:message'],
    );

    expect(() => restrictedControllerMessenger.clearEventSubscriptions('MessageController:message')).not.toThrow();
  });

  it('should allow calling an external action', () => {
    type CountAction = { type: 'CountController:count'; handler: (increment: number) => void };
    const controllerMessenger = new ControllerMessenger<CountAction, never>();
    const externalRestrictedControllerMessenger = controllerMessenger.getRestricted('CountController', [], []);
    const restrictedControllerMessenger = controllerMessenger.getRestricted(
      'OtherController',
      ['CountController:count'],
      [],
    );

    let count = 0;
    externalRestrictedControllerMessenger.registerActionHandler('CountController:count', (increment: number) => {
      count += increment;
    });
    restrictedControllerMessenger.call('CountController:count', 1);

    expect(count).toEqual(1);
  });

  it('should allow subscribing to an external event', () => {
    type MessageEvent = { type: 'MessageController:message'; payload: [string] };
    const controllerMessenger = new ControllerMessenger<never, MessageEvent>();
    const externalRestrictedControllerMessenger = controllerMessenger.getRestricted('MessageController', [], []);
    const restrictedControllerMessenger = controllerMessenger.getRestricted(
      'OtherController',
      [],
      ['MessageController:message'],
    );

    const handler = sinon.stub();
    restrictedControllerMessenger.subscribe('MessageController:message', handler);
    externalRestrictedControllerMessenger.publish('MessageController:message', 'hello');

    expect(handler.calledWithExactly('hello')).toBeTruthy();
    expect(handler.callCount).toEqual(1);
  });
});
