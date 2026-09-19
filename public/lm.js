/**
 * NPC Lead Magnet Loader
 * Usage on any landing page (Vercel, Webflow, GHL, plain HTML):
 *
 *   <script src="https://command-centre.npcservices.com.au/lm.js"
 *           data-slug="your-magnet-slug"></script>
 *
 * Optional attributes:
 *   data-max-width="520"   (px, default 520)
 *   data-host="https://command-centre.npcservices.com.au"  (override embed origin)
 *
 * Drop multiple script tags on the same page for multiple magnets — each one
 * mounts its own iframe right where the tag lives.
 */
(function () {
  var DEFAULT_HOST = 'https://command-centre.npcservices.com.au';
  var current = document.currentScript;
  if (!current) return;

  var slug = current.getAttribute('data-slug');
  if (!slug) {
    console.error('[npc-lm] Missing data-slug attribute');
    return;
  }
  var host = current.getAttribute('data-host') || DEFAULT_HOST;
  var maxWidth = current.getAttribute('data-max-width') || '520';

  var wrap = document.createElement('div');
  wrap.style.cssText = 'width:100%;max-width:' + maxWidth + 'px;margin:0 auto;';

  var iframe = document.createElement('iframe');
  iframe.src = host + '/lead-magnet-embed.html?slug=' + encodeURIComponent(slug);
  iframe.setAttribute('title', 'Request Access');
  iframe.setAttribute('loading', 'lazy');
  iframe.setAttribute('scrolling', 'no');
  iframe.setAttribute('allow', 'clipboard-write');
  iframe.style.cssText = 'width:100%;border:0;background:transparent;display:block;height:560px;transition:height .15s ease;';
  wrap.appendChild(iframe);
  current.parentNode.insertBefore(wrap, current);

  // Listen for height messages from this specific iframe
  window.addEventListener('message', function (e) {
    try {
      if (e.source !== iframe.contentWindow) return;
      var d = e.data || {};
      if (d.type === 'lm-height' && d.slug === slug && typeof d.height === 'number') {
        iframe.style.height = Math.max(320, d.height) + 'px';
      }
    } catch (err) {}
  });
})();
