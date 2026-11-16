(() => {
  if (window.__grayFavicon || !document.head) return;
  window.__grayFavicon = true;

  // After the extension reloads, the copy injected into this tab runs in a
  // fresh world and announces itself; the old copy puts the site's icon back
  // and stops, so the fresh copy starts from the page's own links.
  const TAKEOVER = 'gray-favicon-takeover';
  document.dispatchEvent(new CustomEvent(TAKEOVER));
  try { chrome.runtime.sendMessage('gf:checkBuild').catch(() => {}); } catch (_) {}

  const MARK = 'data-gray-favicon';
  let intensity = 100;     // 0..100
  let lift = 50;           // 0..100, raises the black point
  let originalHref = null; // the site's real favicon URL
  let stash = [];          // site <link> nodes we removed (restored at 0%)
  let ours = null;         // our replacement <link>
  let blocked = false;     // the page's CSP refuses our icon
  let renderId = 0;
  let fights = [];         // times the site put its icon back, last 2 s
  const fetched = new Map(); // href -> data URL
  const grayed = new Map();  // href|intensity|lift -> gray data URL

  const iconLinks = () =>
    [...document.querySelectorAll('link[rel~="icon"]')].filter(l => !l.hasAttribute(MARK));

  function pickBest(links) {
    const score = l => {
      const s = (l.getAttribute('sizes') || '').toLowerCase();
      if (s === 'any' || /svg/.test(l.type || '')) return 1000;
      const m = s.match(/(\d+)x\d+/);
      if (!m) return 0;
      const w = +m[1];
      return w >= 32 ? 500 - w : w;
    };
    return links.reduce((a, b) => (score(b) >= score(a) ? b : a));
  }

  // React only to icon changes: a site link added or given rel=icon, or the
  // site editing or removing the extension's link. Other head churn (Next.js
  // adds scripts and preloads while loading) is ignored.
  const isIcon = n => n.nodeName === 'LINK' && /(^|\s)icon(\s|$)/i.test(n.getAttribute('rel') || '');
  const relevant = r =>
    r.type === 'attributes'
      ? r.target === ours || isIcon(r.target)
      : [...r.addedNodes].some(n => isIcon(n) && !n.hasAttribute(MARK)) ||
        (ours && [...r.removedNodes].includes(ours));

  // Give up only on a real tug-of-war: the site putting its icon back more
  // than 10 times in 2 seconds. Sites that change the icon now and then
  // (unread badges) stay gray however long the tab is open.
  const fighting = () => {
    const now = Date.now();
    fights = fights.filter(t => now - t < 2000);
    fights.push(now);
    return fights.length > 10;
  };

  // The callback runs before the next paint, and an icon seen before is
  // swapped from the cache without waiting, so the color icon never shows.
  const mo = new MutationObserver(recs => {
    if (intensity <= 0 || blocked || !recs.some(relevant)) return;
    if (fighting()) { mo.disconnect(); return; }
    apply();
  });
  const watch = () =>
    mo.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'rel'] });

  async function toGray(href, t) {
    const key = href + '|' + intensity + '|' + lift;
    if (grayed.has(key)) return grayed.get(key);
    let src = href;
    if (!href.startsWith('data:')) {
      if (!fetched.has(href)) {
        let res = null;
        try { res = await chrome.runtime.sendMessage({ type: 'fetchIcon', url: href }); } catch (e) {}
        fetched.set(href, res && res.dataUrl);
      }
      src = fetched.get(href);
      if (!src) return null;
    }
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = src;
    }).catch(() => null);
    if (!img) return null;
    const size = 64;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.filter = `grayscale(${t})`;
    ctx.drawImage(img, 0, 0, size, size);
    if (lift > 0 && t > 0) {
      // Only raise shades darker than the target grey; lighter shades are untouched.
      const floor = lift * 1.6 * t;
      const d = ctx.getImageData(0, 0, size, size);
      const px = d.data;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] < floor) px[i] = floor;
        if (px[i + 1] < floor) px[i + 1] = floor;
        if (px[i + 2] < floor) px[i + 2] = floor;
      }
      ctx.putImageData(d, 0, 0);
    }
    const out = c.toDataURL('image/png');
    grayed.set(key, out);
    return out;
  }

  function restore() {
    renderId++;
    mo.disconnect();
    if (ours) { ours.remove(); ours = null; }
    stash.forEach(l => document.head.appendChild(l));
    stash = [];
    originalHref = null;
    watch();
  }

  async function apply() {
    if (blocked || intensity <= 0) return restore();
    const id = ++renderId;

    // Pick up whatever icon the site currently declares.
    mo.disconnect();
    const links = iconLinks();
    if (links.length) {
      originalHref = pickBest(links).href;
      stash = links;
      links.forEach(l => l.remove());
    } else if (ours && ours.isConnected && ours.getAttribute('href') !== ours.__set) {
      originalHref = ours.href; // site edited our link's href directly
    }
    if (!originalHref) originalHref = new URL('/favicon.ico', location.origin).href;
    watch();

    const key = originalHref + '|' + intensity + '|' + lift;
    const dataUrl = grayed.has(key) ? grayed.get(key) : await toGray(originalHref, intensity / 100);
    if (id !== renderId) return;
    if (!dataUrl) return restore(); // couldn't process; leave the site's icon alone
    setOurs(dataUrl);
  }

  function setOurs(dataUrl) {
    mo.disconnect();
    if (!ours) {
      ours = document.createElement('link');
      ours.rel = 'icon';
      ours.type = 'image/png';
      ours.setAttribute(MARK, '1');
    }
    if (ours.getAttribute('href') !== dataUrl) ours.href = dataUrl;
    ours.__set = dataUrl;
    if (!ours.isConnected) document.head.appendChild(ours);
    watch();
  }

  document.addEventListener(TAKEOVER, () => {
    restore();
    mo.disconnect();
    blocked = true; // ignore anything still queued
  }, { once: true });

  // Backup for a CSP the up-front check missed: put the site's own icon back
  // and stop trying on this page.
  document.addEventListener('securitypolicyviolation', e => {
    if (e.disposition !== 'enforce') return; // report-only policies (YouTube) don't block anything
    if (!ours || !String(e.violatedDirective).startsWith('img-src')) return;
    if (e.blockedURI !== 'data' && !String(e.blockedURI).startsWith('data:')) return;
    blocked = true;
    restore();
  });

  // Check the page's CSP up front; if it forbids data: images, leave the icon
  // alone instead of inserting a data: icon and causing a CSP error.
  const meta = [...document.querySelectorAll('meta[http-equiv]')]
    .filter(m => m.httpEquiv.toLowerCase() === 'content-security-policy')
    .map(m => m.content || '');
  Promise.all([
    chrome.storage.local.get({ intensity: 100, lift: 50 }),
    chrome.runtime.sendMessage({ type: 'cspCheck', meta }).catch(() => null)
  ]).then(([v, csp]) => {
    intensity = v.intensity;
    lift = v.lift;
    if (csp && csp.blocked) blocked = true;
    if (intensity > 0) apply();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.lift) lift = changes.lift.newValue;
    if (changes.intensity) intensity = changes.intensity.newValue;
    if (changes.intensity || changes.lift) apply();
  });
})();
