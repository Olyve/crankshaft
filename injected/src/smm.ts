import { AppPropertiesMenu } from './app-properties-menu';
import { GamepadHandler } from './gamepad';
import { ButtonInterceptors } from './gamepad/button-interceptors';
import { InGameMenu } from './in-game-menu';
import { MenuManager } from './menu-manager';
import { Apps } from './services/apps';
import { Exec } from './services/exec';
import { FS } from './services/fs';
import { Inject } from './services/inject';
import { IPC } from './services/ipc';
import { Network } from './services/network';
import { Patch } from './services/patch';
import { Plugins } from './services/plugins';
import { Store } from './services/store';
import { Toast } from './services/toast';
import { UI } from './services/ui';
import { AppPropsApp } from './types/global';
import { info } from './util';

type PluginId = string;

type AddEventListenerArgs = Parameters<EventTarget['addEventListener']>;

// TODO: there's probably a better way to do these EventTarget types

type SMMEventType =
  | typeof eventTypeSwitchToUnknownPage
  | typeof eventTypeSwitchToHome
  | typeof eventTypeSwitchToCollections
  | typeof eventTypeSwitchToAppDetails
  | typeof eventTypeSwitchToAppProperties
  | typeof eventTypeLockScreenOpened
  | typeof eventTypeLockScreenClosed;

type SMMEvent =
  | EventSwitchToUnknownPage
  | EventSwitchToHome
  | EventSwitchToCollections
  | EventSwitchToAppDetails
  | EventSwitchToAppProperties
  | EventLockScreenOpened
  | EventLockScreenClosed;

const eventTypeSwitchToUnknownPage = 'switchToUnknownPage' as const;
class EventSwitchToUnknownPage extends CustomEvent<void> {
  constructor() {
    super(eventTypeSwitchToUnknownPage);
  }
}

const eventTypeSwitchToHome = 'switchToHome' as const;
class EventSwitchToHome extends CustomEvent<void> {
  constructor() {
    super(eventTypeSwitchToHome);
  }
}

const eventTypeSwitchToCollections = 'switchToCollections' as const;
class EventSwitchToCollections extends CustomEvent<void> {
  constructor() {
    super(eventTypeSwitchToCollections);
  }
}

const eventTypeSwitchToAppDetails = 'switchToAppDetails' as const;
type eventDetailsSwitchToAppDetails = { appId: string; appName: string };
class EventSwitchToAppDetails extends CustomEvent<eventDetailsSwitchToAppDetails> {
  constructor(detail: eventDetailsSwitchToAppDetails) {
    super(eventTypeSwitchToAppDetails, { detail });
  }
}

const eventTypeSwitchToAppProperties = 'switchToAppProperties' as const;
class EventSwitchToAppProperties extends CustomEvent<AppPropsApp> {
  constructor(detail: AppPropsApp) {
    super(eventTypeSwitchToAppProperties, { detail });
  }
}

const eventTypeLockScreenOpened = 'lockScreenOpened' as const;
class EventLockScreenOpened extends CustomEvent<void> {
  constructor() {
    super(eventTypeLockScreenOpened);
  }
}

const eventTypeLockScreenClosed = 'lockScreenClosed' as const;
class EventLockScreenClosed extends CustomEvent<void> {
  constructor() {
    super(eventTypeLockScreenClosed);
  }
}

/**
 * @public
 */
export type Entry = 'library' | 'menu' | 'quickAccess' | 'appProperties';

/**
 * @public
 */
export class SMM extends EventTarget {
  readonly entry: Entry;

  private _currentTab?: 'home' | 'collections' | 'appDetails';
  private _currentAppId?: string;
  private _currentAppName?: string;
  private _onLockScreen: boolean;

  readonly Network: Network;
  readonly Toast: Toast;
  // TODO: improve types for running in context without menu
  readonly MenuManager!: MenuManager;
  readonly InGameMenu!: InGameMenu;
  readonly AppPropertiesMenu!: AppPropertiesMenu;
  readonly FS: FS;
  readonly Plugins: Plugins;
  readonly IPC: IPC;
  readonly UI: UI;
  readonly Exec: Exec;
  readonly Inject: Inject;
  readonly Store: Store;
  readonly ButtonInterceptors: ButtonInterceptors;
  readonly Apps: Apps;
  readonly Patch: Patch;

  readonly serverPort: string;

  // The current plugin that we're loading
  // This is set before calling a plugin's load method, so that we can keep
  // track of which events the plugin attaches, and remove them when we unload
  // that plugin.
  private currentPlugin?: string;
  // Events attached by plugins
  private attachedEvents: Record<
    PluginId,
    {
      type: AddEventListenerArgs[0];
      callback: AddEventListenerArgs[1];
      options: AddEventListenerArgs[2];
    }[]
  >;

  constructor(entry: Entry) {
    super();

    this.entry = entry;

    this._currentTab = undefined;
    this._currentAppId = undefined;
    this._currentAppName = undefined;
    this._onLockScreen = false;

    this.Network = new Network(this);
    this.Toast = new Toast(this);
    this.FS = new FS(this);
    this.IPC = new IPC(this);
    this.Plugins = new Plugins(this);
    this.UI = new UI(this);
    this.Exec = new Exec(this);
    this.Inject = new Inject(this);
    this.Store = new Store(this);
    this.ButtonInterceptors = new ButtonInterceptors(this);
    this.Apps = new Apps(this);
    this.Patch = new Patch(this);

    if (entry === 'library') {
      this.MenuManager = new MenuManager(this);
    }

    if (entry === 'library' || entry === 'quickAccess') {
      this.InGameMenu = new InGameMenu(this);
    }

    if (
      entry === 'library' ||
      (window.smmUIMode === 'desktop' && entry === 'appProperties')
    ) {
      this.AppPropertiesMenu = new AppPropertiesMenu(this);
    }

    this.serverPort = window.smmServerPort;

    this.attachedEvents = {};
  }

