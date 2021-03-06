// Copyright 2013 The Toolkitchen Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var mixin = scope.mixin;
  var unwrap = scope.unwrap;
  var wrap = scope.wrap;
  var registerWrapper = scope.registerWrapper;
  var wrappers = scope.wrappers;

  var wrappedFuns = new SideTable();
  var listenersTable = new SideTable();
  var handledEventsTable = new SideTable();
  var targetTable = new SideTable();
  var currentTargetTable = new SideTable();
  var relatedTargetTable = new SideTable();
  var eventPhaseTable = new SideTable();
  var stopPropagationTable = new SideTable();
  var stopImmediatePropagationTable = new SideTable();

  function isShadowRoot(node) {
    return node instanceof scope.WrapperShadowRoot;
  }

  function isInsertionPoint(node) {
    var localName = node.localName;
    return localName === 'content' || localName === 'shadow';
  }

  function isShadowHost(node) {
    return !!node.shadowRoot;
  }

  // https://dvcs.w3.org/hg/webcomponents/raw-file/tip/spec/shadow/index.html#dfn-adjusted-parent
  function calculateParent(node, context) {
    // 1.
    if (isShadowRoot(node))
      return node.insertionPointParent || scope.getHostForShadowRoot(node)

    // 2.
    var p = node.insertionPointParent;
    if (p)
      return p;

    // 3.
    if (context && isInsertionPoint(node)) {
      var parentNode = node.parentNode;
      if (parentNode && isShadowHost(parentNode)) {
        var trees = getShadowTrees(parentNode);
        var p = context.insertionPointParent;
        for (var i = 0; i < trees.length; i++) {
          if (trees[i].contains(p))
            return p;
        }
      }
    }

    return node.parentNode;
  }

  // https://dvcs.w3.org/hg/webcomponents/raw-file/tip/spec/shadow/index.html#event-retargeting
  function retarget(node) {
    var stack = [];  // 1.
    var ancestor = node;  // 2.
    var targets = [];
    while (ancestor) {  // 3.
      var context = null;  // 3.2.
      if (isInsertionPoint(ancestor)) {  // 3.1.
        context = topMostNotInsertionPoint(stack);  // 3.1.1.
        var top = stack[stack.length - 1] || ancestor;  // 3.1.2.
        stack.push(top);
      }
      if (!stack.length)
        stack.push(ancestor);  // 3.3.
      var target = stack[stack.length - 1];  // 3.4.
      targets.push({target: target, ancestor: ancestor});  // 3.5.
      if (isShadowRoot(ancestor))  // 3.6.
        stack.pop();  // 3.6.1.
      ancestor = calculateParent(ancestor, context);
    }
    return targets;
  }

  function topMostNotInsertionPoint(stack) {
    for (var i = stack.length - 1; i >= 0; i--) {
      if (!isInsertionPoint(stack[i]))
        return stack[i];
    }
    return null;
  }

  // https://dvcs.w3.org/hg/webcomponents/raw-file/tip/spec/shadow/index.html#dfn-adjusted-related-target
  function adjustRelatedTarget(target, related) {
    while (target) {  // 3.
      var stack = [];  // 3.1.
      var ancestor = related;  // 3.2.
      var last = undefined;  // 3.3. Needs to be reset every iteration.
      while (ancestor) {
        var context = null;
        if (!stack.length) {
          stack.push(ancestor);
        } else {
          if (isInsertionPoint(ancestor)) {  // 3.4.3.
            context = topMostNotInsertionPoint(stack);
            // isDistributed is more general than checking whether last is
            // assigned into ancestor.
            if (isDistributed(last)) {  // 3.4.3.2.
              var head = stack[stack.length - 1];
              stack.push(head);
            }
          }
        }

        if (inSameTree(ancestor, target))  // 3.4.4.
          return stack[stack.length - 1];

        if (isShadowRoot(ancestor))  // 3.4.5.
          stack.pop();

        last = ancestor;  // 3.4.6.
        ancestor = calculateParent(ancestor, context);  // 3.4.7.
      }
      if (isShadowRoot(target))  // 3.5.
        target = scope.getHostForShadowRoot(target);
      else
        target = target.parentNode;  // 3.6.
    }
  }

  function isDistributed(node) {
    return node.insertionPointParent;
  }

  function inSameTree(a, b) {
    while (true) {
      if (a === b)
        return a !== null;
      if (a)
        a = a.parentNode;
      if (b)
        b = b.parentNode;
    }
  }

  function dispatchOriginalEvent(originalEvent) {
    // Make sure this event is only dispatched once.
    if (handledEventsTable.get(originalEvent))
      return;
    handledEventsTable.set(originalEvent, true);

    var target = wrap(originalEvent.target);
    var event = wrap(originalEvent);
    return dispatchEvent(event, target);
  }

  function dispatchEvent(event, originalWrapperTarget) {
    var eventPath = retarget(originalWrapperTarget);

    if (dispatchCapturing(event, eventPath)) {
      if (dispatchAtTarget(event, eventPath)) {
        dispatchBubbling(event, eventPath);
      }
    }

    eventPhaseTable.set(event, Event.NONE);
    currentTargetTable.set(event, null);

    return event.defaultPrevented;
  }

  function dispatchCapturing(event, eventPath) {
    var phase;

    for (var i = eventPath.length - 1; i > 0; i--) {
      var target = eventPath[i].target;
      var currentTarget = eventPath[i].ancestor;
      if (target === currentTarget)
        phase = Event.AT_TARGET;
      else
        phase = Event.CAPTURING_PHASE;
      if (!invoke(eventPath[i], event, phase))
        return false;
    }

    return true;
  }

  function dispatchAtTarget(event, eventPath) {
    var phase = Event.AT_TARGET;
    return invoke(eventPath[0], event, phase);
  }

  function dispatchBubbling(event, eventPath) {
    if (event.bubbles) {
      var phase = Event.BUBBLING_PHASE;

      for (var i = 1; i < eventPath.length; i++) {
        var target = eventPath[i].target;
        var currentTarget = eventPath[i].ancestor;
        if (target === currentTarget)
          continue
        if (!invoke(eventPath[i], event, phase))
          return false;
      }
    }
    return true;
  }

  function invoke(tuple, event, phase) {
    var target = tuple.target;
    var currentTarget = tuple.ancestor;

    var listeners = listenersTable.get(currentTarget);
    if (!listeners)
      return true;

    if ('relatedTarget' in event) {
      var originalEvent = unwrap(event);
      var relatedTarget = wrap(originalEvent.relatedTarget);

      var adjusted = adjustRelatedTarget(currentTarget, relatedTarget);
      if (adjusted === target)
        return false;

      relatedTargetTable.set(event, adjusted);
    }

    eventPhaseTable.set(event, phase);
    var type = event.type;

    var anyRemoved = false;
    targetTable.set(event, target);
    currentTargetTable.set(event, currentTarget);

    for (var i = 0; i < listeners.length; i++) {
      var listener = listeners[i];
      if (listener.removed) {
        anyRemoved = true;
        continue;
      }

      if (listener.type !== type ||
          !listener.capture && phase === Event.CAPTURING_PHASE ||
          listener.capture && phase === Event.BUBBLING_PHASE) {
        continue;
      }

      try {
        if (typeof listener.handler === 'function')
          listener.handler.call(currentTarget, event);
        else
          listener.handler.handleEvent(event);

        if (stopImmediatePropagationTable.get(event))
          return false;

      } catch (ex) {
        if (window.onerror)
          window.onerror(ex.message);
        else
          console.error(ex);
      }
    }

    if (anyRemoved) {
      var copy = listeners.slice();
      listeners.length = 0;
      for (var i = 0; i < copy.length; i++) {
        if (!copy[i].removed)
          listeners.push(copy[i]);
      }
    }

    return !stopPropagationTable.get(event);
  }

  function Listener(type, handler, capture) {
    this.type = type;
    this.handler = handler;
    this.capture = Boolean(capture);
  }
  Listener.prototype = {
    equals: function(that) {
      return this.handler === that.handler && this.type === that.type &&
          this.capture === that.capture;
    },
    get removed() {
      return this.handler === null;
    },
    remove: function() {
      this.handler = null;
    }
  };

  /**
   * This represents a logical DOM node.
   * @param {!Node} original The original DOM node, aka, the visual DOM node.
   * @constructor
   */
  var WrapperEvent = function Event(original) {
    /**
     * @type {!Event}
     */
    this.impl = original;
  };

  WrapperEvent.prototype = {
    get target() {
      return targetTable.get(this);
    },
    get currentTarget() {
      return currentTargetTable.get(this);
    },
    get eventPhase() {
      return eventPhaseTable.get(this);
    },
    stopPropagation: function() {
      stopPropagationTable.set(this, true);
    },
    stopImmediatePropagation: function() {
      stopPropagationTable.set(this, true);
      stopImmediatePropagationTable.set(this, true);
    }
  };

  registerWrapper(Event, WrapperEvent, document.createEvent('Event'));

  var WrapperUIEvent = function UIEvent(original) {
    WrapperEvent.call(this, original);
  };
  WrapperUIEvent.prototype = Object.create(WrapperEvent.prototype);
  registerWrapper(UIEvent, WrapperUIEvent, document.createEvent('UIEvent'));

  var WrapperMouseEvent = function MouseEvent(original) {
    WrapperUIEvent.call(this, original);
  };
  WrapperMouseEvent.prototype = Object.create(WrapperUIEvent.prototype);
  mixin(WrapperMouseEvent.prototype, {
    get relatedTarget() {
      return relatedTargetTable.get(this);
    }
  });
  registerWrapper(MouseEvent, WrapperMouseEvent,
                  document.createEvent('MouseEvent'));

  var WrapperFocusEvent = function FocusEvent(original) {
    WrapperUIEvent.call(this, original);
  };
  WrapperFocusEvent.prototype = Object.create(WrapperUIEvent.prototype);
  mixin(WrapperFocusEvent.prototype, {
    get relatedTarget() {
      return relatedTargetTable.get(this);
    }
  });
  if (typeof FocusEvent !== 'undefined') {
    registerWrapper(FocusEvent, WrapperFocusEvent,
                    document.createEvent('FocusEvent'));
  }

  function isValidListener(fun) {
    if (typeof fun === 'function')
      return true;
    return fun && fun.handleEvent;
  }

  /**
   * This represents a logical DOM node.
   * @param {!Node} original The original DOM node, aka, the visual DOM node.
   * @constructor
   */
  var WrapperEventTarget = function EventTarget(original) {
    /**
     * @type {!Node}
     */
    this.impl = original;
  };

  var originalAddEventListener = Node.prototype.addEventListener;
  var originalRemoveEventListener = Node.prototype.removeEventListener;
  var originalDispatchEvent = Node.prototype.dispatchEvent;

  function getTargetToListenAt(wrapper) {
    if (wrapper instanceof scope.WrapperShadowRoot)
      wrapper = scope.getHostForShadowRoot(wrapper);
    return unwrap(wrapper);
  }

  WrapperEventTarget.prototype = {
    addEventListener: function(type, fun, capture) {
      if (!isValidListener(fun))
        return;

      var listener = new Listener(type, fun, capture);
      var listeners = listenersTable.get(this);
      if (!listeners) {
        listeners = [];
        listenersTable.set(this, listeners);
      } else {
        // Might have a duplicate.
        for (var i = 0; i < listeners.length; i++) {
          if (listener.equals(listeners[i]))
            return;
        }
      }

      listeners.push(listener);

      originalAddEventListener.call(getTargetToListenAt(this), type,
                                    dispatchOriginalEvent, true);
    },
    removeEventListener: function(type, fun, capture) {
      capture = Boolean(capture);
      var listeners = listenersTable.get(this);
      if (!listeners)
        return;
      var count = 0, found = false;
      for (var i = 0; i < listeners.length; i++) {
        if (listeners[i].type === type && listeners[i].capture === capture) {
          count++;
          if (listeners[i].handler === fun) {
            found = true;
            listeners[i].remove();
          }
        }
      }

      if (found && count === 1) {
        originalRemoveEventListener.call(getTargetToListenAt(this),
                                         type, dispatchOriginalEvent, true);
      }
    },
    dispatchEvent: function(event) {
      return originalDispatchEvent.call(getTargetToListenAt(this),
                                        unwrap(event));
    }
  };

  if (typeof EventTarget !== 'undefined')
    registerWrapper(EventTarget, WrapperEventTarget);

  scope.WrapperEvent = WrapperEvent;
  scope.WrapperEventTarget = WrapperEventTarget;
  scope.WrapperMouseEvent = WrapperMouseEvent;
  scope.adjustRelatedTarget = adjustRelatedTarget;

})(this.ShadowDOMPolyfill);
