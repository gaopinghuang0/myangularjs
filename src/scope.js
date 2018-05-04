'use strict';

var _ = require('lodash');

function Scope() {
  this.$$watchers = [];
  this.$$lastDirtyWatch = null;  // optimization by short-circuit the digest
  this.$$asyncQueue = [];
  this.$$applyAsyncQueue = [];
  this.$$applyAsyncId = null;
  this.$$postDigestQueue = [];
  this.$root = this;
  this.$$children = [];
  this.$$listeners = {};
  this.$$phase = null;  // $evalAsync uses it to know whether it's in a $digest phase; if not, schedule one
}

// A function is not considered equal to anything but itself
function initWatchVal() {}

// Core function: attach a watcher to a scope
// 
// watchFn: a watch function which specifies the piece of data you’re interested in.
//     Note: As a user, we will use a watch expression, not a watchFn, discussed in Chapter 5
// listenerFn: a listener function which will be called whenever that data changes.
// valueEq: a boolean flag to enable checking by value, not by reference
// @return: a function that can destroy the watch itself
Scope.prototype.$watch = function(watchFn, listenerFn, valueEq) {
  var self = this;
  var watcher = {
    watchFn: watchFn,
    listenerFn: listenerFn || function() {},
    valueEq: !!valueEq,
    last: initWatchVal
  };
  // use unshift not push to add new watches to the beginning, so that destroy watch 
  // during a $digest is valid
  this.$$watchers.unshift(watcher);
  // disable short-circuit optimization if a new watch is added during digest
  this.$root.$$lastDirtyWatch = null;
  return function() {
    // a function that removes the watch from $$watchers
    var index = self.$$watchers.indexOf(watcher);
    if (index >= 0) {
      self.$$watchers.splice(index, 1);
      self.$root.$$lastDirtyWatch = null;  // disable short-circuit optimization 
    }
  };
};

// Core function: iterates over all the watchers that have been attached on the scope, 
// and runs their watch and listener functions accordingly
Scope.prototype.$digest = function() {
  var ttl = 10;  // time to live, to prevent unstable chain watch
  var dirty;
  this.$root.$$lastDirtyWatch = null;
  this.$beginPhase('$digest');

  // flush applyAsync if call $digest first
  if (this.$root.$$applyAsyncId) {
    clearTimeout(this.$root.$$applyAsyncId);
    this.$$flushApplyAsync();
  }

  do {
    // this guarantees that the function will be invoked later 
    // but still during the same digest, the function is often added in the listener function
    while (this.$$asyncQueue.length) {
      try {
        var asyncTask = this.$$asyncQueue.shift();
        asyncTask.scope.$eval(asyncTask.expression);
      } catch (e) {
        console.error(e);
      }
    }
    dirty = this.$$digestOnce();
    if ((dirty || this.$$asyncQueue.length) && !(ttl--)) {
      throw "10 digest iterations reached";
    }
  } while (dirty || this.$$asyncQueue.length);
  this.$clearPhase();

  while (this.$$postDigestQueue.length) {
    try {
      this.$$postDigestQueue.shift()();
    } catch (e) {
      console.error(e);
    }
  }
};

// iterate all watchers once and return whether there were any changes or not
Scope.prototype.$$digestOnce = function() {
  var self = this;
  var dirty;
  var continueLoop = true;
  this.$$everyScope(function(scope) {
    var newValue, oldValue;
    _.forEachRight(scope.$$watchers, function(watcher) {
      try {
        if (watcher) {
          newValue = watcher.watchFn(scope);
          oldValue = watcher.last;
          if (!scope.$$areEqual(newValue, oldValue, watcher.valueEq)) {
            scope.$root.$$lastDirtyWatch = watcher;
            watcher.last = (watcher.valueEq ? _.cloneDeep(newValue) : newValue);
            watcher.listenerFn(newValue, 
              // For new watches, we should provide the new value as the old value
              (oldValue === initWatchVal ? newValue : oldValue),
              scope);
            dirty = true;
          } else if (scope.$root.$$lastDirtyWatch === watcher) {
            continueLoop = false;
            return false;  // optimization, stop early
          }
        }
      } catch (e) {
        console.error(e);
      }
    });
    return continueLoop;
  });
  return dirty;
};

// helper function to recursively call fn from top scope to child scope
// until meets a false
Scope.prototype.$$everyScope = function(fn) {
  if (fn(this)) {
    return this.$$children.every(function(child) {
      return child.$$everyScope(fn);
    });
  } else {
    return false;
  }
};

Scope.prototype.$beginPhase = function(phase) {
  if (this.$$phase) {
    throw this.$$phase + ' already in progress.';
  }
  this.$$phase = phase;
};

Scope.prototype.$clearPhase = function() {
  this.$$phase = null;
};

