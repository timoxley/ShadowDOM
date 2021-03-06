// Copyright 2013 The Toolkitchen Authors. All rights reserved.
// Use of this source code is goverened by a BSD-style
// license that can be found in the LICENSE file.

(function(scope) {
  'use strict';

  var WrapperDocumentFragment = scope.WrapperDocumentFragment;
  var getInnerHTML = scope.getInnerHTML;
  var mixin = scope.mixin;
  var rewrap = scope.rewrap;
  var setInnerHTML = scope.setInnerHTML;
  var unwrap = scope.unwrap;

  var shadowHostTable = new SideTable();

  var WrapperShadowRoot = function ShadowRoot(hostWrapper) {
    var node = unwrap(hostWrapper.impl.ownerDocument.createDocumentFragment());
    WrapperDocumentFragment.call(this, node);

    // createDocumentFragment associates the node with a WrapperDocumentFragment
    // instance. Override that.
    rewrap(node, this);

    var oldShadowRoot = hostWrapper.shadowRoot;
    scope.nextOlderShadowTreeTable.set(this, oldShadowRoot);

    shadowHostTable.set(this, hostWrapper);

    // TODO: are we invalidating on both sides?
    hostWrapper.invalidateShadowRenderer();
  };
  WrapperShadowRoot.prototype = Object.create(WrapperDocumentFragment.prototype);
  mixin(WrapperShadowRoot.prototype, {
    get innerHTML() {
      return getInnerHTML(this);
    },
    set innerHTML(value) {
      setInnerHTML(this, value);
      this.invalidateShadowRenderer();
    },

    invalidateShadowRenderer: function() {
      return shadowHostTable.get(this).invalidateShadowRenderer();
    }
  });

  scope.WrapperShadowRoot = WrapperShadowRoot;
  scope.getHostForShadowRoot = function(node) {
    return shadowHostTable.get(node);
  };
})(this.ShadowDOMPolyfill);