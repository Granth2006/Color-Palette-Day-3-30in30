/* ─────────────────────────────────────────────
   Color Palette Studio — script.js
   ───────────────────────────────────────────── */

'use strict';

// ── DOM refs ──────────────────────────────────
const dropZone       = document.getElementById('drop-zone');
const fileInput      = document.getElementById('file-input');
const imgPreviewWrap = document.getElementById('img-preview-wrap');
const imgPreview     = document.getElementById('img-preview');
const extractBtn     = document.getElementById('extract-btn');
const extractGrid    = document.getElementById('extract-palette');

const generateBtn    = document.getElementById('generate-btn');
const schemeSelect   = document.getElementById('scheme-select');
const generateGrid   = document.getElementById('generate-palette');

const gradientBar    = document.getElementById('gradient-bar');

const copyHexBtn     = document.getElementById('copy-hex-btn');
const copyCSSBtn     = document.getElementById('copy-css-btn');
const downloadBtn    = document.getElementById('download-btn');
const cssOutput      = document.getElementById('css-output');

const toast          = document.getElementById('toast');

// ── State ────────────────────────────────────
let currentImage  = null;        // HTMLImageElement after upload
let extractedPalette = [];       // [{h,s,l,locked}]
let generatedPalette = [];       // [{h,s,l,locked}]
let activeSection = 'generated'; // which palette is "current" for export

// ── Utilities ────────────────────────────────

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHsl(hex) {
  let r = parseInt(hex.slice(1,3),16)/255;
  let g = parseInt(hex.slice(3,5),16)/255;
  let b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch(max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h*360), s: Math.round(s*100), l: Math.round(l*100) };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h, s, l = (max+min)/2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    switch(max) {
      case r: h = ((g-b)/d + (g<b?6:0))/6; break;
      case g: h = ((b-r)/d + 2)/6; break;
      case b: h = ((r-g)/d + 4)/6; break;
    }
  }
  return { h: Math.round(h*360), s: Math.round(s*100), l: Math.round(l*100) };
}

function luminance(hex) {
  const r = parseInt(hex.slice(1,3),16)/255;
  const g = parseInt(hex.slice(3,5),16)/255;
  const b = parseInt(hex.slice(5,7),16)/255;
  return 0.2126*r + 0.7152*g + 0.0722*b;
}

function contrastText(hex) {
  return luminance(hex) > 0.45 ? '#111' : '#fff';
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); } catch(e) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

// ── Drag & Drop ───────────────────────────────

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadImageFile(file);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadImageFile(fileInput.files[0]);
});

function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      currentImage = img;
      imgPreview.src = ev.target.result;
      imgPreviewWrap.classList.add('visible');
      extractBtn.disabled = false;
      // Auto-extract
      extractColors();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// ── Color Extraction (Canvas + K-Means lite) ──

function extractColors() {
  if (!currentImage) return;

  const canvas = document.createElement('canvas');
  const MAX = 200; // downsample for performance
  const ratio = Math.min(MAX / currentImage.width, MAX / currentImage.height, 1);
  canvas.width  = Math.floor(currentImage.width  * ratio);
  canvas.height = Math.floor(currentImage.height * ratio);

  const ctx = canvas.getContext('2d');
  ctx.drawImage(currentImage, 0, 0, canvas.width, canvas.height);

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = [];

  // Sample every 4th pixel, skip near-white / near-black
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
    if (a < 128) continue;
    const brightness = (r + g + b) / 3;
    if (brightness < 18 || brightness > 238) continue;
    pixels.push([r, g, b]);
  }

  if (pixels.length === 0) { showToast('Could not read image pixels'); return; }

  const clusters = kMeans(pixels, 6, 20);
  extractedPalette = clusters.map(([r,g,b]) => ({ ...rgbToHsl(r,g,b), locked: false }));
  activeSection = 'extracted';
  renderPalette(extractGrid, extractedPalette, 'extracted');
  updateGradientAndExport();
}

