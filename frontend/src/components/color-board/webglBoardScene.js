import {
  Application,
  ColorMatrixFilter,
  Container,
  Graphics,
  ImageSource,
  Rectangle,
  Sprite,
  Texture,
} from 'pixi.js';
import { backendUrl } from '../../api/url';
import {
  cardsInBoardViewport,
  CARD_RADIUS,
  CARD_SIZE,
  MAX_SCALE,
} from '../../utils/colorBoardLayout';
import {
  BOARD_CARD_QUALITY,
  WEBGL_CULL_MARGIN,
  WEBGL_TEXTURE_CACHE_BYTES,
} from './constants';

const CARD_INSET = 6;
const CARD_IMAGE_SIZE = CARD_SIZE - CARD_INSET * 2;
const CARD_IMAGE_RADIUS = 12;
const DRAG_SATURATION = 1.08;
const CHROME_MARGIN = 64;
const CHROME_SIZE = CARD_SIZE + CHROME_MARGIN * 2;
const CIRCLE_SHADOW_BLUR = 70;
const CIRCLE_SHADOW_OFFSET_Y = 24;
const CIRCLE_SHADOW_ALPHA = 0.08;
const CIRCLE_SHADOW_SIGMA = CIRCLE_SHADOW_BLUR / 2;
const CIRCLE_SHADOW_EXTENT = CIRCLE_SHADOW_SIGMA * 3;
const CIRCLE_SHADOW_BANDS = 32;

function requestFrame(callback) {
  return typeof window.requestAnimationFrame === 'function'
    ? window.requestAnimationFrame(callback)
    : window.setTimeout(callback, 16);
}

function cancelFrame(frameId) {
  if (frameId == null) return;
  if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frameId);
  else window.clearTimeout(frameId);
}

function cssVariable(name, alpha = 1) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const channels = raw.split(/\s+/).map(Number);
  if (channels.length < 3 || channels.some((channel) => !Number.isFinite(channel))) {
    return `rgba(0, 0, 0, ${alpha})`;
  }
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
}

function erf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - polynomial * Math.exp(-x * x));
}

function circleShadowOpacity(signedDistance) {
  const normalized = signedDistance / (Math.SQRT2 * CIRCLE_SHADOW_SIGMA);
  return CIRCLE_SHADOW_ALPHA * 0.5 * (1 - erf(normalized));
}

