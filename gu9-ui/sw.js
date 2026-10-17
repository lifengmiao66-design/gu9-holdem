/* sw.js · 最小 PWA service worker
   ★ 2026-10-04：唯一用途是满足 Chrome「可安装」条件（触发 beforeinstallprompt），
      让「添加到主屏幕」按钮在 Android 上能直接弹系统安装框。
   ★ 不监听 fetch / 不缓存任何资源 —— 避免玩家端 JS/CSS 被 SW 缓存导致改版后不生效
     （本站点频繁改版，之前 logo 白边就是缓存坑）。所有网络请求走默认网络。 */
self.addEventListener('install', function () {
  self.skipWaiting();
});
self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});
/* 故意不 addEventListener('fetch') —— 浏览器对未拦截的请求直接走网络，零缓存。 */