  get currentTab() {
    return this._currentTab;
  }

  get currentAppId() {
    return this._currentAppId;
  }

  get onLockScreen() {
    return this._onLockScreen;
  }

  /**
   * @internal
   */
  switchToUnknownPage() {
    if (typeof this._currentTab === 'undefined') {
      return;
    }

    info('Switched to unknown page');
    this._currentTab = undefined;
    this._currentAppId = undefined;
    this.dispatchEvent(new EventSwitchToUnknownPage());
  }

  /**
   * @internal
   */
  switchToHome() {
    if (this._currentTab === 'home') {
      return;
    }

    info('Switched to home');
    this._currentTab = 'home';
    this._currentAppId = undefined;
    this.dispatchEvent(new EventSwitchToHome());
  }

  /**
   * @internal
   */
  switchToCollections() {
    if (this._currentTab === 'collections') {
      return;
    }

    info('Switched to collections');
    this._currentTab = 'collections';
    this._currentAppId = undefined;
    this.dispatchEvent(new EventSwitchToCollections());
  }

  /**
   * @internal
   */
  switchToAppDetails(appId: string, appName: string) {
    if (this._currentTab === 'appDetails' && this._currentAppId === appId) {
      return;
    }

    info('Switched to app details for app', appId);
    this._currentTab = 'appDetails';
    this._currentAppId = appId;
    this._currentAppName = appName;
    this.dispatchEvent(new EventSwitchToAppDetails({ appId, appName }));
  }

  /**
   * @internal
   */
  switchToAppProperties(app: AppPropsApp, title: string) {
    info('Switched to app properties for app', app.appid);

    /*
      In desktop mode, the app properties dialog is in a different context, so
      we inject Crankshaft into it and dispatch the event from that instance.

      In Deck mode, the app properties menu is in the same context, so we
      dispatch the event here directly.
    */

    if (window.smmUIMode === 'desktop' && this.entry !== 'appProperties') {
      this.Inject.injectAppProperties(app, title);
      return;
    }

    this.dispatchEvent(new EventSwitchToAppProperties(app));
  }

  /**
   * @internal
   */
  lockScreenOpened() {
    if (this._onLockScreen) {
      return;
    }

    info('Lock screen opened');
    this._onLockScreen = true;
    this.dispatchEvent(new EventLockScreenOpened());
  }

  /**
   * @internal
   */
  lockScreenClosed() {
    if (!this._onLockScreen) {
      return;
    }

    info('Lock screen closed');
    this._onLockScreen = false;
    this.dispatchEvent(new EventLockScreenClosed());
  }

  /**
   * @internal
   */
  async loadPlugins() {
    info('Loading plugins...');

    // Inject plugins
    // TODO: this will inject plugins into all contexts, but we don't know if
    // other contexts have loaded yet
    try {
      await new Promise<void>((resolve) => {
        // This will be called once the server has loaded plugins
        window.csPluginsLoaded = resolve;

        info('Calling InjectService.InjectPlugins...');
        this.Plugins.injectPlugins(this.entry);
      });
    } catch (err) {
      this.Toast.addToast(`Error injecting plugins: ${err}`, 'error');
    }

    const plugins = await this.Plugins.list();

    info('loadPlugins: ', { plugins, smmPlugins: window.smmPlugins });

    // It's probably better to load these sequentially
    for (const [name, { load, unload }] of Object.entries(
      window.smmPlugins ?? {}
    )) {
      if (plugins[name]?.enabled) {
        await this.loadPlugin(name);
      }
    }
  }

  /**
   * @internal
   */
  async loadPlugin(pluginId: PluginId) {
    await this.unloadPlugin(pluginId);

    if (!window.smmPlugins?.[pluginId]) {
      return;
    }

    info(`Loading plugin ${name}...`);
    this.currentPlugin = pluginId;
    await window.smmPlugins[pluginId].load(this);
    this.currentPlugin = undefined;
  }

  /**
   * @internal
   */
  async unloadPlugin(pluginId: PluginId) {
    if (!window.smmPlugins) {
      return;
    }

    info(`Unloading plugin ${pluginId}...`);
    await window.smmPlugins[pluginId]?.unload?.(this);

    if (this.attachedEvents[pluginId]) {
      for (const { type, callback, options } of this.attachedEvents[pluginId]) {
        this.removeEventListener(type, callback, options);
      }
      delete this.attachedEvents[pluginId];
    }
  }

  addEventListener(
    type: SMMEventType,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void {
    if (this.currentPlugin) {
      if (!this.attachedEvents[this.currentPlugin]) {
        this.attachedEvents[this.currentPlugin] = [];
      }

      this.attachedEvents[this.currentPlugin].push({ type, callback, options });
    }

    super.addEventListener(type, callback, options);
  }

  dispatchEvent(event: SMMEvent): boolean {
    return super.dispatchEvent(event);
  }

  /**
   * Close plugin page if a page is open
   * @internal
   */
  closeActivePluginPage() {
    this.MenuManager.closeActivePage();
  }

  // Currently active gamepad handler
  // This should only be set by internal Crankshaft code
  private _activeGamepadHandler?: GamepadHandler;

  public get activeGamepadHandler() {
    return this._activeGamepadHandler;
  }

  /**
   * @internal
   */
  _setActiveGamepadHandler(gamepadHandler: GamepadHandler | undefined) {
    this._activeGamepadHandler = gamepadHandler;
  }
}