function cssSaturationMatrix(amount) {
  const red = 0.213;
  const green = 0.715;
  const blue = 0.072;
  return [
    red + (1 - red) * amount, green - green * amount, blue - blue * amount, 0, 0,
    red - red * amount, green + (1 - green) * amount, blue - blue * amount, 0, 0,
    red - red * amount, green - green * amount, blue + (1 - blue) * amount, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

function roundedRectPath(context, x, y, width, height, radius) {
  if (typeof context.roundRect === 'function') {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    return;
  }
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function drawBoxShadow(context, {
  blur, color, offsetY, radius, resolution, spread, x, y,
}) {
  const shadowX = x - spread;
  const shadowY = y - spread;
  const shadowSize = CARD_SIZE + spread * 2;
  context.save();
  // Canvas shadows inherit the source shape's alpha, so keep this opaque. The
  // actual source pixels are fully covered by the card body drawn afterwards.
  context.fillStyle = '#000';
  context.shadowColor = color;
  // Canvas shadow metrics ignore the current transform, unlike the card path.
  // Scale them explicitly so the generated texture preserves the DOM's CSS-px
  // shadow geometry at every device-pixel ratio.
  context.shadowBlur = blur * resolution;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = offsetY * resolution;
  roundedRectPath(
    context,
    shadowX,
    shadowY,
    shadowSize,
    shadowSize,
    Math.max(0, radius + spread),
  );
  context.fill();
  context.restore();
}

function drawChromeShadow(context, state, colors, resolution) {
  const x = CHROME_MARGIN;
  const y = CHROME_MARGIN;
  const selected = state.includes('selected');
  const hovered = state === 'hover';
  const color = selected ? colors.accentShadow : colors.shadow;

  // Tailwind's shadow-lg / shadow-xl values used by the DOM card. A negative
  // spread is represented by shrinking the source rounded rectangle before
  // applying the same blur and offset.
  if (selected || hovered) {
    drawBoxShadow(context, {
      blur: 25, color, offsetY: 20, radius: CARD_RADIUS, resolution, spread: -5, x, y,
    });
    drawBoxShadow(context, {
      blur: 10, color, offsetY: 8, radius: CARD_RADIUS, resolution, spread: -6, x, y,
    });
  } else {
    drawBoxShadow(context, {
      blur: 15, color, offsetY: 10, radius: CARD_RADIUS, resolution, spread: -3, x, y,
    });
    drawBoxShadow(context, {
      blur: 6, color, offsetY: 4, radius: CARD_RADIUS, resolution, spread: -4, x, y,
    });
  }
}

function createChromeTexture(state, resolution) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(CHROME_SIZE * resolution);
  canvas.height = Math.ceil(CHROME_SIZE * resolution);
  const context = canvas.getContext('2d', { alpha: true, colorSpace: 'srgb' });
  context.scale(resolution, resolution);

  const colors = {
    accent: cssVariable('--clr-accent'),
    accentFocus: cssVariable('--clr-accent', 0.3),
    accentHover: cssVariable('--clr-accent', 0.45),
    accentShadow: cssVariable('--clr-accent', 0.2),
    shadow: cssVariable('--clr-overlay', 0.1),
    surface: cssVariable('--clr-surface-2'),
  };
  const selected = state.includes('selected');
  const focused = state.includes('focus');
  const hovered = state === 'hover';
  const x = CHROME_MARGIN;
  const y = CHROME_MARGIN;

  drawChromeShadow(context, state, colors, resolution);

  if (focused) {
    context.save();
    context.strokeStyle = colors.accentFocus;
    context.lineWidth = 4;
    roundedRectPath(context, x - 2, y - 2, CARD_SIZE + 4, CARD_SIZE + 4, CARD_RADIUS + 2);
    context.stroke();
    context.restore();
  }

  context.save();
  context.fillStyle = colors.surface;
  context.strokeStyle = selected ? colors.accent : hovered ? colors.accentHover : colors.surface;
  context.lineWidth = 2;
  roundedRectPath(context, x + 1, y + 1, CARD_SIZE - 2, CARD_SIZE - 2, CARD_RADIUS - 1);
  context.fill();
  context.stroke();
  context.restore();

  context.save();
  context.globalCompositeOperation = 'destination-out';
  roundedRectPath(
    context,
    x + CARD_INSET,
    y + CARD_INSET,
    CARD_IMAGE_SIZE,
    CARD_IMAGE_SIZE,
    CARD_IMAGE_RADIUS,
  );
  context.fill();
  context.restore();

  const source = new ImageSource({
    resource: canvas,
    resolution,
    alphaMode: 'premultiply-alpha-on-upload',
    autoGenerateMipmaps: false,
    mipLevelCount: 1,
    scaleMode: 'linear',
    magFilter: 'linear',
    minFilter: 'linear',
    maxAnisotropy: 1,
    autoGarbageCollect: false,
    label: `color-board-card-${state}`,
  });
  return new Texture({ source, label: `color-board-card-${state}` });
}

function loadImage(image, url) {
  let cancel = () => {};
  const promise = new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Unable to load board thumbnail: ${url}`));
    };
    cancel = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try { image.src = ''; } catch {}
      reject(new Error(`Cancelled board thumbnail: ${url}`));
    };
    image.onload = finish;
    image.onerror = fail;
    image.src = url;
    if (typeof image.decode === 'function') image.decode().then(finish, () => {});
  });
  return { cancel: () => cancel(), promise };
}

function createIllustrationTexture(illustration) {
  const image = new Image();
  image.decoding = 'async';
  const url = backendUrl(`${illustration.thumbnail_url}?quality=${BOARD_CARD_QUALITY}`);
  const loading = loadImage(image, url);
  return {
    cancel: loading.cancel,
    image,
    promise: loading.promise.then(() => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) throw new Error(`Empty board thumbnail: ${url}`);

      const source = new ImageSource({
        resource: image,
        width,
        height,
        resolution: 1,
        alphaMode: 'premultiply-alpha-on-upload',
        autoGenerateMipmaps: false,
        mipLevelCount: 1,
        scaleMode: 'linear',
        magFilter: 'linear',
        minFilter: 'linear',
        maxAnisotropy: 1,
        autoGarbageCollect: false,
        label: `color-board-illustration-${illustration.id}`,
      });
      const side = Math.min(width, height);
      const texture = new Texture({
        source,
        frame: new Rectangle((width - side) / 2, (height - side) / 2, side, side),
        label: `color-board-illustration-${illustration.id}`,
      });
      return {
        image, source, texture, bytes: width * height * 4, url,
      };
    }),
    url,
  };
}

function destroyCacheEntry(entry) {
  try { entry.cancel?.(); } catch {}
  entry.cancel = null;
  try { entry.texture?.destroy?.(); } catch {}
  try { entry.source?.destroy?.(); } catch {}
  if (entry.image) {
    entry.image.onload = null;
    entry.image.onerror = null;
    try { entry.image.src = ''; } catch {}
  }
}

export default class WebGLBoardScene {
  constructor({ host, onContextLost, onVisibleCardsChange }) {
    this.host = host;
    this.onContextLost = onContextLost;
    this.onVisibleCardsChange = onVisibleCardsChange;
    this.app = null;
    this.world = null;
    this.circleContainer = null;
    this.cardContainer = null;
    this.selectionGraphics = null;
    this.layout = null;
    this.layoutRevision = 0;
    this.view = { x: 0, y: 0, scale: 1 };
    this.selectedIds = new Set();
    this.draggingIds = new Set();
    this.dragOffset = { x: 0, y: 0 };
    this.dropTarget = null;
    this.hoveredId = null;
    this.focusedId = null;
    this.visibleNodes = new Map();
    this.cardOrderById = new Map();
    this.activeTextureIds = new Set();
    this.textureCache = new Map();
    this.textureCacheBytes = 0;
    this.chromeTextures = new Map();
    this.renderFrame = null;
    this.visibleSignature = '';
    this.destroyed = false;
    this.resizeObserver = null;
    this.handleResize = null;
    this.handleContextLost = this.handleContextLost.bind(this);
    this.dragFilter = new ColorMatrixFilter();
    this.dragFilter.matrix = cssSaturationMatrix(DRAG_SATURATION);
  }

  async init({ layout, view, selectedIds, draggingIds, dropTarget }) {
    const width = Math.max(1, this.host.clientWidth || window.innerWidth || 1);
    const height = Math.max(1, this.host.clientHeight || window.innerHeight || 1);
    const resolution = window.devicePixelRatio || 1;
    const app = new Application();
    try {
      await app.init({
        width,
        height,
        resolution,
        autoDensity: true,
        autoStart: false,
        sharedTicker: false,
        antialias: true,
        backgroundAlpha: 0,
        clearBeforeRender: true,
        preference: 'webgl',
        preferWebGLVersion: 2,
        powerPreference: 'high-performance',
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
      });
    } catch (error) {
      try { app.destroy({ removeView: true }, { children: true, context: true }); } catch {}
      throw error;
    }
    if (this.destroyed) {
      app.destroy({ removeView: true }, { children: true, context: true });
      return;
    }

    const gl = app.renderer.gl;
    const version = gl?.getParameter?.(gl.VERSION) || '';
    if (!String(version).includes('WebGL 2')) {
      app.destroy({ removeView: true }, { children: true, context: true });
      throw new Error('WebGL 2 is unavailable');
    }
    try {
      if ('drawingBufferColorSpace' in gl) gl.drawingBufferColorSpace = 'srgb';
      if ('unpackColorSpace' in gl) gl.unpackColorSpace = 'srgb';
    } catch {}
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);

    this.app = app;
    app.canvas.dataset.colorBoardWebglCanvas = 'true';
    app.canvas.setAttribute('aria-hidden', 'true');
    Object.assign(app.canvas.style, {
      position: 'absolute',
      inset: '0',
      display: 'block',
      width: '100%',
      height: '100%',
    });
    app.canvas.addEventListener('webglcontextlost', this.handleContextLost, { once: true });
    this.host.appendChild(app.canvas);

    this.world = new Container({ sortableChildren: true, eventMode: 'none' });
    this.circleContainer = new Container({ zIndex: 0, eventMode: 'none' });
    this.cardContainer = new Container({ zIndex: 10, sortableChildren: true, eventMode: 'none' });
    this.selectionGraphics = new Graphics({ zIndex: 30, eventMode: 'none' });
    this.selectionGraphics.visible = false;
    this.world.addChild(this.circleContainer, this.cardContainer, this.selectionGraphics);
    app.stage.addChild(this.world);

    const chromeResolution = resolution * MAX_SCALE;
    ['normal', 'hover', 'selected', 'focus', 'selected-focus'].forEach((state) => {
      this.chromeTextures.set(state, createChromeTexture(state, chromeResolution));
    });

    this.layout = layout;
    this.layoutRevision += 1;
    this._indexCardOrder();
    this.view = view;
    this.selectedIds = selectedIds;
    this.draggingIds = draggingIds;
    this.dropTarget = dropTarget;
    this._rebuildCircles();
    this.setView(view);
    this._syncVisibleCards();

    const resize = () => {
      if (!this.app || this.destroyed) return;
      const nextWidth = Math.max(1, this.host.clientWidth || 1);
      const nextHeight = Math.max(1, this.host.clientHeight || 1);
      this.app.renderer.resize(nextWidth, nextHeight);
      this._syncVisibleCards();
      this._requestRender();
    };
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(resize);
      this.resizeObserver.observe(this.host);
    } else {
      this.handleResize = resize;
      window.addEventListener('resize', resize);
    }
    this._requestRender();
  }

  handleContextLost() {
    if (this.destroyed) return;
    this.onContextLost?.(new Error('WebGL context lost'));
  }

  update({ layout, selectedIds, draggingIds, dropTarget }) {
    if (this.destroyed) return;
    const layoutChanged = this.layout !== layout;
    const dropChanged = this.dropTarget !== dropTarget;
    this.layout = layout;
    this.selectedIds = selectedIds;
    this.draggingIds = draggingIds;
    this.dropTarget = dropTarget;
    if (layoutChanged) {
      this.layoutRevision += 1;
      this._indexCardOrder();
    }
    if (layoutChanged || dropChanged) this._rebuildCircles();
    this._syncVisibleCards();
    this._updateAllCardStates();
    this._requestRender();
  }

  setView(view) {
    this.view = view;
    if (!this.world) return;
    this.world.position.set(view.x, view.y);
    this.world.scale.set(view.scale);
    this._syncVisibleCards();
    this._requestRender();
  }

  beginDrag(ids) {
    this.draggingIds = new Set(ids);
    this.dragOffset = { x: 0, y: 0 };
    this._updateAllCardStates();
    this._requestRender();
  }

  setDragOffset(offset) {
    this.dragOffset = offset;
    this._syncVisibleCards();
    this._requestRender();
  }

  endDrag() {
    this.dragOffset = { x: 0, y: 0 };
    this.draggingIds = new Set();
    this._syncVisibleCards();
    this._updateAllCardStates();
    this._requestRender();
  }

  setHoveredCard(id) {
    if (this.hoveredId === id) return;
    const previous = this.hoveredId;
    this.hoveredId = id;
    if (previous != null) this._updateCardState(previous);
    if (id != null) this._updateCardState(id);
    this._requestRender();
  }

  setFocusedCard(id) {
    if (this.focusedId === id) return;
    const previous = this.focusedId;
    this.focusedId = id;
    if (previous != null) this._updateCardState(previous);
    if (id != null) this._updateCardState(id);
    this._requestRender();
  }

  drawSelectionRect(rect) {
    if (!this.selectionGraphics) return;
    const width = rect.right - rect.left;
    const height = rect.bottom - rect.top;
    this.selectionGraphics.clear();
    if (width > 0 && height > 0) {
      this.selectionGraphics
        .roundRect(rect.left - 0.5, rect.top - 0.5, width + 1, height + 1, 8.5)
        .stroke({ color: cssVariable('--clr-surface-2'), alpha: 0.8, width: 1 });
    }
    if (width > 2 && height > 2) {
      this.selectionGraphics
        .roundRect(rect.left + 1, rect.top + 1, width - 2, height - 2, 7)
        .fill({ color: cssVariable('--clr-accent'), alpha: 0.1 })
        .stroke({ color: cssVariable('--clr-accent'), width: 2 });
    }
    this.selectionGraphics.visible = true;
    this._requestRender();
  }

  hideSelectionRect() {
    if (!this.selectionGraphics) return;
    this.selectionGraphics.visible = false;
    this._requestRender();
  }

  _indexCardOrder() {
    this.cardOrderById = new Map(
      (this.layout?.cards || []).map((card, index) => [card.illustration.id, index]),
    );
  }

  _rebuildCircles() {
    if (!this.circleContainer || !this.layout) return;
    this.circleContainer.removeChildren().forEach((child) => child.destroy({ children: true }));
    const overlayColor = cssVariable('--clr-overlay');

    this.layout.circles.forEach((circle) => {
      const group = new Container({ eventMode: 'none' });
      group.position.set(circle.x, circle.y);

      const shadow = new Graphics();
      const shadowBandWidth = CIRCLE_SHADOW_EXTENT / CIRCLE_SHADOW_BANDS;
      for (let index = CIRCLE_SHADOW_BANDS; index >= 1; index -= 1) {
        const distance = (index - 0.5) * shadowBandWidth;
        shadow
          .circle(0, CIRCLE_SHADOW_OFFSET_Y, circle.radius + distance)
          .stroke({
            color: overlayColor,
            width: shadowBandWidth,
            alpha: circleShadowOpacity(distance),
          });
      }
      const innerShadowBands = Math.ceil(CIRCLE_SHADOW_OFFSET_Y / shadowBandWidth);
      for (let index = 1; index <= innerShadowBands; index += 1) {
        const distance = (index - 0.5) * shadowBandWidth;
        shadow
          .circle(0, CIRCLE_SHADOW_OFFSET_Y, circle.radius - distance)
          .stroke({
            color: overlayColor,
            width: shadowBandWidth,
            alpha: circleShadowOpacity(-distance),
          });
      }

      const body = new Graphics();
      body
        .circle(0, 0, Math.max(0, circle.radius - 1))
        .fill({ color: circle.color })
        .stroke({ color: circle.borderColor, width: 2 });

      group.addChild(shadow, body);
      if (this.dropTarget === circle.id) {
        const outline = new Graphics();
        outline
          .circle(0, 0, circle.radius + 9)
          .stroke({ color: circle.borderColor, width: 6 });
        group.addChild(outline);
      }
      this.circleContainer.addChild(group);
    });
  }

  _visibleBounds() {
    const width = this.host.clientWidth || window.innerWidth || 1;
    const height = this.host.clientHeight || window.innerHeight || 1;
    const scale = this.view.scale || 1;
    return {
      left: -this.view.x / scale,
      top: -this.view.y / scale,
      right: (width - this.view.x) / scale,
      bottom: (height - this.view.y) / scale,
    };
  }

  _syncVisibleCards() {
    if (!this.cardContainer || !this.layout) return;
    const offsetForCard = this.draggingIds.size > 0
      ? (card) => (this.draggingIds.has(card.illustration.id) ? this.dragOffset : null)
      : null;
    const visibleCards = cardsInBoardViewport(
      this.layout.cards,
      this._visibleBounds(),
      WEBGL_CULL_MARGIN,
      offsetForCard,
    );
    const desiredIds = new Set(visibleCards.map((card) => card.illustration.id));
    this.activeTextureIds = desiredIds;

    this.textureCache.forEach((entry, id) => {
      if (desiredIds.has(id) || !entry.promise || entry.texture) return;
      this.textureCache.delete(id);
      destroyCacheEntry(entry);
    });

    this.visibleNodes.forEach((node, id) => {
      if (desiredIds.has(id)) return;
      this.cardContainer.removeChild(node.container);
      node.container.destroy({ children: true });
      this.visibleNodes.delete(id);
    });

    visibleCards.forEach((card) => {
      const id = card.illustration.id;
      let node = this.visibleNodes.get(id);
      if (!node) {
        node = this._createCardNode(card);
        this.visibleNodes.set(id, node);
        this.cardContainer.addChild(node.container);
      } else {
        node.card = card;
      }
      node.order = this.cardOrderById.get(id) || 0;
      this._positionCardNode(node);
      this._updateCardState(id);
      this._ensureCardTexture(card);
      const cached = this.textureCache.get(id);
      if (cached) cached.lastUsed = performance.now();
    });

    const signature = `${this.layoutRevision}:${visibleCards
      .map((card) => card.illustration.id)
      .join(',')}`;
    if (signature !== this.visibleSignature) {
      this.visibleSignature = signature;
      this.onVisibleCardsChange?.(visibleCards);
    }
    this._evictTextureCache();
  }

  _createCardNode(card) {
    const container = new Container({ eventMode: 'none' });
    const placeholder = new Graphics();
    placeholder
      .roundRect(
        -CARD_IMAGE_SIZE / 2,
        -CARD_IMAGE_SIZE / 2,
        CARD_IMAGE_SIZE,
        CARD_IMAGE_SIZE,
        CARD_IMAGE_RADIUS,
      )
      .fill({ color: cssVariable('--clr-surface-2') });
    const chrome = new Sprite(this.chromeTextures.get('normal'));
    chrome.position.set(-CARD_SIZE / 2 - CHROME_MARGIN, -CARD_SIZE / 2 - CHROME_MARGIN);
    container.addChild(placeholder, chrome);
    return {
      card,
      chrome,
      container,
      imageSprite: null,
      order: this.cardOrderById.get(card.illustration.id) || 0,
      placeholder,
    };
  }

  _positionCardNode(node) {
    const id = node.card.illustration.id;
    const dragging = this.draggingIds.has(id);
    const offset = dragging ? this.dragOffset : { x: 0, y: 0 };
    node.container.position.set(
      node.card.x + CARD_SIZE / 2 + offset.x,
      node.card.y + CARD_SIZE / 2 + offset.y,
    );
    node.container.rotation = (node.card.rotation || 0) * Math.PI / 180;
  }

  _chromeState(id) {
    const selected = this.selectedIds.has(id);
    const focused = this.focusedId === id;
    if (focused) return selected ? 'selected-focus' : 'focus';
    if (selected) return 'selected';
    if (this.hoveredId === id) return 'hover';
    return 'normal';
  }

  _updateCardState(id) {
    const node = this.visibleNodes.get(id);
    if (!node) return;
    const dragging = this.draggingIds.has(id);
    node.chrome.texture = this.chromeTextures.get(this._chromeState(id));
    node.container.scale.set(dragging ? 1.05 : 1);
    node.container.zIndex = dragging
      ? (this.layout?.cards.length || 0) + node.order
      : node.order;
    node.container.filters = dragging ? [this.dragFilter] : [];
    this._positionCardNode(node);
  }

  _updateAllCardStates() {
    this.visibleNodes.forEach((node, id) => this._updateCardState(id));
  }

  _ensureCardTexture(card) {
    const id = card.illustration.id;
    const url = backendUrl(`${card.illustration.thumbnail_url}?quality=${BOARD_CARD_QUALITY}`);
    const current = this.textureCache.get(id);
    if (current?.url === url) {
      if (current.texture) this._attachTexture(id, current.texture);
      return;
    }
    if (current) {
      this.textureCacheBytes -= current.bytes || 0;
      destroyCacheEntry(current);
      this.textureCache.delete(id);
    }

    const loading = createIllustrationTexture(card.illustration);
    const entry = {
      url,
      texture: null,
      source: null,
      image: loading.image,
      cancel: loading.cancel,
      bytes: 0,
      lastUsed: performance.now(),
      failed: false,
    };
    this.textureCache.set(id, entry);
    entry.promise = loading.promise
      .then((loaded) => {
        if (this.destroyed || this.textureCache.get(id) !== entry) {
          destroyCacheEntry(loaded);
          return;
        }
        Object.assign(entry, loaded, { cancel: null, promise: null });
        this.textureCacheBytes += loaded.bytes;
        if (this.activeTextureIds.has(id)) this._attachTexture(id, loaded.texture);
        this._evictTextureCache();
        this._requestRender();
      })
      .catch(() => {
        if (this.textureCache.get(id) === entry) {
          entry.promise = null;
          entry.failed = true;
        }
      });
  }

  _attachTexture(id, texture) {
    const node = this.visibleNodes.get(id);
    if (!node || node.imageSprite?.texture === texture) return;
    if (node.imageSprite) {
      node.container.removeChild(node.imageSprite);
      node.imageSprite.destroy();
    }
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.width = CARD_IMAGE_SIZE;
    sprite.height = CARD_IMAGE_SIZE;
    node.imageSprite = sprite;
    node.container.addChildAt(sprite, 1);
  }

  _evictTextureCache() {
    if (this.textureCacheBytes <= WEBGL_TEXTURE_CACHE_BYTES) return;
    const candidates = [...this.textureCache.entries()]
      .filter(([id, entry]) => !this.activeTextureIds.has(id) && entry.texture)
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed);
    for (const [id, entry] of candidates) {
      if (this.textureCacheBytes <= WEBGL_TEXTURE_CACHE_BYTES) break;
      this.textureCache.delete(id);
      this.textureCacheBytes -= entry.bytes || 0;
      destroyCacheEntry(entry);
    }
  }

  _requestRender() {
    if (!this.app || this.renderFrame != null || this.destroyed) return;
    this.renderFrame = requestFrame(() => {
      this.renderFrame = null;
      if (!this.app || this.destroyed) return;
      this.app.render();
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelFrame(this.renderFrame);
    this.renderFrame = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.handleResize) window.removeEventListener('resize', this.handleResize);
    this.handleResize = null;
    if (this.app?.canvas) {
      this.app.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    }
    const cacheEntries = [...this.textureCache.values()];
    const chromeTextures = [...this.chromeTextures.values()];
    if (this.app) {
      this.app.destroy(
        { removeView: true },
        { children: true, context: true },
      );
    }
    cacheEntries.forEach(destroyCacheEntry);
    chromeTextures.forEach((texture) => {
      const source = texture.source;
      try { texture.destroy(); } catch {}
      try { source?.destroy?.(); } catch {}
    });
    this.textureCache.clear();
    this.textureCacheBytes = 0;
    this.visibleNodes.clear();
    this.cardOrderById.clear();
    this.activeTextureIds.clear();
    this.app = null;
    this.world = null;
    this.circleContainer = null;
    this.cardContainer = null;
    this.selectionGraphics = null;
    this.chromeTextures.clear();
  }
}
