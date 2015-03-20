'use strict';
/* global describe, beforeEach, it */

var assert = require('assert');
var Promise = require('bluebird');

var Router = require('../lib/Router');
var Controller = require('stateful-controller');


describe('Router', function()
{
        var windowStub;
        var urlStateMap;
        var front;
        var router;

        beforeEach(function()
        {
                windowStub = {
                        location: {
                                pathname: '/foo/bar',
                                search: ''
                        },
                        history: {
                                pushState: function() { throw Error('Should not occur in this test case'); },
                                replaceState: function() { throw Error('Should not occur in this test case'); },
                                state: null
                        }
                };

                urlStateMap = {
                        fromURL: function(path)
                        {
                                throw Error('Should not occur in this test case');
                        },
                        toURL: function(states)
                        {
                                throw Error('Should not occur in this test case');
                        }
                };

                front = new Controller(); // (will reject unknown states)
                router = new Router(windowStub, urlStateMap, front);
        });

        describe('constructor', function()
        {

                /* jshint -W031 */
                it('should throw for missing arguments', function()
                {
                        try
                        {
                                new Router();
                                assert(false);
                        }
                        catch(err)
                        {
                                assert.strictEqual(err.message, 'Missing argument');
                        }
                });

                it('should throw if the UrlStateMap is not valid', function()
                {
                        try
                        {
                                new Router(windowStub, {toURL: 'not a func', fromURL: 'not a func'}, front);
                                assert(false);
                        }
                        catch(err)
                        {
                                assert.strictEqual(err.message, 'Argument `urlStateMap` must implement toURL(states) and fromURL(url)');
                        }
                });

                it('should throw if the history API is not supported', function()
                {
                        try
                        {
                                windowStub.history.pushState = null;
                                new Router(windowStub, urlStateMap, front);
                                assert(false);
                        }
                        catch(err)
                        {
                                assert.strictEqual(err.message, 'Argument `window` does not support the history API');
                        }
                });

                it('should throw if the controller argument is not a controller', function()
                {
                        try
                        {
                                new Router(windowStub, urlStateMap, {});
                                assert(false);
                        }
                        catch(err)
                        {
                                assert.strictEqual(err.message, 'Argument `frontController` is not a stateful-controller');
                        }
                });
        });

        describe('upgradeInitialState', function()
        {
                beforeEach(function()
                {
                        urlStateMap.fromURL = function(path)
                        {
                                if (path === '/foo/bar')
                                {
                                        return ['foo'];
                                }

                                if (path === '/qwerty')
                                {
                                        return ['baz'];
                                }

                                throw Error('Should not occur in this test case');
                        };
                });

                it('should use window.location if there is no initial history.state', function(done)
                {
                        var enteredFoo = false;
                        front.enterFoo = function(state, upgrade)
                        {
                                assert(!enteredFoo);
                                assert.strictEqual(state, 'foo');
                                assert.strictEqual(upgrade, true);
                                enteredFoo = true;
                        };

                        router.upgradeInitialState().then(function(val)
                        {
                                assert(enteredFoo);
                                assert.strictEqual(val, null);
                        }).done(done);
                });

                it('the initial state should not be overridden by attachPopStateListener', function(done)
                {
                        front.enterFoo = function(state, upgrade)
                        {
                        };

                        windowStub.addEventListener = function(){};

                        router.upgradeInitialState().then(function(val)
                        {
                                router.attachPopStateListener();
                                assert.strictEqual(router._initialHistoryState.statefulControllerRouterUrl.url, '/foo/bar');

                        }).done(done);
                });

                it('should use history.state, instead of location, if it is present', function(done)
                {
                        windowStub.history.state = {
                                statefulControllerRouterUrl: {
                                        url: '/qwerty'
                                }
                        };

                        var enteredBaz = false;
                        front.enterBaz = function(state, upgrade)
                        {
                                assert(!enteredBaz);
                                assert.strictEqual(state, 'baz');
                                assert.strictEqual(upgrade, true);
                                enteredBaz = true;
                        };

                        router.upgradeInitialState().then(function(val)
                        {
                                assert(enteredBaz);
                                assert.strictEqual(val, null);
                        }).done(done);
                });

                it('should queue if a transition is in progress', function(done)
                {
                        var enteredFoo = false;
                        var enteredBaz = false;
                        var pushedState = false;

                        urlStateMap.toURL = function(states)
                        {
                                if (states.length === 1)
                                {
                                        switch(states[0])
                                        {
                                                case 'foo': return '/foo/bar';
                                                case 'baz': return '/qwerty';
                                        }
                                }

                                throw Error('Should not occur in this test case');
                        };

                        windowStub.history.pushState = function(state, title, url)
                        {
                                assert(!pushedState);
                                pushedState = true;
                                assert.deepEqual({
                                        statefulControllerRouterUrl: {
                                                url: '/foo/bar'
                                        }
                                }, state);

                                assert.strictEqual(url, '/foo/bar');
                        };

                        windowStub.location.pathname = '/qwerty';

                        front.enterFoo = function(state, upgrade)
                        {
                                assert(router.pending);
                                assert(!enteredFoo);
                                assert(!enteredBaz);
                                assert.strictEqual(state, 'foo');
                                assert.strictEqual(upgrade, false);
                                assert(!pushedState, 'pushState should occur after the state transition itself');
                                enteredFoo = true;

                                // Even though enterFoo takes a while, baz should remain queued
                                return Promise.delay(10);
                        };

                        front.enterBaz = function(state, upgrade)
                        {
                                assert(router.pending);
                                assert(!enteredBaz);
                                assert(enteredFoo);
                                assert.strictEqual(state, 'baz');
                                assert.strictEqual(upgrade, true);
                                enteredBaz = true;
                        };

                        assert(!router.pending);

                        router.enterStates(['foo']).then(function(val)
                        {
                                assert(router.pending, 'should already be pending because of the previously queued state ');
                                assert(enteredFoo);
                                assert(!enteredBaz);
                                assert(pushedState, 'pushState should occur before the enter() promise resolves');
                                assert.strictEqual(val, null);
                        });

                        router.upgradeInitialState().then(function(val)
                        {
                                assert(!router.pending);
                                assert(enteredFoo);
                                assert(enteredBaz);
                                assert(pushedState);
                                assert.strictEqual(val, null);
                        }).done(done);

                        assert(router.pending);
                        // state methods are always async
                        assert(!enteredFoo);
                        assert(!enteredBaz);
                });
        });

        describe('enterStates', function(done)
        {
                var pushedState;
                var enteredFoo;

                beforeEach(function()
                {
                        pushedState = false;
                        enteredFoo = false;

                        urlStateMap.toURL = function(states)
                        {
                                if (states.length === 1)
                                {
                                        switch(states[0])
                                        {
                                                case 'foo': return '/foo/bar';
                                        }
                                }

                                throw Error('Should not occur in this test case');
                        };

                        front.enterFoo = function(state, upgrade)
                        {
                                assert(router.pending);
                                assert(!enteredFoo);
                                assert.strictEqual(state, 'foo');
                                assert.strictEqual(upgrade, false);
                                assert(!pushedState, 'pushState/replaceState should occur after the state transition itself');
                                enteredFoo = true;
                        };
                });

                it('should use pushState (the default) after the state transition', function()
                {
                        windowStub.history.pushState = function(state, title, url)
                        {
                                assert(!pushedState);
                                pushedState = true;
                                assert.deepEqual({
                                        statefulControllerRouterUrl: {
                                                url: '/foo/bar'
                                        }
                                }, state);

                                assert.strictEqual(url, '/foo/bar');
                        };

                        router.enterStates(['foo']).then(function(val)
                        {
                                assert(!router.pending);
                                assert(enteredFoo);
                                assert(pushedState);
                                assert.strictEqual(val, null);
                        }).done(done);
                });

                it('should use replaceHistory (second argument) after the state transition', function()
                {
                        windowStub.history.replaceState = function(state, title, url)
                        {
                                assert(!pushedState);
                                pushedState = true;
                                assert.deepEqual({
                                        statefulControllerRouterUrl: {
                                                url: '/foo/bar'
                                        }
                                }, state);

                                assert.strictEqual(url, '/foo/bar');
                        };

                        router.enterStates(['foo'], false).then(function(val)
                        {
                                assert(!router.pending);
                                assert(enteredFoo);
                                assert(pushedState);
                                assert.strictEqual(val, null);
                        }).done(done);
                });

                it('should not permit concurrent state transitions, not should it queue', function(done)
                {
                        windowStub.history.pushState = function(){};

                        assert(!router.pending);

                        front.enterBar = function(state, upgrade)
                        {
                                throw Error('Should not occur in this test case');
                        };

                        var caught = false;
                        Promise.join(
                                router.enterStates(['foo']).then(function(val)
                                {
                                        assert(!router.pending);
                                        assert(enteredFoo);
                                        assert.strictEqual(val, null);
                                }),

                                router.enterStates(['bar']).catch(function(err)
                                {
                                        assert(!caught);
                                        assert(err);
                                        assert(err.message, 'A previous state transition is still pending');
                                        caught = true;
                                })
                        ).then(function()
                        {
                                assert(enteredFoo);
                                assert(caught);
                        })
                        .return(null).done(done);
                });
        });

        describe('queueEnterStates', function()
        {
                var pushedState;
                var enteredFoo;

                beforeEach(function()
                {
                        pushedState = false;
                        enteredFoo = false;

                        urlStateMap.toURL = function(states)
                        {
                                if (states.length === 1)
                                {
                                        switch(states[0])
                                        {
                                                case 'foo': return '/foo/bar';
                                        }
                                }

                                throw Error('Should not occur in this test case');
                        };

                        front.enterFoo = function(state, upgrade)
                        {
                                assert(router.pending);
                                assert(!enteredFoo);
                                assert.strictEqual(state, 'foo');
                                assert.strictEqual(upgrade, false);
                                assert(!pushedState, 'pushState/replaceState should occur after the state transition itself');
                                enteredFoo = true;
                        };
                });

                it('should transition right away if there is no other transition pending', function(done)
                {
                        windowStub.history.pushState = function(state, title, url)
                        {
                                assert(!pushedState);
                                pushedState = true;
                                assert.deepEqual({
                                        statefulControllerRouterUrl: {
                                                url: '/foo/bar'
                                        }
                                }, state);

                                assert.strictEqual(url, '/foo/bar');
                        };

                        router.queueEnterStates(['foo']).then(function(val)
                        {
                                assert(!router.pending);
                                assert(enteredFoo);
                                assert(pushedState);
                                assert.strictEqual(val, null);
                        }).done(done);
                });

                it('should queue if a transition is in progress', function(done)
                {
                        var enteredFoo = false;
                        var enteredBar = false;
                        var pushedState = 0;

                        urlStateMap.toURL = function(states)
                        {
                                if (states.length === 1)
                                {
                                        switch(states[0])
                                        {
                                                case 'foo': return '/foo';
                                                case 'bar': return '/bar';
                                        }
                                }

                                throw Error('Should not occur in this test case');
                        };

                        windowStub.history.pushState = function(state, title, url)
                        {
                                if (pushedState === 0)
                                {
                                        ++pushedState;

                                        assert.deepEqual({
                                                statefulControllerRouterUrl: {
                                                        url: '/foo'
                                                }
                                        }, state);

                                        assert.strictEqual(url, '/foo');
                                }
                                else if (pushedState === 1)
                                {
                                        ++pushedState;

                                        assert.deepEqual({
                                                statefulControllerRouterUrl: {
                                                        url: '/bar'
                                                }
                                        }, state);

                                        assert.strictEqual(url, '/bar');
                                }
                                else
                                {
                                        assert(false);
                                }
                        };

                        front.enterFoo = function(state, upgrade)
                        {
                                assert(router.pending);
                                assert(!enteredFoo);
                                assert(!enteredBar);
                                assert.strictEqual(state, 'foo');
                                assert.strictEqual(upgrade, false);
                                assert.strictEqual(pushedState, 0, 'pushState should occur after the state transition itself');
                                enteredFoo = true;

                                // Even though enterFoo takes a while, bar should remain queued
                                return Promise.delay(10);
                        };

                        front.enterBar = function(state, upgrade)
                        {
                                assert(router.pending);
                                assert(!enteredBar);
                                assert(enteredFoo);
                                assert.strictEqual(state, 'bar');
                                assert.strictEqual(upgrade, false);
                                enteredBar = true;
                        };

                        assert(!router.pending);

                        Promise.join(
                                router.queueEnterStates(['foo'], true).then(function(val)
                                {
                                        assert(router.pending, 'should already be pending because of the previously queued state');
                                        assert(enteredFoo);
                                        assert(!enteredBar);
                                        assert.strictEqual(pushedState, 1);
                                        assert.strictEqual(val, null);
                                }),

                                router.queueEnterStates(['bar']).then(function(val)
                                {
                                        assert(!router.pending);
                                        assert(enteredFoo);
                                        assert(enteredBar);
                                        assert.strictEqual(pushedState, 2);
                                        assert.strictEqual(val, null);
                                })
                        ).return(null).done(done);

                        assert(router.pending);
                        // state methods are always async
                        assert(!enteredFoo);
                        assert(!enteredBar);
                });

                it('should overwrite the queue if multiple transitions are queued', function(done)
                {
                        var enteredFoo = false;
                        var enteredBar = false;
                        var pushedState = 0;

                        urlStateMap.toURL = function(states)
                        {
                                if (states.length === 1)
                                {
                                        switch(states[0])
                                        {
                                                case 'foo': return '/foo';
                                                case 'bar': return '/bar';
                                                case 'baz': return '/baz';
                                        }
                                }

                                throw Error('Should not occur in this test case');
                        };

                        windowStub.history.pushState = function(state, title, url)
                        {
                                if (pushedState === 0)
                                {
                                        ++pushedState;

                                        assert.deepEqual({
                                                statefulControllerRouterUrl: {
                                                        url: '/foo'
                                                }
                                        }, state);

                                        assert.strictEqual(url, '/foo');
                                }
                                else if (pushedState === 1)
                                {
                                        ++pushedState;

                                        assert.deepEqual({
                                                statefulControllerRouterUrl: {
                                                        url: '/bar'
                                                }
                                        }, state);

                                        assert.strictEqual(url, '/bar');
                                }
                                else
                                {
                                        assert(false);
                                }
                        };

                        front.enterFoo = function(state, upgrade)
                        {
                                assert(router.pending);
                                assert(!enteredFoo);
                                assert(!enteredBar);
                                assert.strictEqual(state, 'foo');
                                assert.strictEqual(upgrade, false);
                                assert.strictEqual(pushedState, 0, 'pushState should occur after the state transition itself');
                                enteredFoo = true;
                        };

                        front.enterBar = function(state, upgrade)
                        {
                                assert(router.pending);
                                assert(!enteredBar);
                                assert(enteredFoo);
                                assert.strictEqual(state, 'bar');
                                assert.strictEqual(upgrade, false);
                                enteredBar = true;
                        };

                        front.enterBaz = function(state, upgrade)
                        {
                                assert(false, 'should not occur, it has been overwritten');
                        };

                        assert(!router.pending);

                        Promise.join(
                                router.queueEnterStates(['foo']).then(function(val)
                                {
                                        assert(router.pending, 'should already be pending because of the previously queued state');
                                        assert(enteredFoo);
                                        assert(!enteredBar);
                                        assert.strictEqual(pushedState, 1);
                                        assert.strictEqual(val, null);
                                }),

                                router.queueEnterStates(['baz']).then(function(val)
                                {
                                        // entering baz has been overwritten by entering bar, however this promise should still resolve

                                        assert(!router.pending);
                                        assert(enteredFoo);
                                        assert(enteredBar);
                                }),

                                router.queueEnterStates(['bar']).then(function(val)
                                {
                                        assert(!router.pending);
                                        assert(enteredFoo);
                                        assert(enteredBar);
                                        assert.strictEqual(pushedState, 2);
                                        assert.strictEqual(val, null);
                                })
                        ).return(null).done(done);

                        assert(router.pending);
                        // state methods are always async
                        assert(!enteredFoo);
                        assert(!enteredBar);
                });
        });

        describe('onpopstate', function()
        {
                var popStateEventHandler;
                beforeEach(function()
                {
                        popStateEventHandler = null;

                        windowStub.addEventListener = function(name, func)
                        {
                                assert.strictEqual(name, 'popstate');
                                popStateEventHandler = func;
                        };
                });

                it('should not add the popstate event in the constructor', function()
                {
                        assert(!popStateEventHandler);
                });

                it('should perform a state transition when the popstate event is fired', function(done)
                {
                        var enteredBaz = false;

                        urlStateMap.fromURL = function(path)
                        {
                                if (path === '/qwerty')
                                {
                                        return ['baz'];
                                }

                                throw Error('Should not occur in this test case');
                        };

                        front.enterBaz = function(state, upgrade)
                        {
                                assert(!enteredBaz);
                                assert.strictEqual(state, 'baz');
                                assert.strictEqual(upgrade, false);
                                enteredBaz = true;
                        };

                        router.on('historyPopState', function(stateList, url, promise)
                        {
                                assert.deepEqual(stateList, ['baz']);
                                assert.strictEqual(url, '/qwerty');
                                promise.done(done);
                        });

                        router.attachPopStateListener();
                        assert(typeof popStateEventHandler === 'function');

                        popStateEventHandler({ state: {
                                statefulControllerRouterUrl: {
                                        url: '/qwerty'
                                }
                        }});
                });

                it('should go back to the initial state if the popstate event has a null state', function(done)
                {
                        var enteredBaz = false;

                        urlStateMap.fromURL = function(path)
                        {
                                if (path === '/qwerty')
                                {
                                        return ['baz'];
                                }

                                throw Error('Should not occur in this test case');
                        };

                        front.enterBaz = function(state, upgrade)
                        {
                                assert(!enteredBaz);
                                assert.strictEqual(state, 'baz');
                                assert.strictEqual(upgrade, false);
                                enteredBaz = true;
                        };

                        router.on('historyPopState', function(stateList, url, promise)
                        {
                                assert.deepEqual(stateList, ['baz']);
                                assert.strictEqual(url, '/qwerty');
                                promise.done(done);
                        });

                        windowStub.location.pathname = '/qwerty';
                        router.attachPopStateListener();
                        assert(typeof popStateEventHandler === 'function');

                        popStateEventHandler({ state: null });
                });

                it('should ignore popstate if the state object was not created by this lib', function()
                {
                        router.on('historyPopState', function(stateList, url, promise)
                        {
                                assert(false);
                        });

                        router.attachPopStateListener();
                        assert(typeof popStateEventHandler === 'function');

                        popStateEventHandler({ state: {somethingThatIsNotOurs: 'bla bla'} });
                });
        });

        describe('replaceStateList', function()
        {
                beforeEach(function()
                {
                        urlStateMap.toURL = function(states)
                        {
                                if (states.length === 1)
                                {
                                        switch(states[0])
                                        {
                                                case 'foo': return '/foo';
                                                case 'bar': return '/bar';
                                        }
                                }

                                throw Error('Should not occur in this test case');
                        };
                });

                it('should call replaceState right away if no transition is pending', function()
                {
                        var replacedState = false;

                        windowStub.history.replaceState = function(state, title, url)
                        {
                                assert(!replacedState);
                                replacedState = true;

                                assert.deepEqual({
                                        statefulControllerRouterUrl: {
                                                url: '/foo'
                                        }
                                }, state);

                                assert.strictEqual(url, '/foo');
                        };

                        router.replaceStateList(['foo']);
                        assert(replacedState);
                });

                it('should wait for the pending transition to complete (and use pushState instead)', function(done)
                {
                        var enteredFoo = false;
                        var pushedState = false;

                        windowStub.history.pushState = function(state, title, url)
                        {
                                assert(!pushedState);
                                pushedState = true;
                                assert.deepEqual({
                                        statefulControllerRouterUrl: {
                                                url: '/bar'
                                        }
                                }, state);

                                assert.strictEqual(url, '/bar');
                        };

                        front.enterFoo = function(state, upgrade)
                        {
                                assert(router.pending);
                                assert(!enteredFoo);
                                assert.strictEqual(state, 'foo');
                                assert.strictEqual(upgrade, false);
                                assert(!pushedState, 'pushState should occur after the state transition itself');
                                enteredFoo = true;
                        };

                        router.enterStates(['foo']).then(function(val)
                        {
                                assert(!router.pending);
                                assert(enteredFoo);
                                assert(pushedState);
                                assert.strictEqual(val, null);
                        }).done(done);

                        router.replaceStateList(['bar']);
                        assert(!pushedState);
                });
        });

        describe('controller state method rejection', function()
        {
                beforeEach(function()
                {
                        urlStateMap.toURL = function(states)
                        {
                                if (states.length === 1)
                                {
                                        switch(states[0])
                                        {
                                                case 'foo': return '/foo';
                                                case 'bar': return '/bar';
                                        }
                                }

                                throw Error('Should not occur in this test case');
                        };
                });

                it('should not cause pushHistory to be called', function(done)
                {
                        var pushedState = false;

                        front.enterFoo = function()
                        {
                                return Promise.reject(Error('quux'));
                        };

                        router.enterStates(['foo'])
                        .catch(function(err)
                        {
                                assert(!pushedState);
                                assert(err.message, 'quux');
                                done();
                        });
                });

                it('should still perform a queued transition', function(done)
                {
                        var enteredFoo = false;
                        var enteredBar = false;
                        var pushedState = 0;

                        urlStateMap.toURL = function(states)
                        {
                                if (states.length === 1)
                                {
                                        switch(states[0])
                                        {
                                                case 'foo': return '/foo';
                                                case 'bar': return '/bar';
                                        }
                                }

                                throw Error('Should not occur in this test case');
                        };

                        windowStub.history.pushState = function(state, title, url)
                        {
                                if (pushedState === 0)
                                {
                                        ++pushedState;

                                        assert.deepEqual({
                                                statefulControllerRouterUrl: {
                                                        url: '/bar'
                                                }
                                        }, state);

                                        assert.strictEqual(url, '/bar');
                                }
                                else
                                {
                                        assert(false);
                                }
                        };

                        front.enterFoo = function(state, upgrade)
                        {
                                assert(!enteredFoo);
                                assert(!enteredBar);
                                enteredFoo = true;

                                return Promise.reject(Error('quux'));
                        };

                        front.enterBar = function(state, upgrade)
                        {
                                assert(router.pending);
                                assert(!enteredBar);
                                assert(enteredFoo);
                                assert.strictEqual(state, 'bar');
                                assert.strictEqual(upgrade, false);
                                enteredBar = true;
                        };

                        assert(!router.pending);

                        Promise.join(
                                router.queueEnterStates(['foo'], true).catch(function(err)
                                {
                                        assert(router.pending, 'should already be pending because of the previously queued state');
                                        assert(enteredFoo);
                                        assert(!enteredBar);
                                        assert.strictEqual(pushedState, 0);
                                        assert.strictEqual(err.message, 'quux');
                                }),

                                router.queueEnterStates(['bar']).then(function(val)
                                {
                                        assert(!router.pending);
                                        assert(enteredFoo);
                                        assert(enteredBar);
                                        assert.strictEqual(pushedState, 1);
                                        assert.strictEqual(val, null);
                                })
                        ).return(null).done(done);
                });

                it('should properly reject queued transitions', function(done)
                {
                        var enteredFoo = false;
                        var enteredBar = false;
                        var pushedState = 0;

                        urlStateMap.toURL = function(states)
                        {
                                if (states.length === 1)
                                {
                                        switch(states[0])
                                        {
                                                case 'foo': return '/foo';
                                                case 'bar': return '/bar';
                                        }
                                }

                                throw Error('Should not occur in this test case');
                        };

                        windowStub.history.pushState = function(state, title, url)
                        {
                                if (pushedState === 0)
                                {
                                        ++pushedState;

                                        assert.deepEqual({
                                                statefulControllerRouterUrl: {
                                                        url: '/foo'
                                                }
                                        }, state);

                                        assert.strictEqual(url, '/foo');
                                }
                                else
                                {
                                        assert(false);
                                }
                        };

                        front.enterFoo = function(state, upgrade)
                        {
                                assert(router.pending);
                                assert(!enteredFoo);
                                assert(!enteredBar);
                                assert.strictEqual(state, 'foo');
                                assert.strictEqual(upgrade, false);
                                assert.strictEqual(pushedState, 0, 'pushState should occur after the state transition itself');
                                enteredFoo = true;

                                // Even though enterFoo takes a while, bar should remain queued
                                return Promise.delay(10);
                        };

                        front.enterBar = function(state, upgrade)
                        {
                                assert(router.pending);
                                assert(!enteredBar);
                                assert(enteredFoo);
                                assert.strictEqual(state, 'bar');
                                assert.strictEqual(upgrade, false);
                                enteredBar = true;
                                return Promise.reject(Error('quux'));
                        };

                        Promise.join(
                                router.queueEnterStates(['foo'], true).then(function(val)
                                {
                                        assert(router.pending, 'should already be pending because of the previously queued state');
                                        assert(enteredFoo);
                                        assert(!enteredBar);
                                        assert.strictEqual(pushedState, 1);
                                        assert.strictEqual(val, null);
                                }),

                                router.queueEnterStates(['bar']).catch(function(err)
                                {
                                        assert(!router.pending);
                                        assert(enteredFoo);
                                        assert(enteredBar);
                                        assert.strictEqual(pushedState, 1);
                                        assert.strictEqual(err.message, 'quux');
                                })
                        ).return(null).done(done);
                });
        });
});
