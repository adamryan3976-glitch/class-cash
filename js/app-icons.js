// Browser tab icon + phone home-screen icon.
// Default: the Class Cash coin (icons/). If the class has a custom logo, use it instead.
//
// - Chrome / desktop tab:      <link rel="icon">
// - iPhone / iPad home screen: <link rel="apple-touch-icon"> (read when "Add to Home Screen" is tapped)
// - Android home screen:       the web app manifest (icons, name, start address)

const DEFAULTS = {
  favicon: "icons/coin.svg",
  favicon32: "icons/favicon-32.png",
  touch: "icons/icon-180.png",
  icon192: "icons/icon-192.png",
  icon512: "icons/icon-512.png",
  maskable: "icons/icon-maskable-512.png",
};
const THEME = "#1f6f4a";
const abs = (path) => new URL(path, location.href).href;

function linkEl(rel, extra = {}) {
  let el = document.head.querySelector(`link[rel="${rel}"]${extra.sizes ? `[sizes="${extra.sizes}"]` : ""}`);
  if (!el) {
    el = document.createElement("link");
    el.rel = rel;
    Object.assign(el, extra);
    document.head.append(el);
  }
  return el;
}

function metaEl(name) {
  let el = document.head.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.name = name;
    document.head.append(el);
  }
  return el;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Draw the logo centred on a solid square (iOS turns transparent corners black). */
function squareIcon(img, size, { pad = 0.12, bg = "#ffffff" } = {}) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  const box = size * (1 - pad * 2);
  const w0 = img.naturalWidth || box, h0 = img.naturalHeight || box;
  const scale = Math.min(box / w0, box / h0);
  const w = w0 * scale, h = h0 * scale;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return c.toDataURL("image/png");
}

let lastKey = null;

/**
 * Point the tab icon, iOS icon and Android manifest at the class logo (or the default coin).
 * @param {object} o
 * @param {string} o.logo        class logo data: URL, or "" for the default coin
 * @param {string} o.name        name shown under the home-screen icon
 * @param {string} o.startUrl    address the home-screen icon opens (student pages keep their private link)
 * @param {string} [o.staticManifest] manifest file to use when there's no custom logo (teacher app)
 */
export async function setAppIcons({ logo = "", name = "Class Cash", startUrl = location.href, staticManifest = "" }) {
  const key = JSON.stringify([logo.length, logo.slice(-64), name, startUrl, staticManifest]);
  if (key === lastKey) return;
  lastKey = key;

  metaEl("apple-mobile-web-app-title").content = name;
  metaEl("application-name").content = name;
  metaEl("mobile-web-app-capable").content = "yes";
  metaEl("apple-mobile-web-app-capable").content = "yes";
  // Remove any other icon links (e.g. an inline emoji icon) so browsers use ours.
  document.head.querySelectorAll('link[rel="shortcut icon"]').forEach((l) => l.remove());

  let favicon = DEFAULTS.favicon, touch = DEFAULTS.touch;
  let icons = [
    { src: abs(DEFAULTS.icon192), sizes: "192x192", type: "image/png" },
    { src: abs(DEFAULTS.icon512), sizes: "512x512", type: "image/png" },
    { src: abs(DEFAULTS.maskable), sizes: "512x512", type: "image/png", purpose: "maskable" },
  ];

  if (logo) {
    try {
      const img = await loadImage(logo);
      if (key !== lastKey) return; // something newer was requested while loading
      favicon = logo;
      touch = squareIcon(img, 180);
      icons = [
        { src: squareIcon(img, 192), sizes: "192x192", type: "image/png" },
        { src: squareIcon(img, 512), sizes: "512x512", type: "image/png" },
        { src: squareIcon(img, 512, { pad: 0.22 }), sizes: "512x512", type: "image/png", purpose: "maskable" },
      ];
    } catch (err) {
      console.warn("Class Cash: couldn't use the class logo as the app icon", err);
    }
  }

  // Tab icon
  const icon = linkEl("icon");
  icon.href = favicon;
  icon.type = favicon.endsWith(".svg") ? "image/svg+xml" : favicon.startsWith("data:image/png") ? "image/png" : "";
  const icon32 = document.head.querySelector('link[rel="alternate icon"]');
  if (icon32) icon32.href = logo ? favicon : DEFAULTS.favicon32;

  // iPhone / iPad
  linkEl("apple-touch-icon").href = touch;

  // Android: the teacher app uses its manifest file unless there's a custom logo;
  // student pages always build one so the home-screen icon opens their own private link.
  const manifest = linkEl("manifest");
  if (!logo && staticManifest) {
    manifest.href = staticManifest;
  } else {
    const json = {
      name, short_name: name.slice(0, 12), start_url: startUrl, scope: abs("./"), display: "standalone",
      background_color: THEME, theme_color: THEME, icons,
    };
    manifest.href = "data:application/manifest+json;charset=utf-8," + encodeURIComponent(JSON.stringify(json));
  }
}
