'use strict';

var EventEmitter = require('events').EventEmitter;
var Promise = require('bluebird');

/** A client-side router for `stateful-controller` using the history API
 * @module stateful-controller-browser-router
 * @author Joris van der Wel <joris@jorisvanderwel.com>
 */

/** Construct a new router
 *
 * @constructor
 * @augments EventEmitter
 * @alias module:stateful-controller-browser-router
 * @param {!Window} window The window containing your DOM Document. In the browser you should simple pass `window` here
 * @param {!URLStateMap} urlStateMap An object implementing two functions: `toURL(StateList) -> string` and `fromURL(string) -> StateList`
 * @param {!module:stateful-controller/lib/Controller} frontController The controller to trigger transitions on. This is the ancestor of all your other controllers.
 */
function Router(window, urlStateMap, frontController)
{
        EventEmitter.call(this);
        this.window = window;
        this.urlStateMap = urlStateMap;
        this.frontController = frontController;
        this.currentStateList = null;

        this._pendingTransitionPromise = null;
        this._pendingReplace = null;
        this._initialHistoryState = null;
        this._queue = {
                hasEntry: false,
                stateList: null,
                fromHistory: false,
                upgrade: false,
                push: false,
                promise: null,
                resolve: null,
                reject: null
        };

        if (!window || !urlStateMap || !frontController)
        {
                throw Error('Missing argument');
        }

        if (typeof this.urlStateMap.toURL !== 'function' ||
            typeof this.urlStateMap.fromURL !== 'function')
        {
                throw Error('Argument `urlStateMap` must implement toURL(states) and fromURL(url)');
        }

        if (!this.window.history ||
            typeof this.window.history.pushState !== 'function' ||
            typeof this.window.history.replaceState !== 'function')
        {
                throw Error('Argument `window` does not support the history API');
        }

        if (this.frontController.isStatefulController1 !== true)
        {
                throw Error('Argument `frontController` is not a stateful-controller');
        }

        this._onpopstate = this._onpopstate.bind(this);
}

module.exports = Router;
require('inherits')(Router, EventEmitter);

/** The current list of states that the controllers are in.
 * During a state transition, this value represents the state that we are transitioning from.
 * @member {?ControllerStateList} currentStateList
 * @memberOf module:stateful-controller-browser-router
 * @instance
 */

/**
 * Fired when the initial state is being upgraded
 *
 * @event module:stateful-controller-browser-router#upgradeInitialState
 * @param {!ControllerStateList} stateList
 * @param {String} url
 * @param {!Promise} promise Resolves when this transition is complete
 *
 */

/**
 * Fired when the popstate event is triggering a state transition in this router.
 *
 * @event module:stateful-controller-browser-router#historyPopState
 * @param {!ControllerStateList} stateList
 * @param {String} url
 * @param {!Promise} promise Resolves when this transition is complete
 *
 */

/**
 * Fired when a transition has completed
 *
 * @event module:stateful-controller-browser-router#transitionComplete
 * @param {!ControllerStateList} stateList
 * @param {String} url
 *
 */

 * Start listening for popstate events (e.g. the user uses the back button)
 */
Router.prototype.attachPopStateListener = function()
{
        this.window.addEventListener('popstate', this._onpopstate);

        if (!this._initialHistoryState)
        {
                this._saveStateAsInitial();
        }
};


/**
 * Determine the current state of the page (by looking at `history.state` or `location`)
 * and send an "upgrade" state transition to the front controller.
 * This method should be called if the server has sent you a html document of a specific state list that you would like to wrap.
 * @returns {!Promise} Resolves when the state transition of the front controller is done.
 * @fires module:stateful-controller-browser-router#upgradeInitialState
 */
Router.prototype.upgradeInitialState = function()
{
        this._saveStateAsInitial();
        return this._handleHistoryState(this._initialHistoryState, true, 'upgradeInitialState');
};

/**
 * Trigger a state transition to the given stateList using the front controller.
 *
 * @param {!ControllerStateList} stateList
 * @param {Boolean} [pushHistory=true] If this value is `true`, a new entry will be
 *                  added to the browser history
 * @return {!Promise} Resolves when the state transition of the front controller is done.
 *         If a state transition is pending, this promise will reject.
 * @fires module:stateful-controller-browser-router#transitionComplete
 */
Router.prototype.enterStates = Promise.method(function enterStates(stateList, pushHistory)
{
        if (pushHistory === void 123)
        {
                pushHistory = true;
        }

        if (this.pending)
        {
                throw Error('A previous state transition is still pending');
        }

        this._pendingTransitionPromise = this.frontController.state(stateList)
        .bind(this)
        .then(function()
        {
                this.currentStateList = this._pendingReplace || stateList;
                var url = this._pushHistoryState(this.currentStateList, pushHistory);
                this.emit('transitionComplete', stateList, url);
        })
        .finally(function()
        {
                this._pendingReplace = null;
                this._pendingTransitionPromise = null;
                this._doQueuedTransition();
        }).return(null);

        return this._pendingTransitionPromise;
});