// Lightweight k-means
function kMeans(pixels, k, iterations) {
  // Init centroids by picking spread pixels
  let centroids = pickInitCentroids(pixels, k);

  for (let iter = 0; iter < iterations; iter++) {
    const clusters = Array.from({length:k}, () => []);
    for (const p of pixels) {
      let best = 0, bestDist = Infinity;
      for (let i = 0; i < k; i++) {
        const d = colorDist(p, centroids[i]);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      clusters[best].push(p);
    }
    const newCentroids = clusters.map((cl, i) => {
      if (cl.length === 0) return centroids[i];
      return cl.reduce((acc,p) => [acc[0]+p[0], acc[1]+p[1], acc[2]+p[2]], [0,0,0])
               .map(v => Math.round(v / cl.length));
    });
    if (JSON.stringify(newCentroids) === JSON.stringify(centroids)) break;
    centroids = newCentroids;
  }
  return centroids;
}

function pickInitCentroids(pixels, k) {
  const step = Math.floor(pixels.length / k);
  const c = [];
  for (let i = 0; i < k; i++) c.push(pixels[i * step]);
  return c;
}

function colorDist([r1,g1,b1], [r2,g2,b2]) {
  return (r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2;
}

extractBtn.addEventListener('click', extractColors);

// ── Color Generation ──────────────────────────

const SCHEMES = {
  analogous:    baseH => [0,30,60,-30,-60].map(d => (baseH+d+360)%360),
  complementary:baseH => [0,180,30,210,60].map(d => (baseH+d+360)%360),
  triadic:      baseH => [0,120,240,60,180].map(d => (baseH+d+360)%360),
  split:        baseH => [0,150,210,30,180].map(d => (baseH+d+360)%360),
  tetradic:     baseH => [0,90,180,270,45].map(d => (baseH+d+360)%360),
  monochromatic:baseH => [0,0,0,0,0].map(d => (baseH+d+360)%360),
};

function generatePalette() {
  const scheme = schemeSelect.value;
  const baseH = Math.floor(Math.random() * 360);
  const hues = SCHEMES[scheme](baseH);

  const satVariants = [75, 65, 55, 80, 60];
  const litVariants  = scheme === 'monochromatic'
    ? [30, 45, 60, 70, 80]
    : [45, 55, 60, 40, 65];

  generatedPalette = hues.map((h, i) => ({
    h,
    s: satVariants[i],
    l: litVariants[i],
    locked: generatedPalette[i]?.locked || false
  }));

  // Respect locked entries
  generatedPalette = generatedPalette.map((c, i) => {
    if (generatedPalette[i]?.locked && i < generatedPalette.length) return generatedPalette[i];
    return c;
  });

  activeSection = 'generated';
  renderPalette(generateGrid, generatedPalette, 'generated');
  updateGradientAndExport();
}

generateBtn.addEventListener('click', generatePalette);

// Auto-generate on load
generatePalette();

// ── Render Palette ────────────────────────────

function renderPalette(grid, palette, section) {
  grid.innerHTML = '';
  if (!palette.length) {
    grid.innerHTML = '<p class="palette-empty">No colors yet.</p>';
    return;
  }

  palette.forEach((color, idx) => {
    const hex = hslToHex(color.h, color.s, color.l);
    const textColor = contrastText(hex);

    const card = document.createElement('div');
    card.className = 'color-card';
    card.innerHTML = `
      <div class="color-swatch" data-hex="${hex}" style="background:${hex};">
        <div class="copy-hint" style="color:${textColor};">Click to copy</div>
      </div>
      <div class="color-info">
        <div class="hex-label" data-hex="${hex}">${hex.toUpperCase()}</div>
        <div class="card-actions">
          <button class="edit-btn" title="Edit color">✏️</button>
          <button class="lock-btn ${color.locked ? 'locked' : ''}" title="${color.locked ? 'Unlock' : 'Lock'} color">
            ${color.locked ? '🔒' : '🔓'}
          </button>
        </div>
        <div class="color-editor-wrap" id="editor-${section}-${idx}">
          <div class="slider-row">
            <label>H</label>
            <input type="range" min="0" max="360" value="${color.h}" class="hue-slider">
            <span>${color.h}°</span>
          </div>
          <div class="slider-row">
            <label>S</label>
            <input type="range" min="0" max="100" value="${color.s}" class="sat-slider">
            <span>${color.s}%</span>
          </div>
          <div class="slider-row">
            <label>L</label>
            <input type="range" min="0" max="100" value="${color.l}" class="lit-slider">
            <span>${color.l}%</span>
          </div>
        </div>
      </div>
    `;

    // Copy on swatch click
    card.querySelector('.color-swatch').addEventListener('click', () => {
      copyText(hex);
      showToast(`Copied ${hex.toUpperCase()} 📋`);
    });

    // Copy on hex label click
    card.querySelector('.hex-label').addEventListener('click', () => {
      copyText(hex);
      showToast(`Copied ${hex.toUpperCase()} 📋`);
    });

    // Edit / slider toggle
    const editBtn = card.querySelector('.edit-btn');
    const editorWrap = card.querySelector('.color-editor-wrap');
    editBtn.addEventListener('click', () => {
      editorWrap.classList.toggle('open');
    });

    // Lock button
    const lockBtn = card.querySelector('.lock-btn');
    lockBtn.addEventListener('click', () => {
      const pal = section === 'extracted' ? extractedPalette : generatedPalette;
      pal[idx].locked = !pal[idx].locked;
      lockBtn.classList.toggle('locked', pal[idx].locked);
      lockBtn.textContent = pal[idx].locked ? '🔒' : '🔓';
      lockBtn.title = pal[idx].locked ? 'Unlock color' : 'Lock color';
    });

    // Sliders
    const hSlider = card.querySelector('.hue-slider');
    const sSlider = card.querySelector('.sat-slider');
    const lSlider = card.querySelector('.lit-slider');

    function onSliderChange() {
      const pal = section === 'extracted' ? extractedPalette : generatedPalette;
      pal[idx].h = parseInt(hSlider.value);
      pal[idx].s = parseInt(sSlider.value);
      pal[idx].l = parseInt(lSlider.value);
      // Update displays
      hSlider.nextElementSibling.textContent = hSlider.value + '°';
      sSlider.nextElementSibling.textContent = sSlider.value + '%';
      lSlider.nextElementSibling.textContent = lSlider.value + '%';
      const newHex = hslToHex(pal[idx].h, pal[idx].s, pal[idx].l);
      card.querySelector('.color-swatch').style.background = newHex;
      card.querySelector('.color-swatch').dataset.hex = newHex;
      card.querySelector('.hex-label').textContent = newHex.toUpperCase();
      card.querySelector('.hex-label').dataset.hex = newHex;
      card.querySelector('.copy-hint').style.color = contrastText(newHex);
      updateGradientAndExport();
    }

    [hSlider, sSlider, lSlider].forEach(sl => sl.addEventListener('input', onSliderChange));

    grid.appendChild(card);
  });
}

// ── Gradient preview ───────────────────────────

function updateGradientAndExport() {
  const pal = activeSection === 'extracted' ? extractedPalette : generatedPalette;
  if (!pal.length) return;
  const hexes = pal.map(c => hslToHex(c.h, c.s, c.l));
  gradientBar.style.background = `linear-gradient(135deg, ${hexes.join(', ')})`;
  gradientBar.classList.add('visible');
  updateCSSOutput(hexes);
}

// ── CSS Variables output ───────────────────────

function updateCSSOutput(hexes) {
  const lines = hexes.map((h, i) => `  --color-${i+1}: ${h.toUpperCase()};`).join('\n');
  cssOutput.textContent = `:root {\n${lines}\n}`;
}

// ── Export Buttons ─────────────────────────────

copyHexBtn.addEventListener('click', () => {
  const pal = activeSection === 'extracted' ? extractedPalette : generatedPalette;
  if (!pal.length) { showToast('No palette to copy'); return; }
  const list = pal.map(c => hslToHex(c.h, c.s, c.l).toUpperCase()).join('\n');
  copyText(list);
  showToast('HEX list copied 📋');
});

copyCSSBtn.addEventListener('click', () => {
  const pal = activeSection === 'extracted' ? extractedPalette : generatedPalette;
  if (!pal.length) { showToast('No palette to copy'); return; }
  const hexes = pal.map(c => hslToHex(c.h, c.s, c.l));
  const lines = hexes.map((h, i) => `  --color-${i+1}: ${h.toUpperCase()};`).join('\n');
  const css = `:root {\n${lines}\n}`;
  cssOutput.textContent = css;
  cssOutput.classList.add('visible');
  copyText(css);
  showToast('CSS variables copied 📋');
});

downloadBtn.addEventListener('click', () => {
  const pal = activeSection === 'extracted' ? extractedPalette : generatedPalette;
  if (!pal.length) { showToast('No palette to download'); return; }
  const hexes = pal.map(c => hslToHex(c.h, c.s, c.l));
  downloadPalettePNG(hexes);
});

function downloadPalettePNG(hexes) {
  const W = 160, H = 220;
  const canvas = document.createElement('canvas');
  canvas.width  = W * hexes.length;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  hexes.forEach((hex, i) => {
    ctx.fillStyle = hex;
    ctx.fillRect(i * W, 0, W, H - 40);
    ctx.fillStyle = '#1a1e2a';
    ctx.fillRect(i * W, H - 40, W, 40);
    ctx.fillStyle = '#e8eaf0';
    ctx.font = '600 13px "Courier New"';
    ctx.textAlign = 'center';
    ctx.fillText(hex.toUpperCase(), i * W + W / 2, H - 14);
  });

  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'palette.png';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Palette downloaded 🎨');
  });
}

// ── Scheme change auto-regenerates ────────────
schemeSelect.addEventListener('change', generatePalette);