Scope.prototype.$$areEqual = function(newValue, oldValue, valueEq) {
  if (valueEq) {
    return _.isEqual(newValue, oldValue);
  } else {
    return newValue === oldValue ||
      (typeof newValue === 'number' && typeof oldValue === 'number' &&
        isNaN(newValue) && isNaN(oldValue));
  }
};

Scope.prototype.$eval = function(expr, locals) {
  return expr(this, locals);
};

// It is considered the standard way to integrate external libraries to Angular.
// If you don’t know exactly what scopes are relevant to the change you’re making,
// it’s a safe bet to just involve all of them from the root scope
// thus, it's slower than $digest
Scope.prototype.$apply = function(expr) {
  try {
    this.$beginPhase('$apply');
    return this.$eval(expr);
  } finally {
    this.$clearPhase();
    this.$root.$digest();  // always call from the root scope, top-down
  }
};

// $evalAsync, on the other hand, is much more strict about when the scheduled work is executed.
// Since it’ll happen during the ongoing digest, it’s guaranteed to run 
// before the browser decides to do anything else.
Scope.prototype.$evalAsync = function(expr) {
  var self = this;

  // $evalAsync needs to know whether it's in a $digest phase; if not, schedule one
  // so it will be eval "very soon" and doesn't have to wait until something else
  // to trigger a $digest indefinitely
  if (!self.$$phase && !self.$$asyncQueue.length) {
    setTimeout(function() {
      if (self.$$asyncQueue.length) {
        self.$root.$digest();  // schedules a digest from root
      }
    }, 0);
  }
  this.$$asyncQueue.push({scope: this, expression: expr});
};

Scope.prototype.$applyAsync = function(expr) {
  var self = this;
  self.$$applyAsyncQueue.push(function() {
    self.$eval(expr);
  });
  if (self.$root.$$applyAsyncId === null) {
    self.$root.$$applyAsyncId = setTimeout(function() {
      self.$apply(_.bind(self.$$flushApplyAsync, self));
    }, 0);
  }
};

Scope.prototype.$$flushApplyAsync = function() {
  while (this.$$applyAsyncQueue.length) {
    try {
      this.$$applyAsyncQueue.shift()();
    } catch (e) {
      console.error(e);
    }
  }
  this.$root.$$applyAsyncId = null;
};

Scope.prototype.$$postDigest = function(fn) {
  this.$$postDigestQueue.push(fn);
};

Scope.prototype.$watchGroup = function(watchFns, listenerFn) {
  var self = this;
  var newValues = new Array(watchFns.length);
  var oldValues = new Array(watchFns.length);
  var changeReactionScheduled = false;
  var firstRun = true;

  if (watchFns.length === 0) {
    var shouldCall = true;
    self.$evalAsync(function() {
      if (shouldCall) {
        listenerFn(newValues, newValues, self);
      }
    });
    return function() {
      shouldCall = false;
    };
  }

  function watchGroupListener() {
    if (firstRun) {
      firstRun = false;
      listenerFn(newValues, newValues, self);
    } else {
      listenerFn(newValues, oldValues, self);
    }
    changeReactionScheduled = false;
  }

  var destroyFunctions = _.map(watchFns, function(watchFn, i) {
    return self.$watch(watchFn, function(newValue, oldValue) {
      newValues[i] = newValue;
      oldValues[i] = oldValue;
      if (!changeReactionScheduled) {
        changeReactionScheduled = true;
        self.$evalAsync(watchGroupListener);
      }
    });
  });

  return function() {
    _.forEach(destroyFunctions, function(destroyFunction) {
      destroyFunction();
    });
  };
};

// the prototypeParent and hierarchyParent are usually the same
// the difference is subtle and sometimes useful in directive transclusion later
Scope.prototype.$new = function(isolated, parent) {
  var child;
  parent = parent || this;  // hierarchyParent
  if (isolated) {
    child = new Scope();
    child.$root = parent.$root;
    child.$$asyncQueue = parent.$$asyncQueue;
    child.$$postDigestQueue = parent.$$postDigestQueue;
    child.$$applyAsyncQueue = parent.$$applyAsyncQueue;
  } else {
    var ChildScope = function() { };
    ChildScope.prototype = this;
    child = new ChildScope();
  }
  parent.$$children.push(child);
  child.$$watchers = [];
  child.$$listeners = {};
  child.$$children = [];
  child.$parent = parent;
  return child;
};

Scope.prototype.$destroy = function() {
  this.$broadcast('$destroy');
  if (this.$parent) {
    var siblings = this.$parent.$$children;
    var indexOfThis = siblings.indexOf(this);
    if (indexOfThis >= 0) {
      siblings.splice(indexOfThis, 1);
    }
  }
  this.$$watchers = null;
  this.$$listeners = {};
};

