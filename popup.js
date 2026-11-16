const slider = document.getElementById('slider');
const val = document.getElementById('val');
const lslider = document.getElementById('lslider');
const lval = document.getElementById('lval');
const sw = document.getElementById('sw');
const blk = document.getElementById('blk');
const tinted = document.getElementById('tinted');
const gname = document.getElementById('gname');

function show(g, l) {
  slider.value = g; val.textContent = g + '%';
  lslider.value = l; lval.textContent = l + '%';
  const t = g / 100;
  const f = Math.round(l * 1.6 * t);
  // Tinted paints brightness in the Graphite color (200/255 of white).
  sw.style.filter = `grayscale(${t})` + (tinted.checked ? ` brightness(${1 - 0.216 * t})` : '');
  gname.textContent = tinted.checked ? 'Tint' : 'Grayscale';
  blk.style.background = `rgb(${f},${f},${f})`; // black swatch shows the lifted grey
}

chrome.storage.local.get({ intensity: 100, lift: 50, tinted: false }).then(v => {
  tinted.checked = v.tinted;
  show(v.intensity, v.lift);
});

tinted.addEventListener('change', () => {
  show(+slider.value, +lslider.value);
  chrome.storage.local.set({ tinted: tinted.checked });
});

slider.addEventListener('input', () => {
  show(+slider.value, +lslider.value);
  chrome.storage.local.set({ intensity: +slider.value });
});
lslider.addEventListener('input', () => {
  show(+slider.value, +lslider.value);
  chrome.storage.local.set({ lift: +lslider.value });
});

document.getElementById('ver').textContent = 'v' + chrome.runtime.getManifest().version;
