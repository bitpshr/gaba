import BaseController from './BaseController';

/**
 * List of child controller instances
 */
export type ControllerList = BaseController<any, any>[];

/**
 * Controller that can be used to compose multiple controllers together
 */
export class ComposableController extends BaseController<never, any> {
  private controllers: ControllerList = [];

  /**
   * Name of this controller used during composition
   */
  name = 'ComposableController';

  /**
   * Creates a ComposableController instance
   *
   * @param controllers - Map of names to controller instances
   * @param initialState - Initial state keyed by child controller name
   */
  constructor(controllers: ControllerList = []) {
    super(
      undefined,
      Object.entries(controllers).reduce((state, [name, controller]) => {
        state[name] = controller.state;
        return state;
      }, {} as any),
    );
    this.initialize();
    this.controllers = controllers;
    this.controllers.forEach((controller) => {
      const { name } = controller;
      controller.subscribe((state) => {
        this.update({ [name]: state });
      });
    });
  }

  /**
   * Flat state representation, one that isn't keyed
   * of controller name. Instead, all child controller state is merged
   * together into a single, flat object.
   *
   * @returns - Merged state representation of all child controllers
   */
  get flatState() {
    let flatState = {};
    for (const [name, controller] of Object.entries(this.controllers)) {
      flatState = { ...flatState, [name]: controller.state };
    }
    return flatState;
  }
}

export default ComposableController;