function isArrayLike(obj) {
  if (_.isNull(obj) || _.isUndefined(obj)) {
    return false;
  }
  var length = obj.length;
  // consider the obj has a property called length, say obj.length is 42
  // an array will have 41, while a non-array obj is not
  // this check works for most objects, well enough for practice
  return length === 0 || (_.isNumber(length) && length > 0 && (length-1) in obj);
}

// chapter 3 watch collections
Scope.prototype.$watchCollection = function(watchFn, listenerFn) {
  var self = this;
  var newValue, oldValue;
  var oldLength;  // optimization
  var changeCount = 0;  // guarantees that internalWatchFn will return a diff value if changes
  var veryOldValue;
  // only track veryOldValue if listenerFn needs to use old value
  // because track is expensive
  var trackVeryOldValue = (listenerFn.length > 1);
  var firstRun = true;

  var internalWatchFn = function(scope) {
    var newLength;
    newValue = watchFn(scope);

    // check for changes
    if (_.isObject(newValue)) {
      if (isArrayLike(newValue)) {
        if (!_.isArray(oldValue)) {
          changeCount++;
          oldValue = [];
        }
        if (newValue.length !== oldValue.length) {
          changeCount++;
          oldValue.length = newValue.length;
        }
        _.forEach(newValue, function(newItem, i) {
          var bothNaN = _.isNaN(newItem) && _.isNaN(oldValue[i]);
          if (!bothNaN && newItem !== oldValue[i]) {
            changeCount++;
            oldValue[i] = newItem;
          }
        });
      } else {
        if (!_.isObject(oldValue) || isArrayLike(oldValue)) {
          changeCount++;
          oldValue = {};
          oldLength = 0;
        }
        newLength = 0;
        _.forOwn(newValue, function(newVal, key) {
          newLength++;
          if (oldValue.hasOwnProperty(key)) {
            var bothNaN = _.isNaN(newVal) && _.isNaN(oldValue[key]);
            if (!bothNaN && oldValue[key] !== newVal) {
              changeCount++;
              oldValue[key] = newVal;
            }
          } else {
            changeCount++;
            oldLength++;
            oldValue[key] = newVal;
          }
        });
        if (oldLength > newLength) {
          changeCount++;
          _.forOwn(oldValue, function(oldVal, key) {
            if (!newValue.hasOwnProperty(key)) {
              oldLength--;
              delete oldValue[key];
            }
          });
        }
      }
    } else {
      if (!self.$$areEqual(newValue, oldValue, false)) {
        changeCount++;
      }
      oldValue = newValue;    
    }

    return changeCount;
  };
  var internalLisenterFn = function() {
    if (firstRun) {
      listenerFn(newValue, newValue, self);
      firstRun = false;
    } else {
      listenerFn(newValue, veryOldValue, self);
    }

    if (trackVeryOldValue) {
      veryOldValue = _.clone(newValue);
    }
  };
  return this.$watch(internalWatchFn, internalLisenterFn);
};

// chapter 4 Events
Scope.prototype.$on = function(eventName, listener) {
  var listeners = this.$$listeners[eventName];
  if (!listeners) {
    this.$$listeners[eventName] = listeners = [];
  }
  listeners.push(listener);
  return function() {
    var index = listeners.indexOf(listener);
    if (index >= 0) {
      listeners[index] = null;
    }
  };
};

Scope.prototype.$emit = function(eventName) {
  var propagationStopped = false;
  var event = {
    name: eventName,
    targetScope: this,
    stopPropagation: function() {
      propagationStopped = true;
    },
    preventDefault: function() {
      event.defaultPrevented = true;
    }
  };
  // var additionalArgs = _.rest(arguments);  // _.rest API is changed to _.tail
  var listenerArgs = [event].concat(_.tail(arguments));
  var scope = this;
  do {
    event.currentScope = scope;
    scope.$$fireEventOnScope(eventName, listenerArgs);
    scope = scope.$parent;
  } while (scope && !propagationStopped);
  event.currentScope = null;
  return event;
};

Scope.prototype.$broadcast = function(eventName) {
  var event = {
    name: eventName,
    targetScope: this,
    preventDefault: function() {
      event.defaultPrevented = true;
    }
  };
  // var additionalArgs = _.rest(arguments);  // _.rest API is changed to _.tail
  var listenerArgs = [event].concat(_.tail(arguments));
  this.$$everyScope(function(scope) {
    event.currentScope = scope;
    scope.$$fireEventOnScope(eventName, listenerArgs);
    return true;
  });
  event.currentScope = null;
  return event;
};

Scope.prototype.$$fireEventOnScope = function(eventName, listenerArgs) {
  var listeners = this.$$listeners[eventName] || [];
  var i = 0;
  while (i < listeners.length) {
    if (listeners[i] === null) {
      listeners.splice(i, 1);
    } else {
      try {
        listeners[i].apply(null, listenerArgs);
      } catch (e) {
        console.error(e);
      }
      i++;
    }
  }
};

module.exports = Scope;