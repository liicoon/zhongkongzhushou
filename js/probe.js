(function () {
  "use strict";
  window.__DOUYIN_PROBE__ = {
    vue: null,       // Vue app instance(s)
    pageType: null,  // detected page type
    products: [],    // pre-scanned products (from network responses)
    network: [],     // captured network calls (sample, for diagnostics)
  };
  var P = window.__DOUYIN_PROBE__;

  // ====================== 1. Sample fetch/XHR for product data ======================
  function isApiCall(url) {
    if (typeof url !== "string") return false;
    // skip the page's own security/metrics endpoints (CORS-failing noise)
    if (/\/\/[^\/]*zijieapi\.com/.test(url)) return false;
    return url.indexOf("/api/") !== -1 || url.indexOf("/v1/") !== -1 || url.indexOf("/v2/") !== -1;
  }

  var origFetch = window.fetch;
  window.fetch = function () {
    var args = arguments;
    var url = (typeof args[0] === "string" ? args[0] : (args[0] && args[0].url)) || "";
    var opts = args[1] || {};

    if (isApiCall(url) && P.network.length < 20) {
      var short = url.replace(/^https?:\/\/[^\/]+/, "");
      var method = (opts.method || "GET").toUpperCase();
      return origFetch.apply(window, args).then(function (r) {
        var clone = r.clone();
        clone.text().then(function (body) {
          try { body = JSON.parse(body); } catch (_) {}
          P.network.push({ url: short, method: method, status: r.status, body: body });
          // extract product info from response
          if (body && typeof body === "object") {
            extractFromResponse(body);
          }
        }).catch(function () {});
        return r;
      });
    }
    return origFetch.apply(window, args);
  };

  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._dy_url = (typeof url === "string") ? url : (url ? "" + url : "");
    this._dy_method = method;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    var xhr = this;
    if (isApiCall(xhr._dy_url) && P.network.length < 20) {
      var short = xhr._dy_url.replace(/^https?:\/\/[^\/]+/, "");
      xhr.addEventListener("load", function () {
        if (xhr.readyState === 4) {
          try {
            var resp = JSON.parse(xhr.responseText);
            P.network.push({ url: short, method: xhr._dy_method, status: xhr.status, body: resp });
            extractFromResponse(resp);
          } catch (_) {}
        }
      });
    }
    return origSend.apply(this, arguments);
  };

  // ====================== 2. Extract product lists from responses ======================
  function extractFromResponse(body) {
    // Dig into response looking for product lists
    function findProducts(obj, depth) {
      if (depth > 4 || !obj || typeof obj !== "object") return null;
      var arr = null;
      if (Array.isArray(obj)) {
        // check if this array has product-like objects
        if (obj.length > 0 && obj[0] && typeof obj[0] === "object") {
          var keys = Object.keys(obj[0]);
          if (keys.some(function (k) { return k.includes("product") || k.includes("goods") || k === "id" || k === "product_id"; }) &&
              keys.some(function (k) { return k.includes("price") || k.includes("stock") || k.includes("name") || k.includes("title"); })) {
            arr = obj;
          }
        }
        if (arr) return arr;
        for (var i = 0; i < obj.length; i++) {
          var r = findProducts(obj[i], depth + 1);
          if (r) return r;
        }
        return null;
      }
      for (var k in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) {
          var r = findProducts(obj[k], depth + 1);
          if (r) return r;
        }
      }
      return null;
    }
    var prods = findProducts(body, 0);
    if (prods && Array.isArray(prods) && prods.length > P.products.length) {
      P.products = prods.map(function (p) { return {
        id: p.product_id || p.id || p.goods_id || p.productId || p.goodsId || "",
        name: p.product_name || p.name || p.title || p.goods_name || p.productName || p.goodsName || "",
        price: p.price || p.product_price || p.market_price || p.sell_price || p.discount_price || "",
        stock: p.stock || p.product_stock || p.quantity || p.stock_num || p.goods_stock || "",
      }; });
    }
  }

  // ====================== 3. Scan Vue instances ======================
  function scanVue() {
    // Common Vue root selectors on Douyin pages
    var selectors = ["#app", "#__nuxt", "#root", "[data-v-app]", ".app", "#__next"];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (!el) continue;
      // Vue 3: el.__vue_app__
      if (el.__vue_app__) {
        P.vue = { version: 3, app: el.__vue_app__ };
        return;
      }
      // Vue 2: el.__vue__ (root)
      if (el.__vue__) {
        P.vue = { version: 2, instance: el.__vue__ };
        return;
      }
    }
    // fallback: scan all elements for __vue__ (old Vue 2 pattern)
    var all = document.querySelectorAll("*");
    for (var j = 0; j < Math.min(all.length, 500); j++) {
      if (all[j].__vue__) {
        P.vue = { version: 2, instance: all[j].__vue__, el: all[j] };
        break;
      }
    }
  }
  scanVue();

  // ====================== 4. Detect page type ======================
  // The extension runs on both Douyin consoles (live control / group-buy control).
  var _ptHost = window.location.host;
  var _ptPath = window.location.pathname || "";
  if (_ptHost === "eos.douyin.com" && _ptPath.indexOf("/livesite/live/current") === 0) {
    P.pageType = "eos-groupon-control";
  } else if (_ptHost === "buyin.jinritemai.com" && _ptPath.indexOf("/dashboard/live/control") === 0) {
    P.pageType = "buyin-control";
  } else {
    P.pageType = "unknown";
  }

  // ====================== 5. Mark ready ======================
  P.ready = true;
})();
