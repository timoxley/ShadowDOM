// Copyright 2012 The Toolkitchen Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var WrapperEventTarget = scope.WrapperEventTarget;
  var WrapperNodeList = scope.WrapperNodeList;
  var addWrapGetter = scope.addWrapGetter;
  var assert = scope.assert;
  var mixin = scope.mixin;
  var registerWrapper = scope.registerWrapper;
  var unwrap = scope.unwrap;
  var wrap = scope.wrap;
  var wrappers = scope.wrappers;

  /**
   * Collects nodes from a DocumentFragment or a Node for removal followed
   * by an insertion.
   *
   * This updates the internal pointers for node, previousNode and nextNode.
   */
  function collectNodes(node, parentNode, previousNode, nextNode) {
    if (node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      if (node.parentNode)
        node.parentNode.removeChild(node);
      node.parentNode_ = parentNode;
      node.previousSibling_ = previousNode;
      node.nextSibling_ = nextNode;
      if (previousNode)
        previousNode.nextSibling_ = node;
      if (nextNode)
        nextNode.previousSibling_ = node;
      return [node];
    }

    var nodes = [];
    var firstChild;
    while (firstChild = node.firstChild) {
      node.removeChild(firstChild);
      nodes.push(firstChild);
      firstChild.parentNode_ = parentNode;
    }

    for (var i = 0; i < nodes.length; i++) {
      nodes[i].previousSibling_ = nodes[i - 1] || previousNode;
      nodes[i].nextSibling_ = nodes[i + 1] || nextNode;
    }

    if (previousNode)
      previousNode.nextSibling_ = nodes[0];
    if (nextNode)
      nextNode.previousSibling_ = nodes[nodes.length - 1];

    return nodes;
  }

  function unwrapNodesForInsertion(nodes) {
    if (nodes.length === 1)
      return unwrap(nodes[0]);

    var df = unwrap(document.createDocumentFragment());
    for (var i = 0; i < nodes.length; i++) {
      df.appendChild(unwrap(nodes[i]));
    }
    return df;
  }

  function removeAllChildNodes(wrapper) {
    var childWrapper = wrapper.firstChild;
    while (childWrapper) {
      assert(childWrapper.parentNode === wrapper);
      var nextSibling = childWrapper.nextSibling;
      var childNode = unwrap(childWrapper);
      childWrapper.previousSibling_ = childWrapper.nextSibling_ = childWrapper.parentNode_ = null;
      var parentNode = childNode.parentNode;
      if (parentNode)
        parentNode.removeChild(childNode);
      childWrapper = nextSibling;
    }
    wrapper.firstChild_ = wrapper.lastChild_ = null;
  }

  var originalNode = Node;

  /**
   * This represents a logical DOM node.
   * @param {!Node} original The original DOM node, aka, the visual DOM node.
   * @constructor
   * @extends {WrapperEventTarget}
   */
  var WrapperNode = function Node(original) {
    assert(original instanceof originalNode);

    WrapperEventTarget.call(this, original);

    // These properties are used to override the visual references with the
    // logical ones. If the value is undefined it means that the logical is the
    // same as the visual.

    /**
     * @type {WrapperNode|undefined}
     * @private
     */
    this.parentNode_ = undefined;

    /**
     * @type {WrapperNode|undefined}
     * @private
     */
    this.firstChild_ = undefined;

    /**
     * @type {WrapperNode|undefined}
     * @private
     */
    this.lastChild_ = undefined;

    /**
     * @type {WrapperNode|undefined}
     * @private
     */
    this.nextSibling_ = undefined;

    /**
     * @type {WrapperNode|undefined}
     * @private
     */
    this.previousSibling_ = undefined;
  };

  WrapperNode.prototype = Object.create(WrapperEventTarget.prototype);
  mixin(WrapperNode.prototype, {
    appendChild: function(childWrapper) {
      assert(childWrapper instanceof WrapperNode);

      this.invalidateShadowRenderer();

      var previousNode = this.lastChild;
      var nextNode = null;
      var nodes = collectNodes(childWrapper, this,
                                        previousNode, nextNode);

      this.lastChild_ = nodes[nodes.length - 1];
      if (!previousNode)
        this.firstChild_ = nodes[0];

      // TODO(arv): It is unclear if we need to update the visual DOM here.
      // A better aproach might be to make sure we only get here for nodes that
      // are related to a shadow host and then invalidate that and re-render
      // the host (on reflow?).
      this.impl.appendChild(unwrapNodesForInsertion(nodes));

      return childWrapper;
    },

    insertBefore: function(childWrapper, refWrapper) {
      // TODO(arv): Unify with appendChild
      if (!refWrapper)
        return this.appendChild(childWrapper);

      assert(childWrapper instanceof WrapperNode);
      assert(refWrapper instanceof WrapperNode);
      assert(refWrapper.parentNode === this);

      this.invalidateShadowRenderer();

      var previousNode = refWrapper.previousSibling;
      var nextNode = refWrapper;
      var nodes = collectNodes(childWrapper, this,
                                        previousNode, nextNode);


      if (this.firstChild === refWrapper)
        this.firstChild_ = nodes[0];

      // insertBefore refWrapper no matter what the parent is?
      var refNode = unwrap(refWrapper);
      var parentNode = refNode.parentNode;
      if (parentNode)
        parentNode.insertBefore(unwrapNodesForInsertion(nodes), refNode);

      return childWrapper;
    },

    removeChild: function(childWrapper) {
      assert(childWrapper instanceof WrapperNode);
      if (childWrapper.parentNode !== this) {
        // TODO(arv): DOMException
        throw new Error('NotFoundError');
      }

      this.invalidateShadowRenderer();

      if (this.firstChild === childWrapper)
        this.firstChild_ = childWrapper.nextSibling;
      if (this.lastChild === childWrapper)
        this.lastChild_ = childWrapper.previousSibling;
      if (childWrapper.previousSibling)
        childWrapper.previousSibling.nextSibling_ = childWrapper.nextSibling;
      if (childWrapper.nextSibling)
        childWrapper.nextSibling.previousSibling_ = childWrapper.previousSibling;

      childWrapper.previousSibling_ = childWrapper.nextSibling_ = childWrapper.parentNode_ = null;

      var childNode = unwrap(childWrapper);
      var parentNode = childNode.parentNode;
      if (parentNode)
        parentNode.removeChild(childNode);

      return childWrapper;
    },

    replaceChild: function(newChildWrapper, oldChildWrapper) {
      assert(newChildWrapper instanceof WrapperNode);
      assert(oldChildWrapper instanceof WrapperNode);

      if (oldChildWrapper.parentNode !== this) {
        // TODO(arv): DOMException
        throw new Error('NotFoundError');
      }

      this.invalidateShadowRenderer();

      var previousNode = oldChildWrapper.previousSibling;
      var nextNode = oldChildWrapper.nextSibling;
      if (nextNode === newChildWrapper)
        nextNode = newChildWrapper.nextSibling;
      var nodes = collectNodes(newChildWrapper, this,
                                        previousNode, nextNode);

      if (this.firstChild === oldChildWrapper)
        this.firstChild_ = nodes[0];
      if (this.lastChild === oldChildWrapper)
        this.lastChild_ = nodes[nodes.length - 1];

      oldChildWrapper.previousSibling_ = null;
      oldChildWrapper.nextSibling_ = null;
      oldChildWrapper.parentNode_ = null;

      // replaceChild no matter what the parent is?
      var oldChildNode = unwrap(oldChildWrapper);
      if (oldChildNode.parentNode) {
        oldChildNode.parentNode.replaceChild(unwrapNodesForInsertion(nodes),
                                             oldChildNode);
      }

      return oldChildWrapper;
    },

    hasChildNodes: function() {
      return this.firstChild === null;
    },

    /** @type {WrapperNode} */
    get parentNode() {
      // If the parentNode has not been overridden, use the original parentNode.
      return this.parentNode_ !== undefined ?
          this.parentNode_ : wrap(this.impl.parentNode);
    },

    /** @type {WrapperNode} */
    get firstChild() {
      return this.firstChild_ !== undefined ?
          this.firstChild_ : wrap(this.impl.firstChild);
    },

    /** @type {WrapperNode} */
    get lastChild() {
      return this.lastChild_ !== undefined ?
          this.lastChild_ : wrap(this.impl.lastChild);
    },

    /** @type {WrapperNode} */
    get nextSibling() {
      return this.nextSibling_ !== undefined ?
          this.nextSibling_ : wrap(this.impl.nextSibling);
    },

    /** @type {WrapperNode} */
    get previousSibling() {
      return this.previousSibling_ !== undefined ?
          this.previousSibling_ : wrap(this.impl.previousSibling);
    },

    get parentElement() {
      var p = this.parentNode;
      while (p && p.nodeType !== Node.ELEMENT_NODE) {
        p = p.parentNode;
      }
      return p;
    },

    get textContent() {
      // TODO(arv): This should fallback to this.impl.textContent if there
      // are no shadow trees below or above the context node.
      var s = '';
      for (var child = this.firstChild; child; child = child.nextSibling) {
        s += child.textContent;
      }
      return s;
    },
    set textContent(textContent) {
      removeAllChildNodes(this);
      this.invalidateShadowRenderer();
      if (textContent !== '') {
        var textNode = this.impl.ownerDocument.createTextNode(textContent);
        this.appendChild(textNode);
      }
    },

    get childNodes() {
      var wrapperList = new WrapperNodeList();
      var i = 0;
      for (var child = this.firstChild; child; child = child.nextSibling) {
        wrapperList[i++] = child;
      }
      wrapperList.length = i;
      return wrapperList;
    },

    cloneNode: function(deep) {
      if (!this.invalidateShadowRenderer())
        return wrap(this.impl.cloneNode(deep));

      var clone = wrap(this.impl.cloneNode(false));
      if (deep) {
        for (var child = this.firstChild; child; child = child.nextSibling) {
          clone.appendChild(child.cloneNode(true));
        }
      }
      // TODO(arv): Some HTML elements also clone other data like value.
      return clone;
    },

    // insertionPointParent is added in ShadowRender.js

    contains: function(child) {
      // TODO(arv): Optimize using ownerDocument etc.
      if (child === this)
        return true;
      var parentNode = child.parentNode;
      if (!parentNode)
        return false;
      return this.contains(parentNode);
    }
  });

  addWrapGetter(WrapperNode, 'ownerDocument');

  // We use a DocumentFragment as a base and then delete the properties of
  // DocumentFragment.prototype from the WrapperNode. Since delete makes objects
  // slow in some JS engines we recreate the prototype object.
  registerWrapper(Node, WrapperNode, document.createDocumentFragment());
  delete WrapperNode.prototype.querySelector;
  delete WrapperNode.prototype.querySelectorAll;
  WrapperNode.prototype =
      mixin(Object.create(WrapperEventTarget.prototype), WrapperNode.prototype);

  scope.WrapperNode = WrapperNode;

})(this.ShadowDOMPolyfill);
