(function () {
  "use strict";

  // ========================================================================
  //  LOGGER
  // ========================================================================
  var log = {
    _el: null,
    _buf: [],
    init: function (el) { this._el = el; this.flush(); },
    flush: function () {
      if (!this._el) return;
      for (var i = 0; i < this._buf.length; i++) this._append(this._buf[i]);
      this._buf = [];
    },
    _append: function (entry) {
      if (!this._el) return void this._buf.push(entry);
      var d = document.createElement("div");
      d.className = "log-line " + entry.level;
      var now = new Date();
      var ts = ("0" + now.getHours()).slice(-2) + ":" + ("0" + now.getMinutes()).slice(-2);
      d.textContent = "[" + ts + "] " + entry.msg;
      this._el.appendChild(d);
      this._el.scrollTop = this._el.scrollHeight;
      console.log("[中控助手][" + ts + "]", entry.msg);
    },
    info: function (m) { this._append({ level: "info", msg: m }); },
    ok: function (m) { this._append({ level: "success", msg: m }); },
    warn: function (m) { this._append({ level: "warn", msg: "[WARN] " + m }); },
    err: function (m) { this._append({ level: "error", msg: "[ERR] " + m }); },
  };

  // ========================================================================
  //  UTILITIES
  // ========================================================================
  var Utils = {
    sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },

    // trigger Vue/React synthetic input
    triggerVueInput: function (el, value) {
      if (!el) return;
      var tag = el.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea") {
        // Use the correct prototype setter based on element type
        var proto = tag === "textarea" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(proto, "value");
        try {
          if (setter && setter.set) setter.set.call(el, value);
          else el.value = value;
        } catch (_) {
          el.value = value;
        }
      } else {
        el.textContent = value;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },

    // click an element using multiple strategies
    clickEl: function (el) {
      if (!el) return false;
      try { el.click(); return true; } catch (_) {}
      try {
        var evt = new MouseEvent("click", { bubbles: true, cancelable: true });
        el.dispatchEvent(evt); return true;
      } catch (_) { return false; }
    },

    // 回车发送（keydown/keypress/keyup 三连，兼容只监听其中一种的组件）
    pressEnter: function (el) {
      if (!el) return false;
      var types = ["keydown", "keypress", "keyup"];
      for (var i = 0; i < types.length; i++) {
        try {
          el.dispatchEvent(new KeyboardEvent(types[i], {
            key: "Enter", code: "Enter", keyCode: 13, which: 13,
            bubbles: true, cancelable: true,
          }));
        } catch (_) {}
      }
      return true;
    },

    // 元素是否可见（隐藏标签页/折叠面板要能区分出来）
    isVisible: function (el) {
      if (!el) return false;
      return el.offsetParent !== null || el.getClientRects().length > 0;
    },

    // check if text matches an explain button (not "求讲解" or other false matches)
    isExplainBtnText: function (text) {
      return text === "讲解" || text === "自动讲解" || text === "取消讲解";
    },

    // parse product indices string like "1-15,18,20" → [0,1,...,14,17,19] (0-based)
    // returns null when input is empty (meaning "all products")
    parseIndices: function (str, maxCount) {
      if (!str || !str.trim()) return null;
      var result = [];
      var parts = str.split(",");
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i].trim();
        var range = part.split("-");
        if (range.length === 2) {
          var start = parseInt(range[0], 10);
          var end = parseInt(range[1], 10);
          if (!isNaN(start) && !isNaN(end) && start <= end) {
            for (var j = start; j <= end; j++) result.push(j);
          }
        } else {
          var num = parseInt(part, 10);
          if (!isNaN(num)) result.push(num);
        }
      }
      // convert 1-based to 0-based and filter out-of-range
      result = result.map(function (v) { return v - 1; }).filter(function (v) {
        return v >= 0 && (maxCount === undefined || v < maxCount);
      });
      // deduplicate and sort
      var seen = {};
      return result.filter(function (v) { return seen[v] ? false : (seen[v] = true); }).sort(function (a, b) { return a - b; });
    },
  };

  // ========================================================================
  //  SITE PROFILE – 多站点适配（直播中控台 / 团购中控台）
  //  两个站点的前端组件库完全不同，用"站点档案"把差异集中收口在这里，
  //  其余模块只问 Site 是哪个站，不散落 host 判断：
  //    buyin  buyin.jinritemai.com/dashboard/live/control  商品=goodsItem 行（全量渲染）
  //    eos    eos.douyin.com/livesite/live/current         商品=虚拟滚动 list-wrap，评论=评论区
  // ========================================================================
  var Site = {
    _id: null,
    PROFILES: [
      { id: "buyin", host: "buyin.jinritemai.com", path: "/dashboard/live/control", label: "直播中控台" },
      { id: "eos", host: "eos.douyin.com", path: "/livesite/live/current", label: "团购中控台" },
    ],
    detect: function () {
      if (this._id) return this._id;
      var host = window.location.host;
      var path = window.location.pathname || "";
      this._id = "unknown";
      for (var i = 0; i < this.PROFILES.length; i++) {
        var p = this.PROFILES[i];
        if (host === p.host && path.indexOf(p.path) === 0) { this._id = p.id; break; }
      }
      return this._id;
    },
    isEos: function () { return this.detect() === "eos"; },
    supported: function () { return this.detect() !== "unknown"; },
    label: function () {
      var id = this.detect();
      for (var i = 0; i < this.PROFILES.length; i++) {
        if (this.PROFILES[i].id === id) return this.PROFILES[i].label;
      }
      return "未知站点";
    },
  };

  // ========================================================================
  //  PROBE ADAPTER – reads window.__DOUYIN_PROBE__ results
  // ========================================================================
  var Probe = {
    data: null,
    ready: function () {
      this.data = window.__DOUYIN_PROBE__ || {};
      return this.data.ready === true;
    },
    getProducts: function () {
      return (this.data && this.data.products) || [];
    },
    getPageType: function () {
      return (this.data && this.data.pageType) || "unknown";
    },
    getNetwork: function () {
      return (this.data && this.data.network) || [];
    },
    hasVue: function () {
      return !!(this.data && this.data.vue);
    },
    getVue: function () {
      return (this.data && this.data.vue) || null;
    },
  };

  // ========================================================================
  //  PAGE CONNECTOR – interacts with Douyin live control page
  // ========================================================================
  var PageAPI = {
    _cache: { products: [], lastScan: 0 },

    // ---------- Product discovery ----------
    // Scan DOM for product rows; cache the result briefly.
    // ONLY rows that actually contain an "讲解" button are treated as products —
    // loose row selectors otherwise pick up nav items / settings rows, which was
    // the root cause of wrong product lists.
    scanProducts: function () {
      var now = Date.now();
      if (now - this._cache.lastScan < 1000) return this._cache.products;
      this._cache.lastScan = now;

      // eos（团购中控台）商品列表是虚拟滚动，扫描逻辑完全不同 → 走独立分支
      if (Site.isEos()) return this._scanProductsEos();

      var products = [];
      var seen = {};

      // Strategy 1: DOM rows that have an explain button
      var rows = this._collectRows();
      var scanIndex = 0;
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var btn = this._findExplainBtnInRow(row);
        if (!btn) continue; // not a product row → skip

        var key = row.getAttribute("data-product-id") || row.getAttribute("data-id") || row.getAttribute("data-rbd-draggable-id") || "";
        var name = extractProductName(row);
        if (!key) key = name || ("row_" + r);
        if (key && seen[key]) continue;
        if (key) seen[key] = true;

        products.push({
          id: key,
          name: name,
          price: "",
          stock: "",
          row: row,
          explainBtn: btn,
          scanIndex: scanIndex, // positional fallback for re-location
        });
        scanIndex++;
      }

      // Strategy 2: fallback to probe pre-scanned products (network capture).
      // Only used when the DOM scan found nothing (e.g. list not rendered yet).
      if (products.length === 0) {
        var probeProds = Probe.getProducts();
        for (var i = 0; i < probeProds.length; i++) {
          var p = probeProds[i];
          if (p.id && !seen[p.id]) {
            seen[p.id] = true;
            products.push({ id: p.id, name: p.name, price: p.price, stock: p.stock });
          }
        }
      }

      // Strategy 3: page-wide fallback — walk up from every "讲解" button to its
      // row. Runs only when container-scoped scanning found nothing (e.g. the
      // page renamed its list container classes). Buttons are far fewer than all
      // elements, so this stays cheap.
      if (products.length === 0) {
        var btns = document.querySelectorAll(
          "button.lvc2-grey-btn, button[class*='grey-btn'], button, span, a, div[role='button']"
        );
        var seenRows = {};
        var scanIndex3 = 0;
        for (var b = 0; b < btns.length; b++) {
          var t3 = (btns[b].textContent || "").trim();
          if (!Utils.isExplainBtnText(t3)) continue;
          var row3 = btns[b].closest("[class*='goods-item'], [class*='goodsItem'], [class*='goods_item']") ||
            btns[b].closest("tr") ||
            btns[b].closest("[class*='row']") ||
            btns[b].closest("[class*='item'], [class*='Item']") ||
            btns[b].parentElement;
          if (!row3) continue;
          if (row3.offsetParent === null && row3.getClientRects().length === 0) continue; // hidden panel
          if (seenRows[row3._dy_id]) continue;
          seenRows[row3._dy_id || (row3._dy_id = "row_" + Math.random().toString(36).slice(2))] = true;
          var key3 = row3.getAttribute("data-product-id") || row3.getAttribute("data-id") || row3.getAttribute("data-rbd-draggable-id") || "";
          var name3 = extractProductName(row3);
          if (!key3) key3 = name3 || ("row_" + b);
          if (key3 && seen[key3]) continue;
          if (key3) seen[key3] = true;
          products.push({
            id: key3,
            name: name3,
            price: "",
            stock: "",
            row: row3,
            explainBtn: btns[b],
            scanIndex: scanIndex3,
          });
          scanIndex3++;
        }
      }

      this._cache.products = products;
      return products;

      // does the text look like a metrics/summary blob rather than a product name?
      // (e.g. "¥2.60到手价0告出¥0.00成交金额0.00%曝光成交率")
      function isLikelyMetrics(text) {
        var hits = ["到手价", "成交", "金额", "曝光", "转化", "销量", "观看", "订单",
          "佣金", "退款", "退货", "库存", "价格", "优惠", "利润", "人气", "点击",
          "件数", "客单", "讲解"];
        var n = 0;
        for (var i = 0; i < hits.length; i++) {
          if (text.indexOf(hits[i]) !== -1) n++;
        }
        return n >= 2 || /^[¥￥\d]/.test(text);
      }

      // extract the product name from a row
      function extractProductName(row) {
        var best = "";
        // 1. structured candidates: name/title classes, img alt, link titles
        var structured = row.querySelectorAll(
          "[class*='product-name'], [class*='goods-name'], [class*='name'], [class*='title'], a[title], img[alt]"
        );
        for (var s = 0; s < structured.length; s++) {
          var st = (structured[s].getAttribute("alt") || structured[s].getAttribute("title") || structured[s].textContent || "").trim();
          if (st.length >= 2 && /[\u4e00-\u9fa5]/.test(st) && !isLikelyMetrics(st) && st.length > best.length) {
            best = st;
          }
        }
        if (best) return best;
        // 2. cell heuristic
        var cells = row.querySelectorAll("td, [class*='cell'], [class*='col']");
        for (var c = 0; c < cells.length; c++) {
          var cell = cells[c];
          var t = (cell.textContent || "").trim();
          if (t.length < 2) continue;
          if (cell.querySelector("button")) continue; // action-button cell
          if (t === "讲解" || t === "自动讲解" || t === "取消讲解") continue;
          if (t.indexOf("讲解") !== -1 && t.length <= 6) continue; // e.g. "语音讲解"
          if (/^[\d.,%¥$￥\s+-]+$/.test(t)) continue; // pure numbers / prices
          if (/[\u4e00-\u9fa5]/.test(t) && !isLikelyMetrics(t) && t.length > best.length) best = t;
          else if (!best && t.length > best.length && !isLikelyMetrics(t)) best = t;
        }
        // 3. fallback only if it doesn't look like metrics garbage
        if (!best) {
          var fb = (row.textContent || "").substring(0, 60).trim();
          return isLikelyMetrics(fb) ? "" : fb;
        }
        return best;
      }
    },

    // Force a fresh re-scan, bypassing the short cache
    forceScan: function () {
      this._cache.lastScan = 0;
      return this.scanProducts();
    },

    // Find candidate product row elements, scoped to product-ish containers.
    // Scoping avoids a full-page querySelectorAll on busy live pages.
    _collectContainers: function () {
      var selectors = [
        // lvc2 component library (used by the live control page)
        "[class*='lvc2'] [class*='list']",
        "[class*='lvc2'] [class*='table']",
        "[class*='lvc2'] [class*='body']",
        // generic product/goods containers
        "[class*='product'] [class*='list']",
        "[class*='goods'] [class*='list']",
        "[class*='product'] [class*='table']",
        "[class*='goods'] [class*='table']",
        "[class*='table']",
        "[class*='list']",
      ];
      var found = [];
      for (var i = 0; i < selectors.length; i++) {
        var els = document.querySelectorAll(selectors[i]);
        for (var j = 0; j < els.length && j < 30; j++) {
          if (els[j].isConnected) found.push(els[j]);
        }
      }
      // keep only outermost containers (skip ones nested inside another)
      return found.filter(function (c, idx, arr) {
        for (var k = 0; k < arr.length; k++) {
          if (k !== idx && arr[k] !== c && arr[k].contains && arr[k].contains(c)) return false;
        }
        return true;
      }).slice(0, 10);
    },

    // Collect goods rows. Known page structure (from DevTools):
    //   <div class="goodsItem-xxxx rpa_lc__live-goods__goods-item"
    //        data-rbd-draggable-id="3753668893483336118" ...>
    // The whole list is rendered (absolute-positioned rows, NOT virtualized),
    // so a page-wide class match is both fast and reliable.
    _collectRows: function () {
      var rows = [];
      var exact = document.querySelectorAll(
        "[class*='goods-item'], [class*='goodsItem'], [class*='goods_item']"
      );
      for (var i = 0; i < exact.length; i++) {
        var el = exact[i];
        if (!el.isConnected) continue;
        // skip rows inside hidden panels/tabs — they would corrupt the product
        // order and cause mismatched name / button / sequence
        if (el.offsetParent === null && el.getClientRects().length === 0) continue;
        rows.push(el);
      }
      if (rows.length > 0) return rows;
      // fallback: scoped container scan
      var containers = this._collectContainers();
      for (var c = 0; c < containers.length; c++) {
        var els = containers[c].querySelectorAll(
          "tr, [class*='row'], [class*='item'], [class*='Item'], [class*='goods']"
        );
        for (var r = 0; r < els.length; r++) {
          if (!els[r].isConnected) continue;
          if (els[r].offsetParent === null && els[r].getClientRects().length === 0) continue;
          rows.push(els[r]);
        }
      }
      return rows;
    },

    // Find the "讲解" button inside a row.
    // Known page structure (from DevTools):
    //   <button class="lvc2-grey-btn ..." style="...">讲解</button>
    _findExplainBtnInRow: function (row) {
      if (!row || !row.querySelectorAll) return null;
      // eos（团购中控台）：讲解按钮是 div[class*='talking-btn']（不是 button，
      // 通用扫描抓不到），用专属选择器一步定位；取不到即说明该行不是商品行
      if (Site.isEos()) return this.eosExplainBtn(row);
      // 1. known component class first (most reliable)
      var known = row.querySelectorAll("button.lvc2-grey-btn, button[class*='grey-btn'], button[class*='GreyBtn']");
      for (var i = 0; i < known.length; i++) {
        var t0 = (known[i].textContent || "").trim();
        if (Utils.isExplainBtnText(t0)) return known[i];
      }
      // 2. general text scan
      var els = row.querySelectorAll("button, span, a, div[role='button']");
      for (var j = 0; j < els.length; j++) {
        var t = (els[j].textContent || "").trim();
        if (Utils.isExplainBtnText(t)) return els[j];
      }
      // 3. look for title attribute or aria-label
      for (var k = 0; k < els.length; k++) {
        var label = els[k].getAttribute("title") || els[k].getAttribute("aria-label") || "";
        if (label.indexOf("讲解") !== -1 && label.indexOf("取消") === -1) return els[k];
      }
      return null;
    },

    // ---------- eos（团购中控台）: 团购商品列表（虚拟滚动） ----------
    // 实测结构（2026-09-14，主人贴的真实 DOM）：
    //   div#live-card-list > div.list-wrap-afHxzG
    //   └── div(style: height:633px; overflow:auto)          ← 滚动容器（视口）
    //       └── div(style: height: 总行数 × 行高)             ← 内容高度容器（912px）
    //           └── div[data-rfd-draggable-id][data-index]    ← 一行（绝对定位，height:152）
    //               ├── [class*='drag-number'] input.sort-input-*   ← 序号（maxlength=2，1-based）
    //               ├── [class*='card-name'] [class*='render-1']    ← 商品名
    //               │   （同名文本还有 [class*='fictitious-*'] 量宽副本，不能用）
    //               ├── [class*='poi-'] [class*='render-nXrSFh']    ← 门店名"汉中市周大黑…"
    //               ├── [class*='operate-area'] [class*='talking-btn'] [class*='talking-word']
    //               │                                                ← "讲解" / "取消讲解"
    //               └── [class*='stats-'] 曝光/点击/支付订单数/销售额
    // 总行数推算已实测对齐：912 ÷ 152 = 6，与筛选标签「全部(6)」一致 ✓
    // 注意 operate-area 与 stats 是 render-item-* 的兄弟节点，仍在行 div 内 → row.querySelector 可达
    _EOS_ROW_H: 152,

    // 商品面板容器：实测带稳定 id `div#live-card-list`（优先），无 id 时退回 list-wrap 哈希类
    eosWrapEl: function () {
      return document.querySelector("#live-card-list") ||
             document.querySelector("[class*='list-wrap']");
    },

    // 列表区信息：滚动容器 / 内容容器 / 行高 / 总行数
    eosList: function () {
      var wrap = this.eosWrapEl();
      var row = (wrap || document).querySelector("[data-rfd-draggable-id]");
      if (!row) return null;
      if (!wrap) wrap = row.closest("[class*='list-wrap']") || document.body;
      var inner = row.parentElement;                      // 内容高度容器
      var scroller = inner ? inner.parentElement : null;  // 滚动容器
      var rowH = parseFloat(row.style.height) || this._EOS_ROW_H;
      var total = 0;
      if (inner && inner.style && inner.style.height) {
        var h = parseFloat(inner.style.height);
        if (h > 0) total = Math.round(h / rowH);
      }
      // 用已渲染行的最大 data-index 修正总行数（内容高度可能尚未更新）
      var drawn = (wrap || document).querySelectorAll("[data-rfd-draggable-id]");
      for (var i = 0; i < drawn.length; i++) {
        var di = parseInt(drawn[i].getAttribute("data-index"), 10);
        if (!isNaN(di) && di + 1 > total) total = di + 1;
      }
      return { wrap: wrap, scroller: scroller, inner: inner, rowHeight: rowH, total: total };
    },

    // 已渲染（可视区）的行，按 data-index 升序
    eosRows: function () {
      var scope = this.eosWrapEl() || document;
      var list = scope.querySelectorAll("[data-rfd-draggable-id]");
      var out = [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].isConnected) out.push(list[i]);
      }
      out.sort(function (a, b) {
        return (parseInt(a.getAttribute("data-index"), 10) || 0) -
               (parseInt(b.getAttribute("data-index"), 10) || 0);
      });
      return out;
    },

    // 按 data-index 找"当前在 DOM 中"的行（虚拟列表里未渲染的行取不到）
    eosFindRow: function (index) {
      var rows = this.eosRows();
      for (var i = 0; i < rows.length; i++) {
        if (parseInt(rows[i].getAttribute("data-index"), 10) === index) return rows[i];
      }
      return null;
    },

    // 滚动列表让指定行进入可视区（虚拟列表必须先渲染才能点得到）
    eosScrollTo: function (index) {
      if (this.eosFindRow(index)) return true; // 已渲染，无需滚动
      var info = this.eosList();
      if (!info || !info.scroller) return false;
      try {
        info.scroller.scrollTop = index * info.rowHeight;
        return true;
      } catch (_) { return false; }
    },

    // 商品名：优先 card-name 内的 render-*（fictitious-* 是量宽用的重复副本）
    eosName: function (row) {
      if (!row || !row.querySelector) return "";
      var el = row.querySelector("[class*='card-name'] [class*='render-1']") ||
               row.querySelector("[class*='card-name']");
      return el ? (el.textContent || "").trim().slice(0, 80) : "";
    },

    // 讲解按钮：div[class*='talking-btn']，文本 "讲解"（未讲解）/ "取消讲解"（讲解中）
    eosExplainBtn: function (row) {
      if (!row || !row.querySelector) return null;
      var btn = row.querySelector("[class*='talking-btn']");
      // 兜底：若操作区与卡片平级（不在行内），仅在"父级只含这一行"时使用，避免取到别行的按钮
      if (!btn && row.parentElement &&
          row.parentElement.querySelectorAll("[data-rfd-draggable-id]").length === 1) {
        btn = row.parentElement.querySelector("[class*='talking-btn']");
      }
      if (!btn) return null;
      return (btn.textContent || "").indexOf("讲解") !== -1 ? btn : null;
    },

    // eos 商品扫描：以 data-index 为主键；未渲染的行补占位项，
    // 让"序号过滤"覆盖整个列表（点击前会自动滚动渲染，见 _eosEnsureRow）
    _scanProductsEos: function () {
      var rows = this.eosRows();
      var byIndex = {};
      var rendered = 0;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var btn = this.eosExplainBtn(row);
        if (!btn) continue; // 不是商品行
        var idx = parseInt(row.getAttribute("data-index"), 10);
        if (isNaN(idx)) idx = rendered;
        byIndex[idx] = {
          id: row.getAttribute("aria-label") || row.getAttribute("data-rfd-draggable-id") || ("eos_" + idx),
          name: this.eosName(row),
          price: "",
          stock: "",
          row: row,
          explainBtn: btn,
          eosIndex: idx,
          scanIndex: idx,
          rendered: true,
        };
        rendered++;
      }

      var info = this.eosList();
      var maxIdx = -1;
      for (var k in byIndex) {
        if (byIndex.hasOwnProperty(k)) {
          var ki = parseInt(k, 10);
          if (ki > maxIdx) maxIdx = ki;
        }
      }
      var total = Math.max(info ? info.total : 0, maxIdx + 1, rendered);
      var products = [];
      for (var j = 0; j < total; j++) {
        if (byIndex[j]) products.push(byIndex[j]);
        else {
          // 未渲染的占位项：名称留空，点击前滚动渲染后再补
          products.push({
            id: "eos_" + j, name: "", price: "", stock: "",
            row: null, explainBtn: null, eosIndex: j, scanIndex: j, rendered: false,
          });
        }
      }
      this._cache.products = products;
      return products;
    },

    // 行是否仍在 DOM 且能取到讲解按钮
    _isRowLive: function (product) {
      return !!(product && product.row && product.row.isConnected && this.eosExplainBtn(product.row));
    },

    // eos：确保目标行已在 DOM 中（必要时滚动 + 等渲染），返回 Promise<row>
    _eosEnsureRow: function (product) {
      var self = this;
      var idx = product.eosIndex;
      var row = this.eosFindRow(idx);
      if (row) return Promise.resolve(row);
      this.eosScrollTo(idx);
      return Utils.sleep(350).then(function () {
        var r = self.eosFindRow(idx);
        if (r) return r;
        // 二次校正：虚拟列表首次滚动后位置可能被修正
        self.eosScrollTo(idx);
        return Utils.sleep(350).then(function () { return self.eosFindRow(idx); });
      });
    },

    // ---------- Auto Explain ----------
    // Click a product's "讲解" button.
    // The button text changes while explaining (取消讲解 / 讲解中 / 已讲解 …).
    // Any text that still references 讲解 identifies it as an explain button;
    // an already-explaining state is treated as success so we never toggle OFF.
    clickExplain: function (product) {
      // eos（虚拟列表）：目标行未渲染时先滚动渲染、等一帧再点击 → 返回 Promise<boolean>
      if (Site.isEos() && product && typeof product.eosIndex === "number" && !this._isRowLive(product)) {
        var self = this;
        return this._eosEnsureRow(product).then(function (row) {
          if (!row) return false;
          if (!product.name) product.name = self.eosName(row); // 占位项在渲染后补名
          var b = self.eosExplainBtn(row);
          if (!b) return false;
          product.row = row;
          product.explainBtn = b;
          var tt = (b.textContent || "").trim();
          if (tt.indexOf("取消") !== -1) return true; // 已在讲解中 → 视为成功，不反向关掉
          return Utils.clickEl(b);
        });
      }
      var btn = this._locateExplainBtn(product);
      if (!btn) return false;
      var t = (btn.textContent || "").trim();
      var label = btn.getAttribute("title") || btn.getAttribute("aria-label") || "";
      // identify as an explain button; exclude other explain modes (语音讲解 / AI讲解)
      var isExplain = Utils.isExplainBtnText(t) ||
        (t.indexOf("讲解") !== -1 && t.indexOf("语音") === -1 && t.indexOf("AI") === -1) ||
        label.indexOf("讲解") !== -1;
      if (!isExplain) return false;
      // already explaining → treat as success, do not toggle it off
      if (t.indexOf("取消") !== -1 || t.indexOf("停止") !== -1 || t.indexOf("结束") !== -1 ||
          t.indexOf("讲解中") !== -1 || t.indexOf("已讲解") !== -1 ||
          label.indexOf("取消") !== -1) {
        return true;
      }
      return Utils.clickEl(btn);
    },

    // Click "取消讲解" — used by single-product mode to pause explaining.
    // No-op success when the product is not currently explaining.
    cancelExplain: function (product) {
      // eos（虚拟列表）：同上，先确保目标行已渲染 → 返回 Promise<boolean>
      if (Site.isEos() && product && typeof product.eosIndex === "number" && !this._isRowLive(product)) {
        var self2 = this;
        return this._eosEnsureRow(product).then(function (row) {
          if (!row) return false;
          if (!product.name) product.name = self2.eosName(row);
          var b = self2.eosExplainBtn(row);
          if (!b) return false;
          product.row = row;
          product.explainBtn = b;
          var tt = (b.textContent || "").trim();
          if (tt.indexOf("取消") === -1) return true; // 本来就没在讲解 → 视为成功
          return Utils.clickEl(b);
        });
      }
      var btn = this._locateExplainBtn(product);
      if (!btn) return false;
      var t = (btn.textContent || "").trim();
      var label = btn.getAttribute("title") || btn.getAttribute("aria-label") || "";
      var isExplain = Utils.isExplainBtnText(t) ||
        (t.indexOf("讲解") !== -1 && t.indexOf("语音") === -1 && t.indexOf("AI") === -1) ||
        label.indexOf("讲解") !== -1;
      if (!isExplain) return false;
      // not explaining → nothing to cancel, treat as success
      if (t.indexOf("取消") === -1 && t.indexOf("停止") === -1 && t.indexOf("结束") === -1 &&
          t.indexOf("讲解中") === -1 && t.indexOf("已讲解") === -1 &&
          label.indexOf("取消") === -1) {
        return true;
      }
      return Utils.clickEl(btn);
    },

    // locate the explain button, re-scanning when cached DOM refs went stale
    _locateExplainBtn: function (product) {
      // 1. cached button still attached to the document
      if (product.explainBtn && product.explainBtn.isConnected) return product.explainBtn;
      // 2. cached row still attached → search inside it
      if (product.row && product.row.isConnected) {
        var btn2 = this._findExplainBtnInRow(product.row);
        if (btn2) return (product.explainBtn = btn2);
      }
      // 3. row went stale (SPA re-render) → re-locate the row by product id/name
      var row = this._locateRow(product);
      if (row) {
        product.row = row;
        product.explainBtn = null;
        return this._locateExplainBtn(product);
      }
      return null;
    },

    // Re-locate a product row: by id → by name → by positional index.
    // Positional fallback matters because names extracted from metric-heavy rows
    // are unreliable after the SPA re-renders numbers mid-live.
    _locateRow: function (product) {
      // eos（虚拟列表）：data-index 是唯一可靠定位键，直接取当前已渲染的目标行
      if (Site.isEos() && product && typeof product.eosIndex === "number") {
        return this.eosFindRow(product.eosIndex);
      }
      var rows = [];
      var allRows = this._collectRows();
      for (var i = 0; i < allRows.length; i++) {
        if (this._findExplainBtnInRow(allRows[i])) rows.push(allRows[i]);
      }
      var id = product && product.id;
      var name = product && product.name;
      var idx = product && product.scanIndex;
      if (id) {
        for (var a = 0; a < rows.length; a++) {
          var rid = rows[a].getAttribute("data-product-id") || rows[a].getAttribute("data-id") || rows[a].getAttribute("data-rbd-draggable-id") || "";
          if (rid && rid === id) return rows[a];
        }
      }
      if (name) {
        for (var b = 0; b < rows.length; b++) {
          if ((rows[b].textContent || "").indexOf(name) !== -1) return rows[b];
        }
      }
      if (typeof idx === "number" && rows[idx]) return rows[idx];
      return null;
    },

    // ---------- Auto Comment ----------

    // eos 评论输入框定位。实测真实结构（2026-09-14，含商品面板对照）：
    //   评论区：div.comment-wrap-sJwP1r
    //           └── div.input-wrap-j6Z8oG > div.text-area-CyjKXV
    //               ├── div.text-input-SqqLWx > textarea.input-EghOjQ
    //               │     placeholder="输入评论，Enter键发送"  maxlength=50
    //               └── div.button-Wc1yvW 「发送」（空输入时带 button-disable-*）
    //   商品面板（必须避开，实测两类误命中）：
    //     #live-card-list [class*='list-wrap'] 内
    //       ├── input.sort-input-Knhzky  序号框（maxlength=2）
    //       └── input[placeholder='搜索商品名称或ID']
    //           外层是 okee-current-live-input-wrapper —— 同样含 "input-wrap" 子串，
    //           会被 [class*='input-wrap'] 命中（"input-wrapper" 包含 "input-wrap"）
    _findEosCommentInput: function () {
      // 0. 评论区外壳精确命中（comment-wrap 是评论区面板真实外壳，最可靠）
      var shell = document.querySelector("[class*='comment-wrap']");
      if (shell) {
        var inShell = shell.querySelector("textarea");
        if (inShell && Utils.isVisible(inShell)) return inShell;
      }
      var list = document.getElementById("comment_all_tab_list_container");
      var scope = list;
      for (var up = 0; up < 4 && scope && scope.parentElement; up++) scope = scope.parentElement;
      if (!scope) scope = document;
      // 1. 实测结构：text-area / input-wrap 内的 textarea（限定在评论区 scope 内，不外溢到商品面板）
      var wrap = (scope.querySelector && scope.querySelector("[class*='text-area']")) ||
                 (scope.querySelector && scope.querySelector("[class*='input-wrap']"));
      if (wrap) {
        var direct = wrap.querySelector("textarea");
        if (direct && Utils.isVisible(direct)) return direct;
      }
      // 2. placeholder 兜底（"输入评论，Enter键发送"）
      var byPh = document.querySelector("textarea[placeholder*='评论']");
      if (byPh && Utils.isVisible(byPh)) return byPh;
      // 3. 面板内启发式扫描（跳过商品面板 / 搜索框 / 序号框）
      var cands = scope.querySelectorAll(
        "textarea, input[type='text'], input:not([type]), [contenteditable='true']"
      );
      for (var i = 0; i < cands.length; i++) {
        var el = cands[i];
        if (el.offsetParent === null && el.getClientRects().length === 0) continue; // 不可见
        if (el.closest && (el.closest("#live-card-list") || el.closest("[class*='list-wrap']"))) continue;
        if ((el.getAttribute("placeholder") || "").indexOf("搜索") !== -1) continue; // 商品搜索框
        var ml = el.getAttribute("maxlength");
        if (ml && parseInt(ml, 10) <= 4) continue;                                   // 序号框
        if (el.disabled || el.readOnly) continue;
        return el;
      }
      return null;
    },

    findCommentInput: function () {
      // eos（团购中控台）：只认评论区专属定位 —— 该站的输入框结构已实测确认。
      // 刻意不回退到下面的通用选择器：商品面板的"搜索商品名称或ID"框 class 是
      // okee-current-live-input，会被 [class*='input'] 系列命中 → 回复会被打进商品搜索框，
      // 比"找不到输入框"更糟（会静默改掉运营看到的商品列表）。
      // 定位失败时返回 null，由 sendComment 打 warn 留痕，主人按日志贴 DOM 再适配。
      if (Site.isEos()) {
        var eosInput = this._findEosCommentInput();
        if (!eosInput) log.warn("未找到评论输入框（评论区面板是否收起？）");
        return eosInput || null;
      }
      // Look for chat input area
      var selectors = [
        "textarea[class*='chat']", "textarea[class*='comment']",
        "textarea[class*='message']", "textarea[class*='input']",
        "input[class*='chat']", "input[class*='comment']",
        "input[class*='message']", "div[contenteditable='true']",
        "[class*='chat-input'] input", "[class*='chat-input'] textarea",
        "[class*='comment-input'] input", "[class*='comment-input'] textarea",
        "[class*='input-area'] textarea", "[class*='input-area'] input",
        // Douyin-specific selectors for live chat
        "[class*='webcast'] textarea", "[class*='webcast'] input",
        "[class*='webcast'] div[contenteditable]",
        "[class*='chat'] div[contenteditable]",
        "[class*='message-input']", "#message-input",
        "[class*='input-container'] textarea",
        "[class*='input-container'] input",
        "[class*='input-container'] div[contenteditable]",
      ];
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el && el.offsetParent !== null) return el;
      }
      // fallback: find any visible textarea
      var textareas = document.querySelectorAll("textarea");
      for (var j = 0; j < textareas.length; j++) {
        if (textareas[j].offsetParent !== null) return textareas[j];
      }
      // fallback: find any visible input
      var inputs = document.querySelectorAll("input:not([type='hidden'])");
      for (var k = 0; k < inputs.length; k++) {
        if (inputs[k].offsetParent !== null) return inputs[k];
      }
      return null;
    },

    findSendButton: function (input) {
      var texts = ["发送", "Send", "发布", "提交", "➤", "发"];

      // Strategy 0（eos 团购中控台）：发送按钮是与输入框同级的 div.button-Wc1yvW（不是 button）。
      // 坑：不能直接 document.querySelector("[class*='input-wrap']") —— 商品面板的搜索框 / 序号框
      // 外层是 okee-current-live-input-wrapper，同样含 "input-wrap" 子串且在文档里更靠前，
      // 会先命中它（实测踩到）。因此必须从"已定位到的评论输入框"往上找它自己的面板：
      //   div.input-wrap-j6Z8oG > div.text-area-CyjKXV > { div.text-input-SqqLWx, div.button-Wc1yvW }
      if (Site.isEos()) {
        var eosIn = input || this._findEosCommentInput();
        var eosScope = (eosIn && eosIn.closest)
          ? (eosIn.closest("[class*='text-area']") || eosIn.closest("[class*='input-wrap']"))
          : null;
        for (var eu = 0; eu < 4 && eosScope; eu++) {
          var eosBtn = eosScope.querySelector("[class*='button-']");
          if (eosBtn && (eosBtn.textContent || "").trim().indexOf("发送") !== -1) return eosBtn;
          eosScope = eosScope.parentElement;
        }
      }

      // Strategy 1: search near the chat input (most reliable)
      if (!input) input = this.findCommentInput();
      if (input) {
        // walk up from input through 5 levels of parent to find the chat container
        var container = input.parentElement;
        for (var s = 0; s < 5 && container; s++) {
          if (!container.querySelectorAll) { container = container.parentElement; continue; }
          // 1a: look for inputSuffix class elements (Douyin's send button)
          var suffix = container.querySelectorAll("[class*='inputSuffix'], [class*='input-suffix']");
          for (var i = 0; i < suffix.length; i++) {
            var t = (suffix[i].textContent || "").trim();
            if (t && suffix[i].offsetParent !== null && suffix[i].offsetWidth < 200) {
              for (var j = 0; j < texts.length; j++) {
                if (t === texts[j] || t.includes(texts[j])) return suffix[i];
              }
            }
          }
          // 1b: scan all children for matching text, prefer small elements
          var all = container.querySelectorAll("button, [class*='send'], [class*='btn'], [class*='inputSuffix'], a, div");
          var best = null;
          for (var k = 0; k < all.length; k++) {
            var t2 = (all[k].textContent || "").trim();
            var w = all[k].offsetWidth || 0;
            if (t2 && all[k].offsetParent !== null && w > 0 && w < 200) {
              for (var m = 0; m < texts.length; m++) {
                if (t2 === texts[m] || t2.includes(texts[m])) {
                  if (!best || w < (best.offsetWidth || 999)) best = all[k];
                }
              }
            }
          }
          if (best) return best;
          container = container.parentElement;
        }
      }

      // Strategy 2: global search for inputSuffix elements (specific class match)
      var suffix2 = document.querySelectorAll("[class*='inputSuffix'], [class*='input-suffix']");
      for (var i2 = 0; i2 < suffix2.length; i2++) {
        var t3 = (suffix2[i2].textContent || "").trim();
        if (t3 && suffix2[i2].offsetParent !== null && suffix2[i2].offsetWidth < 200) {
          for (var j2 = 0; j2 < texts.length; j2++) {
            if (t3 === texts[j2] || t3.includes(texts[j2])) return suffix2[i2];
          }
        }
      }

      // Strategy 3: global search for button-like send elements
      var btns = document.querySelectorAll(
        "button[class*='send'], button[class*='chat'], " +
        "button[class*='comment'], [class*='send-btn'], " +
        "[class*='btn-send'], [class*='btn_chat'], " +
        "[class*='webcast'] button"
      );
      for (var i3 = 0; i3 < btns.length; i3++) {
        var t4 = (btns[i3].textContent || "").trim();
        if (t4 && btns[i3].offsetParent !== null && btns[i3].offsetWidth < 200) {
          for (var j3 = 0; j3 < texts.length; j3++) {
            if (t4 === texts[j3] || t4.includes(texts[j3])) return btns[i3];
          }
        }
      }

      return null;
    },

    sendComment: function (text) {
      var input = this.findCommentInput();
      if (!input) {
        log.warn("未找到聊天输入框");
        return false;
      }
      // 输入框有 maxlength 时（eos 评论区实测 = 50）超长内容页面不接受 → 先截断并留痕，
      // 否则会表现为"点了发送但评论没出来"，很难排查
      var maxLen = parseInt(input.getAttribute("maxlength"), 10);
      if (!isNaN(maxLen) && maxLen > 0 && text.length > maxLen) {
        log.warn("回复超过输入框上限 " + maxLen + " 字，已截断：" + text);
        text = text.slice(0, maxLen);
      }
      Utils.triggerVueInput(input, text);
      // 记录本次发送文本，供弹幕监听识别"自己发的弹幕"（60s 窗口内忽略）
      this._rememberSent(text);

      // eos（团购中控台）专有流程：发送按钮是 div.button-*，空输入时带禁用态 class
      // （button-disable-*），而 Vue 的禁用态在 nextTick 后才更新 → 填完立刻点可能点在禁用按钮上。
      // 因此等一拍再点；若按钮仍禁用则退回 Enter（真实 placeholder 明确「Enter键发送」）。
      // 最后由"输入框是否被清空"判断是否真的发出（只在没发出时才补动作，避免重复发送）。
      if (Site.isEos()) {
        var selfEos = this;
        Utils.sleep(150).then(function () {
          var btnEos = selfEos.findSendButton(input);
          if (btnEos && !selfEos._isSendDisabled(btnEos)) Utils.clickEl(btnEos);
          else Utils.pressEnter(input);
          return Utils.sleep(600);
        }).then(function () {
          var el2 = selfEos.findCommentInput();
          if (el2 && String(el2.value || "").trim()) log.warn("评论可能未发出，输入框仍有内容");
        });
        return true;
      }

      // Strategy 1: try clicking the send button immediately
      var sendBtn = this.findSendButton();
      if (sendBtn) {
        Utils.clickEl(sendBtn);
        return true;
      }

      // Strategy 2: async - wait for framework to process input, then try Enter
      // (one send action only — no blind "click anything nearby" fallback, which
      // could double-send or trigger the wrong control)
      Utils.sleep(300).then(function () {
        try {
          var btn = PageAPI.findSendButton();
          if (btn) { Utils.clickEl(btn); return; }
          Utils.pressEnter(input);
        } catch (e) {
          console.error("[中控助手] sendComment async error:", e);
        }
      });
      return true;
    },

    // 输入框字数上限（取不到返回 0 = 未知）。eos 评论区实测 maxlength=50
    commentMaxLength: function () {
      var el = this.findCommentInput();
      var n = el ? parseInt(el.getAttribute("maxlength"), 10) : NaN;
      return isNaN(n) || n <= 0 ? 0 : n;
    },

    // 发送按钮是否处于禁用态（eos 用 class 表达禁用：button-disable-*）
    _isSendDisabled: function (el) {
      if (!el) return true;
      var cls = typeof el.className === "string" ? el.className : "";
      return el.disabled === true ||
             el.getAttribute("aria-disabled") === "true" ||
             cls.indexOf("disable") !== -1;
    },

    // ---------- 最近发送记录（识别"自己发的弹幕"，避免自触发循环） ----------
    // 所有经 sendComment 发送的内容（自动发评/弹幕回复/跨标签页 comment）都会记录文本指纹，
    // 弹幕监听在 60s 窗口内看到相同文本时视为"自己发的"，直接忽略。
    _sentTextAt: {},
    _rememberSent: function (text) {
      if (!text) return;
      // 记录多种形式：原文 + 去"@昵称 "前缀（弹幕区显示时可能带"主播我："等前缀）
      var forms = [text, text.replace(/^@\S+\s*/, "")];
      for (var i = 0; i < forms.length; i++) {
        var fp = forms[i].slice(0, 60);
        if (fp) this._sentTextAt[fp] = Date.now();
      }
      var keys = Object.keys(this._sentTextAt);
      if (keys.length > 300) {
        var cutoff = Date.now() - 60000;
        for (var j = 0; j < keys.length; j++) {
          if (this._sentTextAt[keys[j]] < cutoff) delete this._sentTextAt[keys[j]];
        }
      }
    },
    _isRecentlySent: function (text) {
      if (!text) return false;
      var fp = text.slice(0, 60);
      var t = this._sentTextAt[fp] || 0;
      if (Date.now() - t < 60000) return true;
      delete this._sentTextAt[fp]; // 懒惰清理过期记录
      return false;
    },

    // ---------- Danmaku (弹幕监听) ----------
    _danmakuCache: { container: null, checkedAt: 0 },

    _cls: function (el) {
      return (el && typeof el.className === "string") ? el.className : "";
    },

    // 弹幕容器打分：结构越像"弹幕列表"得分越高（多行 + 昵称元素 + 可滚动）
    _scoreDanmakuContainer: function (el) {
      if (!el || el.nodeType !== 1) return -Infinity;
      // 不可见 → 直接排除
      if (el.offsetParent === null && el.getClientRects().length === 0) return -Infinity;
      if (el.children.length < 2 || el.children.length > 300) return -Infinity;
      var cs;
      try { cs = window.getComputedStyle(el); } catch (_) { return -Infinity; }
      var scrollable = /(auto|scroll)/.test((cs.overflowY || "") + (cs.overflow || ""));
      var score = 0;
      if (scrollable) score += 5;
      var cls = (this._cls(el) + " " + (el.id || "")).toLowerCase();
      if (/product|goods|table|menu|header|footer|toolbar|nav|sidebar/.test(cls)) score -= 6;
      if (/chat|comment|message|danmaku|barrage|interact|webcast|live/.test(cls)) score += 3;
      var rowLike = 0, hasInput = 0, hasProduct = 0;
      var kids = el.children;
      for (var j = 0; j < Math.min(kids.length, 20); j++) {
        var c = kids[j];
        var t = (c.textContent || "").trim();
        if (!t || t.length > 200 || c.querySelector("input, textarea, button")) {
          if (c.querySelector("input, textarea")) hasInput++;
          continue;
        }
        var ccls = (this._cls(c) + " " + (c.id || "")).toLowerCase();
        if (/nickname|user|avatar|name/.test(ccls)) score += 2;
        else if (t.indexOf(":") !== -1 || t.indexOf("：") !== -1) score += 1;
        if (/[¥￥]/.test(t) && /price|cost|stock/.test(ccls)) { hasProduct++; continue; }
        rowLike++;
      }
      if (rowLike >= 2) score += 3;
      if (hasInput > 0) score -= 8;
      if (hasProduct > 0) score -= 8;
      return score;
    },

    // 定位弹幕列表容器（5s 缓存 + 自愈重试）
    findDanmakuContainer: function (force) {
      var now = Date.now();
      // eos（团购中控台）：评论区列表有稳定 id，直接取（比结构打分更可靠）
      if (Site.isEos()) {
        var eosListEl = document.getElementById("comment_all_tab_list_container");
        if (eosListEl) {
          // 评论区所在标签页/面板被隐藏时，脚本照跑但一条弹幕也看不到 →
          // 提示一次（60s 节流），避免主人误以为"扩展坏了"
          if (!Utils.isVisible(eosListEl) && now - (this._eosHiddenWarnAt || 0) > 60000) {
            this._eosHiddenWarnAt = now;
            log.warn("评论区当前不可见（请切到「全部」标签页或展开评论管理），弹幕监听暂不生效");
          }
          this._danmakuCache.container = eosListEl;
          this._danmakuCache.checkedAt = now;
          return eosListEl;
        }
      }
      var cached = this._danmakuCache.container;
      if (!force && cached && cached.isConnected && now - this._danmakuCache.checkedAt < 5000) {
        return cached;
      }
      var best = null, bestScore = 0;
      // 策略1: 特征 class 候选（弹幕/聊天/消息/互动列表）
      var sel = "[class*='chat-list'],[class*='chatList'],[class*='chat_list']," +
        "[class*='comment-list'],[class*='commentList'],[class*='comment_list']," +
        "[class*='message-list'],[class*='messageList'],[class*='message_list']," +
        "[class*='danmaku'],[class*='barrage'],[class*='interact-list']," +
        "[class*='interactList'],[class*='interact_list'],[class*='webcast'] [class*='list']";
      var list = document.querySelectorAll(sel);
      for (var i = 0; i < list.length; i++) {
        var s = this._scoreDanmakuContainer(list[i]);
        if (s > bestScore) { bestScore = s; best = list[i]; }
      }
      // 策略2: 可见滚动容器兜底（限制扫描数量避免卡顿）
      if (!best) {
        var scrollers = document.querySelectorAll("div");
        var checked = 0;
        for (var k = 0; k < scrollers.length && checked < 400; k++) {
          var el = scrollers[k];
          if (el.children.length < 2 || el.children.length > 300) continue;
          checked++;
          var s2 = this._scoreDanmakuContainer(el);
          if (s2 > bestScore) { bestScore = s2; best = el; }
        }
      }
      this._danmakuCache.container = best || null;
      this._danmakuCache.checkedAt = now;
      return best;
    },

    // 从一条弹幕 DOM 节点提取 {text, nickname, content, core, isSelf}
    // 中控台弹幕行结构：commentItem > nickname(含 tag 分类徽章) + description(内容文本)
    extractDanmaku: function (node) {
      if (!node || node.nodeType !== 1) return null;
      // eos（团购中控台）评论区是另一套结构 → 走专属提取
      if (Site.isEos()) return this._extractDanmakuEos(node);
      var t = (node.textContent || "").trim();
      if (!t || t.length > 200) return null;

      // 1) 内容：优先取 description 子元素（干净文本，不含昵称/分类徽章）
      var descEl = node.querySelector("[class*='description']");
      var content = descEl ? (descEl.textContent || "").trim() : "";
      if (!content) content = t;

      // 2) 昵称：nickname 区去掉分类徽章(tag)后的剩余文本，再去尾部冒号
      var nickname = "";
      var nickEl = node.querySelector("[class*='nickname']");
      if (nickEl) {
        nickname = (nickEl.textContent || "").trim();
        var tags = nickEl.querySelectorAll("[class*='tag']");
        for (var i = 0; i < tags.length; i++) {
          var tagText = (tags[i].textContent || "").trim();
          if (tagText) nickname = nickname.split(tagText).join("");
        }
        nickname = nickname.replace(/[：:\s]+$/, "").trim().slice(0, 40);
      }
      // 兜底：从全文解析 "昵称：内容"
      if (!nickname) {
        var m = t.match(/^(.{1,40}?)[：:]\s*(.+)$/);
        if (m) nickname = m[1];
      }
      var nickInfo = this._cleanNickname(nickname);
      return {
        text: t,
        nickname: nickInfo.name,
        content: content,
        core: this._extractCore(content),
        isSelf: nickInfo.isSelf,
      };
    },

    // ---- eos（团购中控台）评论区行提取 ----
    // 实测结构（2026-09-14）：
    //   div.item-*
    //   ├── span.tag-*           ← 系统标签（如"可能选品难"），不是昵称
    //   ├── div.item-name-*      ← "昵称："（含尾部全角冒号）
    //   └── div.item-content-*   ← 内容；系统消息（"xx浏览直播货架中"）没有此元素
    _extractDanmakuEos: function (node) {
      var nameEl = node.querySelector("[class*='item-name']");
      if (!nameEl) return null;                                   // 不是评论行
      var contentEl = node.querySelector("[class*='item-content']");
      var content = contentEl ? (contentEl.textContent || "").trim() : "";
      if (!content) return null;                                  // 系统消息 → 跳过
      if (content.length > 200) return null;
      var nickname = (nameEl.textContent || "").trim()
        .replace(/[：:\s]+$/, "")                                 // 去尾部冒号（全角/半角）
        .slice(0, 40);
      var nickInfo = this._cleanNickname(nickname);
      return {
        text: nickname + "：" + content,
        nickname: nickInfo.name,
        content: content,
        core: this._extractCore(content),
        isSelf: nickInfo.isSelf,
      };
    },

    // 常见中控台消息分类标签（"问询"等不是用户昵称）
    _MSG_TAGS: ["问询", "咨询", "求购", "售后", "投诉", "粉丝团", "关注", "点赞", "进入直播间", "进入直播", "连麦", "打赏", "分享", "评论"],

    _escRe: function (s) {
      return (s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    },

    // 去掉文本开头的分类标签（如 "问询：xxx" → "xxx"）
    _stripTags: function (s) {
      var out = (s || "").trim();
      for (var i = 0; i < this._MSG_TAGS.length; i++) {
        var re = new RegExp("^" + this._escRe(this._MSG_TAGS[i]) + "[·：:\\s]*");
        if (re.test(out)) { out = out.replace(re, ""); break; }
      }
      return out;
    },

    // 提取弹幕核心内容：去分类标签 → 去"昵称："前缀 → 去"@昵称"前缀
    // 同一弹幕被多个 DOM 层级捕获时文本不同，但核心内容一致，用它做去重指纹
    _extractCore: function (t) {
      var s = this._stripTags(t);
      s = s.replace(/^.{1,40}?[：:]\s*/, "");
      s = s.replace(/^@\S+\s*/, "");
      return s.trim();
    },

    // 清洗昵称：去分类标签、身份标记；返回 {name, isSelf}
    _cleanNickname: function (nick) {
      var result = { name: "", isSelf: false };
      var raw = (nick || "").trim().slice(0, 40);
      if (!raw) return result;
      for (var i = 0; i < this._MSG_TAGS.length; i++) {
        if (raw.indexOf(this._MSG_TAGS[i]) === 0) { raw = raw.slice(this._MSG_TAGS[i].length); break; }
      }
      // "我"/"主播我" → 主播自己发的消息（自问自答场景，应跳过）
      var selfOnly = raw.replace(/^(主播|管理员|助理)[·\s]*/, "");
      if (selfOnly === "我" || raw === "我") result.isSelf = true;
      // eos：评论区不显示"我"，自己的消息显示为店铺账号名 → 用门店名反查
      if (!result.isSelf && this._isOwnStoreName(raw)) result.isSelf = true;
      result.name = raw.trim().slice(0, 40);
      return result;
    },

    // 本店名缓存（eos）：从团购商品卡的门店名节点读取
    _eosStoreName: "",
    _eosStoreNameAt: 0,

    // eos：评论昵称是否就是本店账号（自己发的评论不该触发自动回复）
    _isOwnStoreName: function (nick) {
      if (!Site.isEos()) return false;
      if (!this._eosStoreName || Date.now() - this._eosStoreNameAt > 30000) {
        // 门店名节点带 render-* 哈希类；实测它位于商品卡的门店行内：
        //   [class*='poi-'] > [class*='text-leGBEX'] > [class*='render-nXrSFh']
        // 先按实测结构精确命中；再退回全局扫描，并排除商品名节点（card-name 内）的候选，
        // 否则商品行同名类会把"商品名"误当门店名
        var storeExact = document.querySelector("[class*='poi-'] [class*='render-nXrSFh']");
        var picked = storeExact ? (storeExact.textContent || "").trim() : "";
        if (!picked) {
          var cands = document.querySelectorAll("[class*='render-nXrSFh'], [class*='fictitious-gAsHPZ']");
          for (var ci = 0; ci < cands.length; ci++) {
            if (cands[ci].closest && cands[ci].closest("[class*='card-name']")) continue;
            picked = (cands[ci].textContent || "").trim();
            if (picked) break;
          }
        }
        if (!picked) log.warn("未识别到本店门店名，自身评论可能被当作观众触发回复");
        this._eosStoreName = picked;
        this._eosStoreNameAt = Date.now();
      }
      var store = this._eosStoreName;
      // 评论区昵称可能是门店名的子串（门店名带市名"汉中市…"，评论区不带）→ 双向包含判定
      if (!store || !nick || nick.length < 4) return false;
      return store.indexOf(nick) !== -1 || nick.indexOf(store) !== -1;
    },

    // 弹幕列表的真实滚动层（子容器），让 mutation 粒度更接近"弹幕行"；找不到返回原容器
    _resolveListContainer: function (container) {
      if (!container) return null;
      // eos：评论区容器本身就是行级列表（子元素即评论行），不要往下钻
      if (Site.isEos()) return container;
      if (this._scoreDanmakuContainer(container) >= 10) return container;
      var best = null, bestScore = 0;
      for (var i = 0; i < container.children.length; i++) {
        var c = container.children[i];
        var s = this._scoreDanmakuContainer(c);
        if (s > bestScore) { bestScore = s; best = c; }
      }
      return best || container;
    },

    // 诊断：把候选弹幕/评论区容器信息输出到控制台，方便适配页面结构变化
    dumpDanmakuCandidates: function () {
      try {
        var cands = document.querySelectorAll(
          "[class*='chat'],[class*='message'],[class*='comment'],[class*='danmaku']," +
          "[class*='interact'],[class*='webcast'],[id*='comment'],[id*='chat'],[id*='message']"
        );
        var lines = [];
        for (var i = 0; i < Math.min(cands.length, 30); i++) {
          var el = cands[i];
          lines.push(el.tagName.toLowerCase() +
            (el.id ? ("#" + el.id) : ("." + this._cls(el).split(" ").slice(0, 3).join("."))) +
            " 子元素:" + el.children.length);
        }
        console.log("[中控助手] 候选容器:", lines);
      } catch (_) {}
    },
  };

  // ========================================================================
  //  AUTO EXPLAIN MODULE
  // ========================================================================
  var AutoExplain = {
    running: false,
    _timer: null,
    _order: [],        // current round: products in play order
    _orderIndex: 0,    // progress within the current round
    _filtered: null,
    _failCount: 0,
    _rounds: 0,
    _singleMode: false, // only 1 product → alternate explain ↔ pause
    _phase: "explain",  // "explain" | "pause" (single-product mode)

    config: {
      interval: 15,        // seconds between products / explain duration (single mode)
      randomDelay: 5,      // extra random seconds (±)
      shuffle: false,      // randomize product order every round
      // Single-product mode pauses for a fixed 3s (not configurable).
      // Always loops through products (repeat is intrinsic, no UI toggle).
    },

    start: function (indicesStr) {
      if (this.running) return;
      var allProducts = PageAPI.scanProducts();
      if (allProducts.length === 0) {
        log.warn("未扫描到商品，请确认已在直播中控台页面");
        return;
      }
      this.running = true;
      this._orderIndex = 0;
      this._filtered = null;
      this._failCount = 0;
      this._rounds = 0;
      this._singleMode = false;
      this._phase = "explain";

      // parse and filter by indices
      var products;
      if (indicesStr && indicesStr.trim()) {
        var indices = Utils.parseIndices(indicesStr, allProducts.length);
        if (!indices || indices.length === 0) {
          log.warn("指定的商品序号无效");
          this.running = false;
          return;
        }
        products = [];
        for (var i = 0; i < indices.length; i++) {
          if (indices[i] < allProducts.length) products.push(allProducts[indices[i]]);
        }
        this._filtered = products; // keep the filtered list for every round
        log.info("已选择 " + products.length + " 个商品（序号过滤）");
      } else {
        products = allProducts.slice();
      }

      this._order = this._buildOrder(products);
      log.ok("自动讲解已启动，共 " + this._order.length + " 个商品，间隔 " +
        this.config.interval + "s ± " + this.config.randomDelay + "s" +
        (this.config.shuffle ? "，打乱顺序" : "，按序号顺序"));
      this._doNext();
    },

    stop: function () {
      this.running = false;
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      log.info("自动讲解已停止");
    },

    // build the play order for one round: sequential, or Fisher–Yates shuffled
    _buildOrder: function (products) {
      var order = products.slice();
      if (!this.config.shuffle || order.length < 2) return order;
      for (var i = order.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = order[i]; order[i] = order[j]; order[j] = t;
      }
      return order;
    },

    _doNext: function () {
      if (!this.running) return;
      try {
        // start of a new round → (re)build the play order from a fresh scan
        if (this._order.length === 0) {
          var all = this._filtered || PageAPI.scanProducts();
          if (!all || all.length === 0) {
            if (this._filtered) {
              log.warn("指定商品列表为空，停止");
              this.stop();
            } else {
              log.warn("商品列表为空，重试中...");
              this._timer = setTimeout(this._doNext.bind(this), 5000);
            }
            return;
          }
          this._order = this._buildOrder(all);
          this._orderIndex = 0;
          // single selected product → alternate explain ↔ pause every cycle
          this._singleMode = all.length === 1;
          this._phase = "explain";
          log.info("扫描到 " + all.length + " 个商品，本轮开始" +
            (this._singleMode ? "（单商品模式）" : ""));
          if (this._singleMode) {
            log.info("单商品轮播: 讲解 " + this.config.interval + "s ± " + this.config.randomDelay +
              "s，暂停固定 5s");
          }
          if (this._rounds > 0) {
            log.info("完成一轮，重新开始" + (this.config.shuffle ? "（已重新打乱顺序）" : ""));
          }
        }

        var product = this._order[this._orderIndex];
        if (!product) {
          this._orderIndex++;
          this._scheduleNext();
          return;
        }

        var pname = product.name || "未知商品";
        var pid = product.id || "?";

        // ---- single-product mode: explain → pause → explain → …
        // 注：eos 虚拟列表场景下 clickExplain/cancelExplain 返回 Promise（先滚动渲染再点击），
        // 这里统一用 Promise.resolve 兼容同步/异步两种返回值
        if (this._singleMode) {
          var selfSingle = this;
          var wasExplain = this._phase === "explain";
          if (wasExplain) {
            log.info("讲解: " + pname + " [ID:" + pid + "]");
            this._phase = "pause";
          } else {
            log.info("暂停: " + pname + " [ID:" + pid + "]");
            this._phase = "explain";
          }
          var action = wasExplain
            ? PageAPI.clickExplain(product)
            : PageAPI.cancelExplain(product);
          Promise.resolve(action).then(function (ok1) {
            if (!selfSingle.running) return;
            if (ok1) {
              selfSingle._failCount = 0;
              log.ok((wasExplain ? "已点击讲解: " : "已取消讲解: ") + pname + " [ID:" + pid + "]");
            } else {
              selfSingle._failCount++;
              log.warn((wasExplain ? "未找到讲解按钮: " : "取消讲解失败: ") + pname + " [ID:" + pid + "]");
            }
            if (selfSingle._failCount >= 3) {
              log.err("连续 3 次操作失败，自动停止（页面结构可能已变化，请刷新后重试）");
              selfSingle.stop();
              return;
            }
            // 讲解阶段 → 按 interval；暂停阶段 → 固定 5s 后再讲解
            if (wasExplain) selfSingle._scheduleNext(selfSingle.config.interval);
            else selfSingle._timer = setTimeout(selfSingle._doNext.bind(selfSingle), 5000);
          });
          return;
        }

        // ---- multi-product mode: explain each product in order
        var selfMulti = this;
        log.info("讲解: " + pname + " [ID:" + pid + "]");
        Promise.resolve(PageAPI.clickExplain(product)).then(function (ok) {
          if (!selfMulti.running) return;
          if (ok) {
            selfMulti._failCount = 0;
            log.ok("已点击讲解: " + pname + " [ID:" + pid + "]");
          } else {
            selfMulti._failCount++;
            log.warn("未找到讲解按钮: " + pname + " [ID:" + pid + "]");
            if (selfMulti._failCount >= 3) {
              log.err("连续 3 次操作失败，自动停止（页面结构可能已变化，请刷新后重试）");
              selfMulti.stop();
              return;
            }
          }
          selfMulti._orderIndex++;
          if (selfMulti._orderIndex >= selfMulti._order.length) {
            selfMulti._order = []; // round complete → rebuilt with a fresh scan next time
            selfMulti._rounds++;
          }
          selfMulti._scheduleNext();
        });
      } catch (e) {
        log.err("自动讲解出错: " + (e && e.message));
        this._failCount++;
        if (this._failCount >= 3) { this.stop(); return; }
        this._scheduleNext();
      }
    },

    _scheduleNext: function (baseInterval) {
      if (!this.running) return;
      if (baseInterval === undefined) baseInterval = this.config.interval;
      // delay = baseInterval ± randomDelay (seconds), clamped to >= 1s
      var jitter = (Math.random() * 2 - 1) * this.config.randomDelay;
      var delay = Math.max((baseInterval + jitter) * 1000, 1000);
      this._timer = setTimeout(this._doNext.bind(this), delay);
    },

    setConfig: function (cfg) {
      for (var k in cfg) {
        if (this.config.hasOwnProperty(k)) this.config[k] = cfg[k];
      }
    },
  };

  // ========================================================================
  //  AUTO COMMENT MODULE
  // ========================================================================
  var AutoComment = {
    running: false,
    _timer: null,
    _msgIndex: 0,
    _failCount: 0,

    config: {
      interval: 30,       // seconds between messages
      randomDelay: 10,    // extra random seconds
      messages: ["欢迎来到直播间！", "主播加油！"], // default templates
      shuffle: false,
    },

    start: function () {
      if (this.running) return;
      if (!this.config.messages || this.config.messages.length === 0) {
        log.warn("请先添加评论内容");
        return;
      }
      this.running = true;
      this._msgIndex = 0;
      this._failCount = 0;
      log.ok("自动发评已启动，共 " + this.config.messages.length + " 条消息，间隔 " + this.config.interval + "s ± " + this.config.randomDelay + "s");
      this._doNext();
    },

    stop: function () {
      this.running = false;
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      log.info("自动发评已停止");
    },

    _doNext: function () {
      try {
        if (!this.running) return;
        var msgs = this.config.messages;
        if (msgs.length === 0) { this.stop(); return; }

        var idx = this._msgIndex % msgs.length;
        var text = msgs[idx];
        if (this.config.shuffle) {
          idx = Math.floor(Math.random() * msgs.length);
          text = msgs[idx];
        }

        var ok = PageAPI.sendComment(text);
        if (ok) {
          this._failCount = 0;
          log.ok("已发送: " + text.substring(0, 30));
        } else {
          this._failCount++;
          log.warn("发送失败，未找到聊天输入框和发送按钮");
          if (this._failCount >= 3) {
            log.err("连续 3 次发送失败，自动停止（页面结构可能已变化，请刷新后重试）");
            this.stop();
            return;
          }
        }

        this._msgIndex++;
        this._scheduleNext();
      } catch (e) {
        log.err("自动发评出错: " + e.message);
        this._failCount++;
        if (this._failCount >= 3) { this.stop(); return; }
        this._scheduleNext();
      }
    },

    _scheduleNext: function () {
      if (!this.running) return;
      // delay = interval ± randomDelay (seconds), clamped to >= 1s
      var jitter = (Math.random() * 2 - 1) * this.config.randomDelay;
      var delay = Math.max((this.config.interval + jitter) * 1000, 1000);
      this._timer = setTimeout(this._doNext.bind(this), delay);
    },

    setConfig: function (cfg) {
      for (var k in cfg) {
        if (this.config.hasOwnProperty(k)) this.config[k] = cfg[k];
      }
    },
  };

  // ========================================================================
  //  AUTO REPLY MODULE – 弹幕关键词自动回复
  //  监听直播间弹幕列表（DOM MutationObserver），命中关键词 → 自动发送设定回复。
  //  复用 PageAPI.sendComment；内置文本去重/同用户冷却/每分钟限频/随机延迟，防风控。
  // ========================================================================
  var AutoReply = {
    running: false,
    _observer: null,
    _container: null,
    _healthTimer: null,
    _lastTextAt: {},      // 文本指纹 → 时间戳（8s 窗口去重，同一弹幕只触发一次）
    _lastUserAt: {},      // 昵称 → 时间戳（同用户冷却）
    _queue: [],           // 待发送队列，串行发送防止输入框内容互相覆盖
    _sending: false,
    _sentThisMinute: [],  // 每分钟发送时间戳（滑动窗口限频）
    _matchedCount: 0,
    _repliedCount: 0,
    _failCount: 0,

    config: {
      delayMin: 1,        // 命中后随机延迟下限（秒）——后台默认，不暴露 UI
      delayMax: 2,        // 上限（秒）
      userCooldown: 60,   // 同一用户冷却（秒）
      maxPerMinute: 6,    // 每分钟最多回复条数（防风控）
      useNickname: true,  // 回复内容中的 {nickname} 替换为对方昵称（默认开启）
    },

    rules: [],            // [{keywords: [...], reply: "...", enabled: true}]

    start: function () {
      if (this.running) return;
      if (!this.rules || this.rules.length === 0) {
        log.warn("弹幕回复：请先配置关键词规则（每行：关键词|关键词 => 回复内容）");
        return;
      }
      var container = PageAPI.findDanmakuContainer(true);
      if (!container) {
        log.err("弹幕回复：未找到" + (Site.isEos() ? "评论区" : "弹幕") + "列表容器，请确认" +
          (Site.isEos() ? "团购中控台的评论区标签页已打开" : "直播中控台聊天区已打开"));
        PageAPI.dumpDanmakuCandidates();
        log.warn("候选容器信息已输出到控制台(F12)，把截图反馈给我即可适配");
        return;
      }
      this.running = true;
      this._container = PageAPI._resolveListContainer(container) || container;
      this._lastTextAt = {};
      this._lastUserAt = {};
      this._queue = [];
      this._sending = false;
      this._sentThisMinute = [];
      this._matchedCount = 0;
      this._repliedCount = 0;
      this._failCount = 0;

      this._observer = new MutationObserver(this._onMutation.bind(this));
      this._observer.observe(this._container, { childList: true, subtree: true });
      this._healthTimer = setInterval(this._healthCheck.bind(this), 10000);
      log.ok("弹幕回复已启动，监听中（命中关键词自动回复）");
      log.info("弹幕容器: <" + this._container.tagName.toLowerCase() + (PageAPI._cls(this._container) ? " class='" + PageAPI._cls(this._container).slice(0, 60) + "'" : "") + ">");
      log.info("规则 " + this.rules.length + " 条，命中后延迟 " + this.config.delayMin + "~" + this.config.delayMax + "s 回复，同用户冷却 " + this.config.userCooldown + "s，上限 " + this.config.maxPerMinute + " 条/分钟");
    },

    stop: function () {
      this.running = false;
      if (this._observer) { this._observer.disconnect(); this._observer = null; }
      if (this._healthTimer) { clearInterval(this._healthTimer); this._healthTimer = null; }
      this._container = null;
      this._queue = [];
      this._sending = false;
      log.info("弹幕回复已停止");
    },

    setConfig: function (cfg) {
      for (var k in cfg) {
        if (this.config.hasOwnProperty(k)) this.config[k] = cfg[k];
      }
    },

    setRules: function (rules) { this.rules = rules || []; },

    getStats: function () {
      return { running: this.running, matched: this._matchedCount, replied: this._repliedCount };
    },

    _onMutation: function (mutations) {
      if (!this.running) return;
      for (var m = 0; m < mutations.length; m++) {
        var added = mutations[m].addedNodes;
        if (!added || added.length === 0) continue;
        for (var n = 0; n < added.length; n++) {
          var node = added[n];
          if (node.nodeType !== 1) continue;
          this._handleNode(node);
          // 有些弹幕列表新增的是包裹容器，展开一层子节点再检查
          if (node.children && node.children.length > 0 && node.children.length <= 5) {
            for (var c = 0; c < node.children.length; c++) {
              if (node.children[c].nodeType === 1) this._handleNode(node.children[c]);
            }
          }
        }
      }
    },

    _handleNode: function (node) {
      // eos 评论区是 Vue 整块渲染：新增节点常常是"装着十几行的包裹容器"，
      // 此时直接提取会取到"第一行的昵称 + 后面某一行的内容"这种错配 →
      // 先把它拆成一行一行再处理（行本身命中时不做递归，避免自循环）
      if (Site.isEos()) {
        var listEl = PageAPI.findDanmakuContainer();
        var nameEls = node.querySelectorAll("[class*='item-name']");
        if (nameEls.length > 0 && listEl && listEl.contains(node)) {
          var expanded = false;
          for (var ri = 0; ri < nameEls.length; ri++) {
            // 行 = 昵称节点向上走到"父节点就是评论容器"的那一层
            // （不能用 closest('[class*=item-]')：item-name-*/item-content-* 也以 item- 开头）
            var rowEl = nameEls[ri];
            while (rowEl.parentElement && rowEl.parentElement !== listEl) rowEl = rowEl.parentElement;
            if (rowEl.parentElement === listEl && rowEl !== node) {
              this._handleNode(rowEl);
              expanded = true;
            }
          }
          if (expanded) return; // 已按行处理完毕
        }
      }
      var dm = PageAPI.extractDanmaku(node);
      if (!dm) return;
      // 忽略主播自己（"我"/"主播我"）的消息——自动回复在弹幕区也显示为"主播我"，一并规避自触发
      if (dm.isSelf) return;
      // 忽略自己刚发送的内容（双指纹：完整文本 + 内容文本）
      if (PageAPI._isRecentlySent(dm.text)) return;
      if (dm.content && dm.content !== dm.text && PageAPI._isRecentlySent(dm.content)) return;
      var rule = this._matchRule(dm.content || dm.text);
      if (!rule) return;
      // 内容去重：同一弹幕被多个 DOM 层级捕获时提取文本不同，但内容一致
      var now = Date.now();
      var fp = (dm.content || dm.core || dm.text).slice(0, 60);
      if (this._lastTextAt[fp] && now - this._lastTextAt[fp] < 10000) return;
      this._lastTextAt[fp] = now;
      this._matchedCount++;
      log.info("弹幕命中 [" + (dm.nickname || "?") + "]: " + (dm.content || dm.text).substring(0, 40));
      this._enqueue(dm, rule);
    },

    _matchRule: function (text) {
      for (var i = 0; i < this.rules.length; i++) {
        var r = this.rules[i];
        if (!r || !r.enabled || !r.reply || !r.keywords) continue;
        for (var k = 0; k < r.keywords.length; k++) {
          var kw = r.keywords[k];
          if (!kw) continue;
          if (text.indexOf(kw) !== -1) return r; // 包含匹配
        }
      }
      return null;
    },

    _enqueue: function (dm, rule) {
      // 同用户冷却
      if (dm.nickname) {
        var last = this._lastUserAt[dm.nickname] || 0;
        if (Date.now() - last < this.config.userCooldown * 1000) return;
        this._lastUserAt[dm.nickname] = Date.now();
      }
      // 每分钟限频
      var cutoff = Date.now() - 60000;
      this._sentThisMinute = this._sentThisMinute.filter(function (t) { return t > cutoff; });
      if (this._sentThisMinute.length >= this.config.maxPerMinute) {
        log.warn("弹幕回复：已达每分钟上限(" + this.config.maxPerMinute + "条)，本条跳过");
        return;
      }
      var reply = rule.reply;
      // 自动 @ 用户：把对方昵称提到回复前面（@昵称 + 空格 + 回复），对方会收到提醒
      // 兼容 {nickname} 占位符：用户显式写了 {nickname} 时替换，否则默认加前缀
      if (dm.nickname) {
        if (this.config.useNickname && reply.indexOf("{nickname}") !== -1) {
          reply = reply.replace(/\{nickname\}/g, dm.nickname);
        } else {
          reply = this._withNickname(reply, dm.nickname);
        }
      }
      this._queue.push({ reply: reply, nickname: dm.nickname });
      this._drainQueue();
    },

    // 拼 "@昵称 " 前缀。输入框有字数上限时（eos 评论区实测 50 字）优先保证回复完整：
    // 放不下就省略 @，否则会被截断成半句话（省略会打日志，便于主人判断是否要改规则）
    _withNickname: function (reply, nickname) {
      var composed = "@" + nickname + " " + reply;
      var max = PageAPI.commentMaxLength();
      if (max > 0 && composed.length > max) {
        log.warn("输入框限 " + max + " 字，本条省略 @昵称 以保证回复完整：" + reply);
        return reply;
      }
      return composed;
    },

    _drainQueue: function () {
      if (this._sending || this._queue.length === 0 || !this.running) return;
      var item = this._queue.shift();
      this._sending = true;
      var delay = this.config.delayMin + Math.random() * Math.max(this.config.delayMax - this.config.delayMin, 0);
      var self = this;
      setTimeout(function () {
        try {
          var ok = PageAPI.sendComment(item.reply);
          if (ok) {
            self._failCount = 0;
            self._repliedCount++;
            self._sentThisMinute.push(Date.now());
            log.ok("已回复" + (item.nickname ? " @" + item.nickname : "") + ": " + item.reply.substring(0, 30));
          } else {
            self._failCount++;
            log.warn("回复发送失败，未找到聊天输入框");
            if (self._failCount >= 3) {
              log.err("弹幕回复：连续 3 次发送失败，自动停止（页面结构可能已变化，请刷新后重试）");
              self.stop();
              return;
            }
          }
        } catch (e) {
          log.err("弹幕回复出错: " + e.message);
        }
        self._sending = false;
        // 发送间隔至少 1.5s，避免输入框内容被下一条覆盖
        setTimeout(function () { self._drainQueue(); }, 1500);
      }, Math.round(delay * 1000));
    },

    // 容器失效自愈：SPA 频繁 re-render，失效后重新定位并重建监听
    _healthCheck: function () {
      if (!this.running) return;
      if (!this._container || !this._container.isConnected) {
        log.warn("弹幕容器已失效，重新定位...");
        var c = PageAPI.findDanmakuContainer(true);
        if (c) {
          this._container = PageAPI._resolveListContainer(c) || c;
          if (this._observer) this._observer.disconnect();
          this._observer = new MutationObserver(this._onMutation.bind(this));
          this._observer.observe(this._container, { childList: true, subtree: true });
          log.ok("弹幕容器已重新定位");
        } else {
          log.warn("暂未找到弹幕容器，10 秒后重试");
        }
      }
    },
  };

  // ========================================================================
  //  CONFIG – light persistence in page localStorage (zero backend deps)
  // ========================================================================
  var Config = {
    get: function (key, def) {
      try {
        var raw = localStorage.getItem("dy_" + key);
        if (!raw) return def;
        var v = JSON.parse(raw);
        return v === undefined || v === null ? def : v;
      } catch (_) { return def; }
    },
    set: function (key, val) {
      try { localStorage.setItem("dy_" + key, JSON.stringify(val)); } catch (_) {}
    },
  };

  // ========================================================================
  //  UI PANEL
  // ========================================================================
  var Panel = {
    _el: null,

    init: function () {
      if (document.getElementById("dy-assistant-panel")) return;
      var P = this._createPanel();
      this._el = P.panel;
      this._bindDrag(P.header);
      this._bindTabs();
      document.body.appendChild(this._el);

      this._bindControls();
      this._loadSavedConfig();

      // Init log console reference
      log.init(document.getElementById("dy-console"));

      // Scan products on open
      this.refreshProducts();
      log.info("中控助手已加载 · 站点：" + Site.label());
      log.info("页面: " + (Probe.getPageType() || "未知"));
      if (Probe.hasVue()) log.ok("检测到 Vue " + (Probe.getVue().version || "") + " 应用");

      var net = Probe.getNetwork();
      if (net.length > 0) log.ok("已捕获 " + net.length + " 个网络请求");
      var prods = Probe.getProducts();
      if (prods.length > 0) log.ok("已预扫描 " + prods.length + " 个商品");
    },

    _createPanel: function () {
      var panel = document.createElement("div");
      panel.id = "dy-assistant-panel";

      panel.innerHTML =
        '<div id="dy-panel-header">' +
          '<span class="title" title="当前站点：' + Site.label() + '">🎯 ' + (Site.isEos() ? "团购" : "直播") + '中控助手</span>' +
          '<span class="min-btn" id="dy-min-btn">_</span>' +
        '</div>' +
        '<div id="dy-panel-tabs">' +
          '<div class="tab active" data-tab="explain">自动讲解</div>' +
          '<div class="tab" data-tab="comment">自动发评</div>' +
          '<div class="tab" data-tab="reply">弹幕回复</div>' +
        '</div>' +
        '<div id="dy-panel-body">' +
          // --- Tab 1: Auto Explain ---
          '<div class="dy-tab-content active" data-content="explain">' +
            '<div class="dy-section">' +
              '<div class="dy-row">' +
                '<label>间隔(秒)</label>' +
                '<input class="dy-input" id="dy-explain-interval" value="15" style="width:60px">' +
                '<label style="min-width:62px" title="每次在 间隔±浮动 秒之间随机">浮动(±s)</label>' +
                '<input class="dy-input" id="dy-explain-random" value="5" style="width:50px">' +
              '</div>' +
              '<div class="dy-row">' +
                '<label>序号</label>' +
                '<input class="dy-input" id="dy-explain-indices" placeholder="留空=全部, 如: 1-15,18,20" style="flex:1">' +
              '</div>' +
              '<div class="dy-row">' +
                '<label title="开启后每轮随机打乱讲解顺序，关闭后按序号顺序讲解（始终循环）">打乱</label>' +
                '<label class="dy-toggle"><input type="checkbox" id="dy-explain-shuffle"><span class="slider"></span></label>' +
                '<button class="dy-btn primary small" id="dy-explain-start">▶ 开始</button>' +
                '<button class="dy-btn small" id="dy-explain-stop">■ 停止</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          // --- Tab 2: Auto Comment ---
          '<div class="dy-tab-content" data-content="comment">' +
            '<div class="dy-section">' +
              '<div class="dy-row">' +
                '<label>间隔(秒)</label>' +
                '<input class="dy-input" id="dy-comment-interval" value="30" style="width:60px">' +
                '<label style="min-width:62px" title="每次在 间隔±浮动 秒之间随机">浮动(±s)</label>' +
                '<input class="dy-input" id="dy-comment-random" value="10" style="width:50px">' +
              '</div>' +
              '<div class="dy-row">' +
                '<label>打乱</label>' +
                '<label class="dy-toggle"><input type="checkbox" id="dy-comment-shuffle"><span class="slider"></span></label>' +
                '<button class="dy-btn primary small" id="dy-comment-start">▶ 开始</button>' +
                '<button class="dy-btn small" id="dy-comment-stop">■ 停止</button>' +
              '</div>' +
              '<div class="dy-section-title">评论内容（每行一条）</div>' +
              '<textarea class="dy-textarea" id="dy-comment-texts">' + (localStorage.getItem('dy_comment_texts') || '欢迎来到直播间！\n主播加油！') + '</textarea>' +
            '</div>' +
          '</div>' +
          // --- Tab 3: Auto Reply (弹幕关键词回复) ---
          '<div class="dy-tab-content" data-content="reply">' +
            '<div class="dy-section">' +
              '<div class="dy-row">' +
                '<button class="dy-btn primary small" id="dy-reply-start">▶ 监听</button>' +
                '<button class="dy-btn small" id="dy-reply-stop">■ 停止</button>' +
                '<span id="dy-reply-stats" style="font-size:11px;color:#a6adc8;flex:1;text-align:right"></span>' +
              '</div>' +
              '<div class="dy-section-title">关键词规则</div>' +
              '<div style="font-size:11px;color:#fab387;background:rgba(250,179,135,.08);border-left:3px solid #fab387;padding:6px 8px;margin:6px 0 8px;border-radius:3px;line-height:1.6">' +
                '格式：<code style="background:#313244;padding:1px 4px;border-radius:2px;color:#cdd6f4">关键词1|关键词2%%回复内容</code>（每行一条，多个关键词用 <code style="background:#313244;padding:1px 3px;border-radius:2px">|</code> 分隔）' +
                '<br>例：<code style="background:#313244;padding:1px 4px;border-radius:2px;color:#cdd6f4">价格|多少钱%%亲，价格在左上方商品列表查看哦</code>' +
              '</div>' +
              '<textarea class="dy-textarea" id="dy-reply-rules" style="min-height:120px" placeholder="价格|多少钱%%亲，价格在左上方商品列表查看哦&#10;运费%%全场包邮，放心下单&#10;回复中可用 {nickname} 引用对方昵称">' + (localStorage.getItem('dy_reply_rules') || '价格|多少钱%%亲，价格在左上方商品列表查看哦\n运费%%全场包邮，放心下单') + '</textarea>' +
              '<div style="font-size:11px;color:#6c7086;margin-top:6px;line-height:1.6">命中后延迟 1~2s 回复 · 自动 @ 用户 · 同用户冷却 60s · 上限 6 条/分钟（后台默认）</div>' +
            '</div>' +
          '</div>' +
          // Console
          '<div id="dy-console"></div>' +
        '</div>';

      var header = panel.querySelector("#dy-panel-header");
      return { panel: panel, header: header };
    },

    _bindDrag: function (handle) {
      var panel = this._el;
      var offX, offY;
      handle.addEventListener("mousedown", function (e) {
        if (e.target.classList.contains("min-btn")) return;
        offX = e.clientX - panel.offsetLeft;
        offY = e.clientY - panel.offsetTop;
        function onMove(ev) {
          panel.style.left = (ev.clientX - offX) + "px";
          panel.style.right = "auto";
          panel.style.top = (ev.clientY - offY) + "px";
        }
        function onUp() {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    },

    _bindTabs: function () {
      var tabs = this._el.querySelectorAll(".tab");
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].addEventListener("click", function () {
          var tabName = this.getAttribute("data-tab");
          // deactivate all
          var allTabs = Panel._el.querySelectorAll(".tab");
          for (var j = 0; j < allTabs.length; j++) allTabs[j].classList.remove("active");
          var allContent = Panel._el.querySelectorAll(".dy-tab-content");
          for (var k = 0; k < allContent.length; k++) allContent[k].classList.remove("active");
          // activate selected
          this.classList.add("active");
          var content = Panel._el.querySelector("[data-content='" + tabName + "']");
          if (content) content.classList.add("active");
        });
      }

      // minimize button
      var minBtn = this._el.querySelector("#dy-min-btn");
      if (minBtn) {
        minBtn.addEventListener("click", function () {
          Panel._el.classList.add("hidden");
          // show a small floating button to restore
          Panel._showRestoreBtn();
        });
      }
    },

    _showRestoreBtn: function () {
      var old = document.getElementById("dy-restore-btn");
      if (old) old.remove();
      var btn = document.createElement("div");
      btn.id = "dy-restore-btn";
      btn.textContent = "🎯";
      btn.style.cssText =
        "position:fixed;top:80px;right:20px;z-index:999999;" +
        "width:40px;height:40px;border-radius:50%;background:#1e1e2e;" +
        "border:1px solid #313244;box-shadow:0 4px 16px rgba(0,0,0,.4);" +
        "cursor:pointer;display:flex;align-items:center;justify-content:center;" +
        "font-size:20px;transition:transform .15s";
      btn.addEventListener("mouseenter", function () { btn.style.transform = "scale(1.1)"; });
      btn.addEventListener("mouseleave", function () { btn.style.transform = "scale(1)"; });
      btn.addEventListener("click", function () {
        btn.remove();
        Panel._el.classList.remove("hidden");
      });
      document.body.appendChild(btn);
    },

    _bindControls: function () {
      var self = this;

      // ---- Auto Explain ----
      this._onClick("dy-explain-start", function () {
        var cfg = {
          interval: parseFloat(self._val("dy-explain-interval")) || 15,
          randomDelay: parseFloat(self._val("dy-explain-random")) || 5,
          shuffle: self._chk("dy-explain-shuffle"),
        };
        AutoExplain.setConfig(cfg);
        Config.set("explain_cfg", {
          interval: cfg.interval,
          randomDelay: cfg.randomDelay,
          shuffle: cfg.shuffle,
          indices: self._val("dy-explain-indices"),
        });
        AutoExplain.start(self._val("dy-explain-indices"));
      });
      this._onClick("dy-explain-stop", function () { AutoExplain.stop(); });

      // ---- Auto Comment ----
      this._onClick("dy-comment-start", function () {
        try {
          var texts = self._val("dy-comment-texts").split("\n").filter(Boolean);
          // save on start
          localStorage.setItem("dy_comment_texts", self._val("dy-comment-texts"));
          var cfg = {
            interval: parseFloat(self._val("dy-comment-interval")) || 30,
            randomDelay: parseFloat(self._val("dy-comment-random")) || 10,
            shuffle: self._chk("dy-comment-shuffle"),
            messages: texts,
          };
          AutoComment.setConfig(cfg);
          Config.set("comment_cfg", {
            interval: cfg.interval,
            randomDelay: cfg.randomDelay,
            shuffle: cfg.shuffle,
          });
          AutoComment.start();
        } catch (e) {
          log.err("启动自动发评失败: " + e.message);
        }
      });
      this._onClick("dy-comment-stop", function () { AutoComment.stop(); });

      // ---- Auto Reply (弹幕关键词回复) ----
      this._onClick("dy-reply-start", function () {
        try {
          var rulesText = self._val("dy-reply-rules");
          localStorage.setItem("dy_reply_rules", rulesText);
          AutoReply.setRules(Panel.parseReplyRules(rulesText));
          AutoReply.start();
          self._updateReplyStats();
        } catch (e) {
          log.err("启动弹幕回复失败: " + e.message);
        }
      });
      this._onClick("dy-reply-stop", function () { AutoReply.stop(); });

      // Auto-save reply rules on input
      var replyRulesEl = document.getElementById("dy-reply-rules");
      if (replyRulesEl) {
        replyRulesEl.addEventListener("input", function () {
          localStorage.setItem("dy_reply_rules", replyRulesEl.value);
        });
      }

      // Refresh reply stats while listening
      setInterval(function () {
        if (AutoReply.running) Panel._updateReplyStats();
      }, 2000);

      // Auto-save comment texts on input
      var textsEl = document.getElementById("dy-comment-texts");
      if (textsEl) {
        textsEl.addEventListener("input", function () {
          localStorage.setItem("dy_comment_texts", textsEl.value);
        });
      }

      // Live-sync timing changes into a running task (no restart needed)
      var liveSync = [
        { ids: ["dy-explain-interval", "dy-explain-random"], mod: AutoExplain },
        { ids: ["dy-comment-interval", "dy-comment-random"], mod: AutoComment },
      ];
      for (var s = 0; s < liveSync.length; s++) {
        (function (item) {
          for (var k = 0; k < item.ids.length; k++) {
            var syncEl = document.getElementById(item.ids[k]);
            if (!syncEl) continue;
            syncEl.addEventListener("change", function () {
              item.mod.setConfig({
                interval: parseFloat(self._val(item.ids[0])) || item.mod.config.interval,
                randomDelay: parseFloat(self._val(item.ids[1])) || item.mod.config.randomDelay,
              });
              log.info((item.mod === AutoExplain ? "讲解" : "发评") + "参数已更新: 间隔 " + item.mod.config.interval + "s ± " + item.mod.config.randomDelay + "s");
            });
          }
        })(liveSync[s]);
      }

      // Live-sync shuffle toggle into a running task (takes effect next round)
      var shuffleToggle = document.getElementById("dy-explain-shuffle");
      if (shuffleToggle) {
        shuffleToggle.addEventListener("change", function () {
          AutoExplain.config.shuffle = shuffleToggle.checked;
          log.info("讲解顺序: " + (shuffleToggle.checked ? "打乱（每轮随机）" : "按序号顺序"));
        });
      }

      // Periodically refresh products (keeps the scan cache warm for auto-explain)
      setInterval(function () { PageAPI.scanProducts(); }, 10000);
    },

    // Restore persisted settings into the panel inputs
    _loadSavedConfig: function () {
      var e = Config.get("explain_cfg", null);
      if (e) {
        if (e.interval) this._setVal("dy-explain-interval", e.interval);
        if (e.randomDelay !== undefined) this._setVal("dy-explain-random", e.randomDelay);
        if (e.indices) this._setVal("dy-explain-indices", e.indices);
        if (e.shuffle !== undefined) {
          var shuffleEl = document.getElementById("dy-explain-shuffle");
          if (shuffleEl) shuffleEl.checked = !!e.shuffle;
        }
      }
      var c = Config.get("comment_cfg", null);
      if (c) {
        if (c.interval) this._setVal("dy-comment-interval", c.interval);
        if (c.randomDelay !== undefined) this._setVal("dy-comment-random", c.randomDelay);
        if (c.shuffle !== undefined) {
          var shuffleEl = document.getElementById("dy-comment-shuffle");
          if (shuffleEl) shuffleEl.checked = !!c.shuffle;
        }
      }
    },

    refreshProducts: function () {
      PageAPI.forceScan();
    },

    _val: function (id) {
      var el = document.getElementById(id);
      return el ? el.value : "";
    },
    _setVal: function (id, v) {
      var el = document.getElementById(id);
      if (el) el.value = v;
    },
    _chk: function (id) {
      var el = document.getElementById(id);
      return el ? el.checked : false;
    },
    _onClick: function (id, fn) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("click", fn);
    },

    // 解析规则文本：每行 "关键词1|关键词2%%回复内容"（兼容旧格式 "=>"）
    parseReplyRules: function (text) {
      var rules = [];
      var lines = (text || "").split("\n");
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        var parts = line.split(/\s*%%\s*/);
        if (parts.length < 2) parts = line.split(/\s*(?:=>|==>|→)\s*/); // 兼容旧格式
        var kwPart = (parts[0] || "").trim();
        var reply = (parts[1] || "").trim();
        if (!kwPart) continue;
        if (!reply) { log.warn("规则缺少回复内容，已跳过: " + line); continue; }
        var keywords = kwPart.split("|").map(function (s) { return s.trim(); }).filter(Boolean);
        if (keywords.length === 0) continue;
        rules.push({ keywords: keywords, reply: reply, enabled: true });
      }
      return rules;
    },

    _updateReplyStats: function () {
      var el = document.getElementById("dy-reply-stats");
      if (!el) return;
      var s = AutoReply.getStats();
      el.textContent = "命中 " + s.matched + " / 回复 " + s.replied;
    },
  };

  // ========================================================================
  //  CROSS-TAB API — 跨标签页接口
  //  其他标签页通过 chrome.runtime.sendMessage → background → content.js
  //  → window.postMessage 到这里，执行后原路返回结果
  // ========================================================================
  window.addEventListener("message", function (e) {
    if (!e.data || e.data.source !== "zkb-bridge") return;

    var id = e.data.id;
    var action = e.data.action;
    var params = e.data.params || {};
    var result;

    try {
      switch (action) {
        // 讲解指定商品 (params.index, 0-based)
        case "explain":
          result = _doExplain(params.index, false);
          break;

        // 取消讲解指定商品
        case "cancel_explain":
          result = _doExplain(params.index, true);
          break;

        // 发送弹幕 (params.text)
        case "comment":
          if (!params.text) {
            result = { success: false, error: "missing text" };
          } else {
            var ok = PageAPI.sendComment(params.text);
            result = ok
              ? { success: true, text: params.text }
              : { success: false, error: "发送失败，未找到输入框" };
          }
          break;

        // 获取商品列表
        case "list_products":
          result = _listProducts();
          break;

        // 获取运行状态
        case "get_status":
          result = {
            success: true,
            autoExplainRunning: AutoExplain.running,
            autoCommentRunning: AutoComment.running,
            autoReplyRunning: AutoReply.running,
            site: Site.detect(),
            siteLabel: Site.label(),
            productCount: (PageAPI._cache.products || []).length,
            explainRounds: AutoExplain._rounds,
            replyStats: AutoReply.getStats(),
          };
          break;

        default:
          result = { success: false, error: "unknown action: " + action };
      }
    } catch (err) {
      result = { success: false, error: err.message };
    }

    // 回传结果（result 可能是同步对象，也可能是 Promise → 统一等结算后再回传）
    Promise.resolve(result).then(
      function (r) {
        window.postMessage({ source: "zkb-response", id: id, result: r }, "*");
      },
      function (err) {
        window.postMessage({
          source: "zkb-response",
          id: id,
          result: { success: false, error: String((err && err.message) || err) },
        }, "*");
      }
    );
  });

  function _doExplain(index, cancel) {
    var products = PageAPI.scanProducts();
    if (!products || products.length === 0) {
      return { success: false, error: "未扫描到商品" };
    }
    var idx = parseInt(index, 10);
    if (isNaN(idx) || idx < 0 || idx >= products.length) {
      return { success: false, error: "index 超范围 (0-" + (products.length - 1) + ")" };
    }
    var product = products[idx];
    var act = cancel ? "cancel_explain" : "explain";
    // 站点差异（虚拟列表 vs 全量渲染）内聚在 PageAPI 内，对调用方统一成 Promise<boolean>：
    //   buyin → 同步 boolean；eos → Promise（先滚动渲染出目标行再点击）
    // 直接把 Promise 当 success 返回会因 postMessage 无法结构化克隆而抛错，故这里收口。
    var pending = cancel ? PageAPI.cancelExplain(product) : PageAPI.clickExplain(product);
    return Promise.resolve(pending).then(function (ok) {
      return {
        success: !!ok,
        index: idx,
        name: product.name,
        action: act,
      };
    });
  }

  function _listProducts() {
    var products = PageAPI.scanProducts();
    var list = [];
    for (var i = 0; i < products.length; i++) {
      list.push({
        index: i,
        id: products[i].id,
        name: products[i].name,
        price: products[i].price,
        stock: products[i].stock,
      });
    }
    return { success: true, count: list.length, products: list };
  }

  // ========================================================================
  //  BOOTSTRAP
  // ========================================================================
  function bootstrap() {
    // 1. Wait for probe
    if (!Probe.ready()) {
      log.info("正在探测页面...");
      // probe should already be done since it runs before inject.js,
      // but wait a moment just in case
      setTimeout(bootstrap, 200);
      return;
    }

    // 2. Wait for DOM
    if (!document.body) {
      setTimeout(bootstrap, 200);
      return;
    }

    // 3. Init panel
    Panel.init();
  }

  // Check that we're on a supported page (live control / group-buy live control)
  function isSupportedPage() {
    return Site.supported();
  }

  if (isSupportedPage()) {
    // Small delay to ensure probe.js has completed
    setTimeout(bootstrap, 100);
  }
})();