/**
 * Trigger a state transition to the given stateList using the front controller.
 * If a state transition is currently in progress (see the `pending` attribute), the new state
 * transition will be deferred until the previous one is complete.
 * If there already is a state transition queued, the `stateList` given in this method call will
 * overwrite the previously queued transition. (in other words, the queue has a max size of one).
 *
 * This method is most useful when responding to user input. If a user rapidly clicks on different
 * buttons, only the last one he clicked on should be the state he ends up with. There is no need to
 * go through all the transitions in between.
 *
 * @param {!ControllerStateList} stateList
 * @param {Boolean} [pushHistory=true] If this value is `true`, a new entry will be
 *                  added to the browser history
 * @return {!Promise} Resolves when the state transition of the front controller is done
 * @fires module:stateful-controller-browser-router#transitionComplete
 */
Router.prototype.queueEnterStates = function(stateList, pushHistory)
{
        if (pushHistory === void 123)
        {
                pushHistory = true;
        }

        if (this.pending)
        {
                return this._addToQueue(stateList, false, false, pushHistory);
        }
        else
        {
                return this.enterStates(stateList, pushHistory);
        }
};

/**
 * This method does not perform a state transition, it only sets a new URL for the current state.
 * @param {!ControllerStateList} stateList
 */
Router.prototype.replaceStateList = function(stateList)
{
        if (this.pending)
        {
                this._pendingReplace = stateList;
        }
        else
        {
                this.currentStateList = stateList;
                this._pushHistoryState(this.currentStateList, false);
        }
};

/** Is there a state transition currently pending?
 * @member {!boolean} pending
 * @memberOf module:stateful-controller-browser-router
 * @instance
 */
Object.defineProperty(Router.prototype, 'pending', {
        get: function()
        {
                return !!this._pendingTransitionPromise;
        }
});


Router.prototype._saveStateAsInitial = function()
{
        var history = this.window.history;
        if (history.state && history.state.statefulControllerRouterUrl)
        {
                this._initialHistoryState = history.state;
        }
        else
        {
                var path = this.window.location.pathname + this.window.location.search;
                this._initialHistoryState = this._urlToHistoryState(path);
        }
};

Router.prototype._addToQueue = function(stateList, fromHistory, upgrade, push)
{
        // only one entry in the queue
        this._queue.hasEntry = true;
        this._queue.stateList = stateList;
        this._queue.fromHistory = fromHistory;
        this._queue.upgrade = !!upgrade;
        this._queue.push = !!push;

        if (!this._queue.promise)
        {
                this._queue.promise = new Promise(function(resolve, reject)
                {
                        this._queue.resolve = resolve;
                        this._queue.reject = reject;
                }.bind(this));
        }

        return this._queue.promise;
};

Router.prototype._onpopstate = function(e)
{
        // If we end up at the first history entry, e.state will be null
        var historyState = e.state || this._initialHistoryState;
        this._handleHistoryState(historyState, false, 'historyPopState');
};

Router.prototype._urlToHistoryState = function(url)
{
        return {
                statefulControllerRouterUrl: {
                        url: url
                }
        };
};

Router.prototype._pushHistoryState = function(stateList, push)
{
        var url = this.urlStateMap.toURL(stateList);
        var historyTitle = ''; // todo: title
        var historyState = this._urlToHistoryState(url);

        if (push)
        {
                this.window.history.pushState(historyState, historyTitle, url);
        }
        else
        {
                this.window.history.replaceState(historyState, historyTitle, url);
        }

        return url;
};

Router.prototype._handleHistoryState = function(historyState, upgrade, event)
{
        if (!historyState ||
            !historyState.statefulControllerRouterUrl)
        {
                return;
        }

        var url = historyState.statefulControllerRouterUrl.url;
        var stateList = this.urlStateMap.fromURL(url);

        var promise;

        if (this.pending)
        {
                promise = this._addToQueue(stateList, url, upgrade, false);
        }
        else
        {
                this._pendingTransitionPromise = this.frontController.state(stateList, upgrade)
                .bind(this)
                .then(function()
                {
                        this.currentStateList = stateList;
                        this.emit('transitionComplete', stateList, url);
                })
                .finally(function()
                {
                        this._pendingTransitionPromise = null;
                        this._doQueuedTransition();
                }).return(null);

                promise = this._pendingTransitionPromise;
        }

        /* istanbul ignore else : internal use */
        if (event)
        {
                this.emit(event, stateList, url, promise);
        }

        return promise;
};

Router.prototype._doQueuedTransition = function()
{
        if (!this._queue.hasEntry)
        {
                return;
        }

        var stateList = this._queue.stateList;
        var fromHistory = this._queue.fromHistory;
        var upgrade = this._queue.upgrade;
        var push = this._queue.push;
        var resolve = this._queue.resolve;
        var reject = this._queue.reject;

        this._queue = {
                hasEntry: false,
                stateList: null,
                fromHistory: false, // or url
                push: false,
                promise: null,
                resolve: null,
                reject: null
        };

        this._pendingTransitionPromise = this.frontController.state(stateList, upgrade)
        .bind(this)
        .then(function()
        {
                var url;

                this.currentStateList = this._pendingReplace || stateList;

                if (fromHistory === false)
                {
                        url = this._pushHistoryState(this.currentStateList, push);
                }
                else
                {
                        url = fromHistory;
                }

                this.emit('transitionComplete', stateList, url);
        })
        .finally(function()
        {
                this._pendingTransitionPromise = null;
                this._pendingReplace = null;
                this._doQueuedTransition();
        })
        .return(null)
        .then(resolve, reject)
        .return(null);
};