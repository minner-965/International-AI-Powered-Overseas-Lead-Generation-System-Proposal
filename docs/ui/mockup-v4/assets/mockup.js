// 样稿交互：标签页、对话框 / 底部弹层、草稿选择、手机底部栏辅助。仅用于静态样稿演示。
(function () {
  var body = document.body;
  var menu = document.querySelector('.menu-btn');
  var scrim = document.querySelector('.scrim');
  function setNav(open) {
    body.classList.toggle('nav-open', open);
    if (menu) menu.setAttribute('aria-expanded', String(open));
  }
  if (menu) menu.addEventListener('click', function () { setNav(!body.classList.contains('nav-open')); });
  if (scrim) scrim.addEventListener('click', function () { setNav(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setNav(false); });

  // 标签页：同一 tablist 内切换 aria-selected，并显示对应面板（如有）
  document.querySelectorAll('[role="tablist"]').forEach(function (list) {
    var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
    function select(tab) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        var p = t.getAttribute('aria-controls');
        if (p && document.getElementById(p)) document.getElementById(p).hidden = !on;
      });
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(t); });
      t.addEventListener('keydown', function (e) {
        var n = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!n) return;
        var next = tabs[(i + n + tabs.length) % tabs.length];
        next.focus(); select(next);
      });
    });
  });

  // 对话框
  document.querySelectorAll('[data-open]').forEach(function (b) {
    b.addEventListener('click', function () {
      var d = document.getElementById(b.getAttribute('data-open'));
      // 手机操作栏：按按钮预选记录类型
      var t = b.getAttribute('data-type');
      if (d && t && document.getElementById(t)) document.getElementById(t).checked = true;
      if (d && d.showModal) d.showModal();
    });
  });
  // 点击遮罩关闭底部弹层
  document.querySelectorAll('dialog').forEach(function (d) {
    d.addEventListener('click', function (e) { if (e.target === d && !d.classList.contains('m-full')) d.close(); });
  });

  // 手机：开关按钮、搜索按钮
  document.querySelectorAll('.m-toggle').forEach(function (b) {
    b.addEventListener('click', function () { b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); });
  });
  document.querySelectorAll('[data-m-search]').forEach(function (b) {
    b.addEventListener('click', function () {
      var i = document.querySelector('.m-app input[type="search"]');
      if (i) i.focus(); else location.href = 'opportunities.html';
    });
  });
  document.querySelectorAll('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () { var d = b.closest('dialog'); if (d) d.close(); });
  });

  // 阶段按钮（企业详情）
  document.querySelectorAll('.steps').forEach(function (g) {
    g.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      g.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    });
  });

  // 草稿列表（跟进邮件审批）
  document.querySelectorAll('.drafts .draft').forEach(function (d) {
    d.addEventListener('click', function () {
      document.querySelectorAll('.drafts .draft').forEach(function (x) { x.removeAttribute('aria-current'); });
      d.setAttribute('aria-current', 'true');
    });
  });
})();
