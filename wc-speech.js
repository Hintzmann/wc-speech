import {
  fallbackSentenceSegments,
  mergeAbbreviationSegments,
} from './wc-speech-segment.js';

class WcSpeech extends HTMLElement {
  static observedAttributes = ['prefer-voice', 'target', 'scroll', 'label-play', 'label-pause'];

  static #FLOW_CONTAINER_TAGS = new Set([
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'li', 'dd', 'dt', 'blockquote', 'figcaption', 'td', 'th', 'caption',
  ]);

  static #NESTED_BLOCK_TAGS = new Set([
    ...WcSpeech.#FLOW_CONTAINER_TAGS,
    'div', 'section', 'article', 'main', 'nav', 'aside', 'header', 'footer',
    'ul', 'ol', 'dl', 'table', 'figure', 'details', 'fieldset', 'form', 'hr',
  ]);

  static #FLOW_BREAKER_TAGS = new Set(['img', 'time', 'video', 'audio', 'pre']);

  static #SKIP_TAGS = new Set(['select', 'input', 'textarea', 'button', 'script', 'style', 'noscript']);

  static #strings = {
    'label-play': 'Play',
    'label-pause': 'Pause',
    'status-speaking': 'Speaking',
    'status-paused': 'Paused',
    'status-finished': 'Finished',
    'error-unsupported': 'Speech is not supported in this browser.',
    'error-missing-lang': 'Add a lang attribute to the html element before starting speech.',
    'error-missing-target': 'Set a target attribute on wc-speech pointing at readable content.',
    'error-target-not-found': 'The target selector did not match any element on the page.',
    'error-empty-content': 'There is no readable text in the target content.',
    'error-synthesis-failed': 'Speech synthesis failed. Try another voice or browser.',
  };

  static #instance = null;

  static _resetInstanceForTests() {
    WcSpeech.#instance = null;
  }

  #voiceSelect;
  #rateControl;
  #optionsPopover;
  #selectionToolbar;
  #markedRange = null;
  #markedText = '';
  #markedRangeBoundaries = null;
  #selectionChangeTimer = 0;
  #statusRegion;
  #errorRegion;
  #controlBar;
  #scrollCheckbox;
  #segmenters = new Map();
  #target;
  #voices = [];
  #nodeList = [];
  #nodeIndex = 0;
  #resumeNodeIndex = null;
  #nodeParent = new WeakMap();
  #sentenceSegments = new WeakMap();
  #defaultVoice = null;
  #defaultLang = '';
  #wordHighlight;
  #sentenceHighlight;
  #lastHighlightedElement = null;
  #lastSentenceRange = null;
  #supportsSpeech = false;
  #registered = false;
  #paused = false;
  #speechSource = null;
  #speakId = 0;
  #keepAliveTimer = null;
  #scrollRaf = 0;
  #scrollTarget = null;
  #optionsOpenBeforePointerDown = false;
  #escapeStopBound = false;
  #onVoicesChanged = () => this.#populateVoiceList();
  #onCommandButtonClick = (event) => this.#handleCommandButtonClick(event);
  #onPointerDown = (event) => this.#handlePointerDown(event);
  #onKeydown = (event) => this.#handleKeydown(event);
  #onOptionsToggle = () => this.#updateOptionsButton();
  #onScrollToggle = () => this.toggleAttribute('scroll', Boolean(this.#scrollCheckbox?.checked));
  #onMouseup = () => {
    setTimeout(() => this.#handleSelection(), 0);
  };
  #onSelectionChange = () => {
    if (this.#selectionChangeTimer) {
      clearTimeout(this.#selectionChangeTimer);
    }

    this.#selectionChangeTimer = setTimeout(() => {
      this.#selectionChangeTimer = 0;
      this.#handleSelection();
    }, 50);
  };
  #onSelectionToolbarToggle = (event) => {
    if (event.newState === 'closed') {
      this.#clearMarkedSelection();
    }
  };

  connectedCallback() {
    if (WcSpeech.#instance && WcSpeech.#instance !== this) {
      this.#markAsDuplicateInstance();
      return;
    }

    WcSpeech.#instance = this;
    this.#registered = true;
    this.#activate();
  }

  disconnectedCallback() {
    if (!this.#registered) {
      this.removeAttribute('data-speech-blocked');
      return;
    }

    this.removeEventListener('command', this);
    this.#optionsPopover?.removeEventListener('toggle', this.#onOptionsToggle);
    this.#unbindSelectionHandlers();
    this.#scrollCheckbox?.removeEventListener('change', this.#onScrollToggle);
    document.removeEventListener('pointerdown', this.#onPointerDown, { capture: true });
    document.removeEventListener('click', this.#onCommandButtonClick);
    this.#unbindEscapeStop();

    this.#speakId += 1;
    this.#clearKeepAlive();
    this.#cancelScheduledScroll();

    if (this.#supportsSpeech && 'speechSynthesis' in window) {
      speechSynthesis.removeEventListener('voiceschanged', this.#onVoicesChanged);
      speechSynthesis.cancel();
    }

    this.#clearHighlight();
    this.classList.remove('speaking');

    if (this.#sentenceHighlight) {
      globalThis.CSS?.highlights?.delete('speech-sentence');
    }
    if (this.#wordHighlight) {
      globalThis.CSS?.highlights?.delete('speech-word');
    }

    WcSpeech.#instance = null;
    this.#registered = false;

    const next = document.querySelector('wc-speech[data-speech-blocked="duplicate"]');
    if (next instanceof WcSpeech) {
      WcSpeech.#instance = next;
      next.#registered = true;
      next.#activate();
    }
  }

  #markAsDuplicateInstance() {
    this.#registered = false;
    console.warn('wc-speech: Only one <wc-speech> element is allowed per page. This instance is disabled.');
    this.setAttribute('data-speech-blocked', 'duplicate');
    this.#applyButtonTitles();
    this.#resolveControls();
    this.#optionsPopover = this.#resolveOptionsPopover();
    this.#statusRegion = this.#resolveStatusRegion();
    this.#errorRegion = this.#resolveErrorRegion();
    this.#controlBar = this.#resolveControlBar();
    this.#revealHost();

    if (this.#scrollCheckbox) {
      this.#scrollCheckbox.checked = this.hasAttribute('scroll');
    }

    this.#setControlsDisabled(true);
  }

  #activate() {
    this.removeAttribute('data-speech-blocked');
    this.#applyButtonTitles();
    this.#resolveControls();
    this.#optionsPopover = this.#resolveOptionsPopover();
    this.#selectionToolbar = this.#resolveSelectionToolbar();
    this.#statusRegion = this.#resolveStatusRegion();
    this.#errorRegion = this.#resolveErrorRegion();
    this.#controlBar = this.#resolveControlBar();
    this.#revealHost();
    this.#supportsSpeech = this.#supportsSpeechSynthesis();

    if (this.#scrollCheckbox) {
      this.#scrollCheckbox.checked = this.hasAttribute('scroll');
    }

    if (!this.#supportsSpeech) {
      this.#setControlsDisabled(true);
      this.#setSpeechState('unsupported');
      this.#reportError('unsupported');
      return;
    }

    this.#setSpeechState('ready');

    this.#optionsPopover?.addEventListener('toggle', this.#onOptionsToggle);
    this.#bindSelectionHandlers();
    this.#scrollCheckbox?.addEventListener('change', this.#onScrollToggle);
    document.addEventListener('pointerdown', this.#onPointerDown, { capture: true });

    if ('Highlight' in window && globalThis.CSS?.highlights) {
      this.#sentenceHighlight = new Highlight();
      this.#wordHighlight = new Highlight();
      if ('priority' in this.#sentenceHighlight && 'priority' in this.#wordHighlight) {
        this.#sentenceHighlight.priority = 0;
        this.#wordHighlight.priority = 1;
      }
      CSS.highlights.set('speech-sentence', this.#sentenceHighlight);
      CSS.highlights.set('speech-word', this.#wordHighlight);
    }

    this.addEventListener('command', this);
    if (!this.#supportsInvokerCommands()) {
      document.addEventListener('click', this.#onCommandButtonClick);
    }

    speechSynthesis.addEventListener('voiceschanged', this.#onVoicesChanged);
    this.#populateVoiceList();
    this.#updateControlState();
  }

  attributeChangedCallback(name) {
    if (!this.isConnected || !this.#registered) {
      return;
    }

    if (name === 'scroll' && this.#scrollCheckbox) {
      this.#scrollCheckbox.checked = this.hasAttribute('scroll');
    }

    if (name === 'label-play' || name === 'label-pause') {
      this.#updateControlState();
    }

    if (name === 'prefer-voice') {
      this.#populateVoiceList();
    }
  }

  handleEvent(event) {
    if (event.type !== 'command' || !this.#registered) {
      return;
    }

    this.#runCommand(event.command, event.source);
  }

  #handleCommandButtonClick(event) {
    if (!this.#registered) {
      return;
    }

    const button = event.target.closest?.('button[commandfor][command]');
    if (!button || button.getAttribute('commandfor') !== this.id) {
      return;
    }

    this.#runCommand(button.getAttribute('command'), button);
  }

  #handlePointerDown(event) {
    const button = event.target.closest?.('button[commandfor][command]');
    this.#optionsOpenBeforePointerDown = Boolean(
      button
      && button.getAttribute('commandfor') === this.id
      && button.getAttribute('command') === '--toggle-options'
      && this.#isOptionsOpen()
    );
  }

  #bindEscapeStop() {
    if (this.#escapeStopBound) {
      return;
    }

    document.addEventListener('keydown', this.#onKeydown);
    this.#escapeStopBound = true;
  }

  #unbindEscapeStop() {
    if (!this.#escapeStopBound) {
      return;
    }

    document.removeEventListener('keydown', this.#onKeydown);
    this.#escapeStopBound = false;
  }

  #handleKeydown(event) {
    if (event.key !== 'Escape' || event.defaultPrevented) {
      return;
    }

    if (!this.#registered || !this.#supportsSpeech) {
      return;
    }

    if (this.#isSelectionToolbarOpen()) {
      this.#closeSelectionToolbar();
      event.preventDefault();
      return;
    }

    if (this.#isOptionsOpen()) {
      this.#closeOptions();
      event.preventDefault();
      return;
    }

    if (!this.classList.contains('speaking')) {
      return;
    }

    this.#stopSpeech();
    event.preventDefault();
  }

  #runCommand(command, source) {
    if (!this.#registered || !this.#supportsSpeech) {
      return;
    }

    switch (command) {
      case '--show-controls':
        this.#showControls(source);
        break;
      case '--hide-controls':
        this.#hideControls();
        break;
      case '--toggle-options':
        this.#toggleOptions();
        break;
      case '--playpause':
        this.#playpause();
        break;
      case '--previous-sentence':
        this.#previousSentence();
        break;
      case '--next-sentence':
        this.#nextSentence();
        break;
      case '--speech-marked':
        this.#speakMarked();
        break;
    }
  }

  #supportsInvokerCommands() {
    return 'commandForElement' in HTMLButtonElement.prototype;
  }

  #supportsSpeechSynthesis() {
    return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  }

  #documentLang() {
    return document.documentElement.getAttribute('lang')?.trim() ?? '';
  }

  #setSpeechState(state) {
    this.setAttribute('data-speech-state', state);
  }

  #reportError(code, detail = {}) {
    const message = this.#text(`error-${code}`);
    this.#setSpeechState(code === 'unsupported' ? 'unsupported' : 'error');
    this.dataset.speechErrorCode = code;

    if (this.#errorRegion) {
      this.#errorRegion.textContent = message;
      this.#errorRegion.hidden = false;
    }

    this.#announce(message, { assertive: true });
    console.warn(`wc-speech [${code}]: ${message}`);

    this.#dispatch('speech-error', {
      index: this.#nodeIndex,
      code,
      message,
      ...detail,
    });
  }

  #clearError() {
    if (this.getAttribute('data-speech-state') === 'error') {
      this.#setSpeechState(this.#supportsSpeech ? 'ready' : 'unsupported');
    }

    delete this.dataset.speechErrorCode;

    if (this.#errorRegion) {
      this.#errorRegion.textContent = '';
      this.#errorRegion.hidden = true;
    }
  }

  #inheritedLangFrom(el) {
    while (el) {
      const lang = el.getAttribute('lang')?.trim();
      if (lang) {
        return lang;
      }

      if (el === document.documentElement) {
        break;
      }
      el = el.parentElement;
    }

    return '';
  }

  #setControlsDisabled(disabled) {
    this.#voiceSelect?.toggleAttribute('disabled', disabled);
    this.#rateControl?.toggleAttribute('disabled', disabled);
    this.#scrollCheckbox?.toggleAttribute('disabled', disabled);
    for (const button of this.#commandButtons()) {
      button.toggleAttribute('disabled', disabled);
    }
  }

  #commandButtons() {
    if (!this.id) {
      return [];
    }

    return document.querySelectorAll(
      `button[commandfor="${CSS.escape(this.id)}"][command]`,
    );
  }

  #buttonForCommand(command) {
    return this.#buttonsForCommand(command)[0] ?? null;
  }

  #buttonsForCommand(command) {
    if (!this.id) {
      return [];
    }

    return document.querySelectorAll(
      `button[commandfor="${CSS.escape(this.id)}"][command="${CSS.escape(command)}"]`,
    );
  }

  #updateControlState() {
    const isActive = this.#supportsSpeech && this.classList.contains('speaking');
    const isPaused = this.#supportsSpeech && this.#paused;
    const previous = this.#buttonForCommand('--previous-sentence');
    const next = this.#buttonForCommand('--next-sentence');
    const action = !isActive || isPaused ? 'play' : 'pause';

    this.#voiceSelect?.toggleAttribute('disabled', !this.#supportsSpeech);
    this.#rateControl?.toggleAttribute('disabled', !this.#supportsSpeech);
    this.#scrollCheckbox?.toggleAttribute('disabled', !this.#supportsSpeech);
    previous?.toggleAttribute('disabled', !isActive || this.#nodeIndex <= 0);
    next?.toggleAttribute('disabled', !isActive || this.#nodeIndex >= this.#nodeList.length - 1);

    for (const button of this.#buttonsForCommand('--playpause')) {
      button.toggleAttribute('disabled', !this.#supportsSpeech);
      this.#syncPlayPauseButton(button, action);
    }

    for (const button of this.#buttonsForCommand('--speech-marked')) {
      button.toggleAttribute('disabled', !this.#supportsSpeech);
      this.#syncPlayPauseButton(button, action);
    }
  }

  #syncPlayPauseButton(button, action) {
    button.setAttribute('data-speech-action', action);

    const faces = button.querySelectorAll('[data-speech-face]');
    if (faces.length > 0) {
      for (const face of faces) {
        face.hidden = face.getAttribute('data-speech-face') !== action;
      }
    }

    if (button.hasAttribute('data-speech-manual-a11y')) {
      return;
    }

    const hasVisibleFaceLabel = [...faces].some(
      (face) => !face.hidden && face.getAttribute('aria-hidden') !== 'true'
    );

    if (hasVisibleFaceLabel) {
      button.removeAttribute('aria-label');
      button.removeAttribute('title');
      return;
    }

    const label = this.#text(action === 'play' ? 'label-play' : 'label-pause');
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  }

  #resolveControls() {
    this.#voiceSelect = this.#querySpeechHook(
      '[data-speech-voice]',
      '[data-speech-voice]',
      (element) => element instanceof HTMLSelectElement,
      'Expected a <select> element.',
    );
    this.#rateControl = this.#querySpeechHook(
      '[data-speech-rate]',
      '[data-speech-rate]',
      (element) => 'value' in element,
      'Expected a form control with a numeric value (for example <select>, <input type="range">, or <input type="number">).',
    );
    this.#scrollCheckbox = this.#querySpeechHook(
      '[data-speech-scroll]',
      '[data-speech-scroll]',
      (element) => element instanceof HTMLInputElement && element.type === 'checkbox',
      'Expected <input type="checkbox">.',
    );
  }

  #querySpeechHook(selector, hookName, validate, invalidMessage) {
    const matches = this.querySelectorAll(selector);
    if (matches.length === 0) {
      return null;
    }

    if (matches.length > 1) {
      console.warn(`wc-speech: Multiple ${hookName} hooks found; using the first.`);
    }

    const element = matches[0];
    if (!validate(element)) {
      console.warn(`wc-speech: Invalid ${hookName} hook. ${invalidMessage}`);
      return null;
    }

    return element;
  }

  #resolveStatusRegion() {
    return this.querySelector('[role="status"]');
  }

  #resolveErrorRegion() {
    return this.querySelector('[data-speech-error]');
  }

  #resolveControlBar() {
    return this.querySelector('[data-speech-bar]')
      ?? this.querySelector('.speech-bar');
  }

  #revealHost() {
    this.removeAttribute('hidden');
    this.setAttribute('aria-hidden', 'true');
  }

  #isControlBarVisible() {
    return Boolean(this.#controlBar && !this.#controlBar.hidden);
  }

  #announce(message, { assertive = false } = {}) {
    const region = this.#statusRegion;
    if (!region) {
      return;
    }

    if (message === '') {
      region.textContent = '';
      return;
    }

    if (assertive) {
      region.setAttribute('aria-live', 'assertive');
    }

    // Force re-announcement when the same status string is set twice in a row.
    region.textContent = '';
    requestAnimationFrame(() => {
      region.textContent = message;
      if (assertive) {
        region.setAttribute('aria-live', 'polite');
      }
    });
  }

  #text(name) {
    return this.getAttribute(name) ?? WcSpeech.#strings[name];
  }

  #applyButtonTitles() {
    for (const button of this.#commandButtons()) {
      const label = button.getAttribute('aria-label');
      if (label && !button.hasAttribute('title')) {
        button.setAttribute('title', label);
      }
    }
  }

  #resolveOptionsPopover() {
    return this.querySelector('[popover]:not([role="toolbar"])');
  }

  #resolveSelectionToolbar() {
    return this.querySelector('[popover][role="toolbar"]');
  }

  #bindSelectionHandlers() {
    if (!this.#selectionToolbar) {
      return;
    }

    this.#selectionToolbar.hidden = true;
    this.#selectionToolbar.addEventListener('toggle', this.#onSelectionToolbarToggle);
    document.addEventListener('mouseup', this.#onMouseup);
    document.addEventListener('selectionchange', this.#onSelectionChange);
  }

  #unbindSelectionHandlers() {
    if (this.#selectionChangeTimer) {
      clearTimeout(this.#selectionChangeTimer);
      this.#selectionChangeTimer = 0;
    }

    this.#selectionToolbar?.removeEventListener('toggle', this.#onSelectionToolbarToggle);
    document.removeEventListener('mouseup', this.#onMouseup);
    document.removeEventListener('selectionchange', this.#onSelectionChange);
  }

  #resolveTarget() {
    const selector = this.getAttribute('target')?.trim();
    if (!selector) {
      return null;
    }

    return document.querySelector(selector);
  }

  #selectionNodeElement(node) {
    if (!node) {
      return null;
    }

    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  }

  #isNodeInsideSelectionToolbar(node) {
    const element = this.#selectionNodeElement(node);
    return Boolean(element && this.#selectionToolbar?.contains(element));
  }

  #clearMarkedSelection() {
    this.#markedRange = null;
    this.#markedText = '';
    this.#markedRangeBoundaries = null;
  }

  #resolveMarkedRange() {
    if (this.#markedRangeBoundaries) {
      const { startContainer, startOffset, endContainer, endOffset } = this.#markedRangeBoundaries;
      const range = document.createRange();
      range.setStart(startContainer, startOffset);
      range.setEnd(endContainer, endOffset);
      if (!range.collapsed) {
        return range;
      }
    }

    const clone = this.#markedRange?.cloneRange();
    return clone?.collapsed ? null : clone ?? null;
  }

  #handleSelection() {
    if (!this.#selectionToolbar || !this.#registered) {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      if (this.#isSelectionToolbarOpen()) {
        this.#closeSelectionToolbar();
      }
      return;
    }

    const range = selection.getRangeAt(0);
    if (range.collapsed) {
      if (this.#isSelectionToolbarOpen()) {
        this.#closeSelectionToolbar();
      }
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      if (this.#isSelectionToolbarOpen()) {
        this.#closeSelectionToolbar();
      }
      return;
    }

    if (
      this.#isNodeInsideSelectionToolbar(selection.anchorNode)
      || this.#isNodeInsideSelectionToolbar(selection.focusNode)
    ) {
      return;
    }

    const target = this.#resolveTarget();
    if (!target) {
      return;
    }

    const ancestor = range.commonAncestorContainer;
    const element = this.#selectionNodeElement(ancestor);
    if (!element || !target.contains(element) || this.contains(element)) {
      if (this.#isSelectionToolbarOpen()) {
        this.#closeSelectionToolbar();
      }
      return;
    }

    this.#markedRange = range.cloneRange();
    this.#markedText = selection.toString();
    this.#markedRangeBoundaries = {
      startContainer: range.startContainer,
      startOffset: range.startOffset,
      endContainer: range.endContainer,
      endOffset: range.endOffset,
    };
    this.#openSelectionToolbar();
  }

  #supportsSelectionPopover() {
    const toolbar = this.#selectionToolbar;
    return Boolean(
      toolbar
      && 'popover' in HTMLElement.prototype
      && typeof toolbar.showPopover === 'function',
    );
  }

  #isSelectionToolbarOpen() {
    if (!this.#selectionToolbar) {
      return false;
    }

    return this.#supportsSelectionPopover()
      ? this.#selectionToolbar.matches(':popover-open')
      : !this.#selectionToolbar.hidden;
  }

  #positionSelectionToolbar() {
    const toolbar = this.#selectionToolbar;
    const range = this.#markedRange;
    if (!toolbar || !range) {
      return;
    }

    toolbar.hidden = false;
    if (this.#supportsSelectionPopover() && !this.#isSelectionToolbarOpen()) {
      toolbar.showPopover();
    }

    const rect = range.getBoundingClientRect();
    const width = toolbar.offsetWidth;
    const height = toolbar.offsetHeight;
    const gap = 8;
    const margin = 8;

    let left = rect.left + rect.width / 2 - width / 2;
    let top = rect.top - height - gap;

    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));

    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;
  }

  #openSelectionToolbar() {
    if (!this.#selectionToolbar) {
      return;
    }

    this.#positionSelectionToolbar();
  }

  #closeSelectionToolbar() {
    if (!this.#selectionToolbar) {
      return;
    }

    if (this.#supportsSelectionPopover() && this.#isSelectionToolbarOpen()) {
      this.#selectionToolbar.hidePopover();
    }

    this.#selectionToolbar.hidden = true;
    this.#clearMarkedSelection();
  }

  #supportsPopover() {
    return 'popover' in HTMLElement.prototype && typeof this.#optionsPopover?.showPopover === 'function';
  }

  #followsScroll() {
    return this.hasAttribute('scroll');
  }

  #prefersReducedMotion() {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  #clearKeepAlive() {
    if (this.#keepAliveTimer !== null) {
      clearInterval(this.#keepAliveTimer);
      this.#keepAliveTimer = null;
    }
  }

  #startKeepAlive() {
    this.#clearKeepAlive();
    // Chrome silently stops speech ~15s into long utterances without a heartbeat.
    this.#keepAliveTimer = setInterval(() => {
      if (!this.classList.contains('speaking') || this.#paused) {
        return;
      }
      if (speechSynthesis.speaking && !speechSynthesis.pending) {
        speechSynthesis.pause();
        speechSynthesis.resume();
      }
    }, 10_000);
  }

  #scheduleFollowInView(target) {
    this.#scrollTarget = target;
    if (this.#scrollRaf) {
      return;
    }
    this.#scrollRaf = requestAnimationFrame(() => {
      this.#scrollRaf = 0;
      const scrollTarget = this.#scrollTarget;
      this.#scrollTarget = null;
      if (scrollTarget) {
        this.#followInView(scrollTarget);
      }
    });
  }

  #cancelScheduledScroll() {
    if (this.#scrollRaf) {
      cancelAnimationFrame(this.#scrollRaf);
      this.#scrollRaf = 0;
    }
    this.#scrollTarget = null;
  }

  #dispatch(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, {
      bubbles: true,
      composed: true,
      detail,
    }));
  }

  #followInView(target) {
    if (!this.#followsScroll() || !target?.getBoundingClientRect) {
      return;
    }

    const rect = target.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return;
    }

    const margin = 16;
    const topInset = (this.#isControlBarVisible() ? this.getBoundingClientRect().bottom : 0) + margin;
    const bottomInset = window.innerHeight - margin;

    let delta = 0;
    if (rect.top < topInset) {
      delta = rect.top - topInset;
    } else if (rect.bottom > bottomInset) {
      delta = Math.min(rect.bottom - bottomInset, rect.top - topInset);
    }

    if (delta !== 0) {
      window.scrollBy({
        top: delta,
        behavior: this.#prefersReducedMotion() ? 'auto' : 'smooth',
      });
    }
  }

  #showControls(source) {
    if (this.#controlBar) {
      this.#controlBar.hidden = false;
    }

    (source ?? this.#buttonForCommand('--show-controls'))?.toggleAttribute('hidden', true);
    this.#updateControlState();
    this.#buttonForCommand('--playpause')?.focus();
  }

  #hideControls() {
    this.#stopSpeech();
    this.#closeOptions();

    if (this.#controlBar) {
      this.#controlBar.hidden = true;
    }

    const showButton = this.#buttonForCommand('--show-controls');
    showButton?.removeAttribute('hidden');
    showButton?.focus();
  }

  #stopSpeech() {
    this.#unbindEscapeStop();

    if (this.classList.contains('speaking')) {
      this.#resumeNodeIndex = this.#nodeIndex;
    }

    this.#speakId += 1;
    this.#clearKeepAlive();
    this.#cancelScheduledScroll();
    speechSynthesis.cancel();
    this.#clearHighlight();
    this.classList.remove('speaking');
    this.#paused = false;
    this.#speechSource = null;
    this.#announce('');
    this.#setSpeechState('ready');
    this.#updateControlState();
    this.#dispatch('speech-stop', { index: this.#nodeIndex });
  }

  #toggleOptions() {
    if (!this.#optionsPopover) {
      return;
    }

    const wasOpen = this.#optionsOpenBeforePointerDown || this.#isOptionsOpen();
    this.#optionsOpenBeforePointerDown = false;

    if (wasOpen) {
      this.#closeOptions();
    } else {
      this.#openOptions();
    }
  }

  #openOptions() {
    if (!this.#optionsPopover) {
      return;
    }

    this.#optionsPopover.hidden = false;
    if (this.#supportsPopover()) {
      this.#optionsPopover.showPopover();
    }
    this.#updateOptionsButton();
  }

  #closeOptions() {
    if (!this.#optionsPopover) {
      return;
    }

    if (this.#supportsPopover() && this.#optionsPopover.matches(':popover-open')) {
      this.#optionsPopover.hidePopover();
    }
    this.#optionsPopover.hidden = true;
    this.#updateOptionsButton();
  }

  #isOptionsOpen() {
    if (!this.#optionsPopover) {
      return false;
    }

    return this.#supportsPopover()
      ? this.#optionsPopover.matches(':popover-open')
      : !this.#optionsPopover.hidden;
  }

  #updateOptionsButton() {
    this.#buttonForCommand('--toggle-options')
      ?.setAttribute('aria-expanded', String(this.#isOptionsOpen()));
  }

  #rate() {
    const rate = Number.parseFloat(this.#rateControl?.value);
    if (!Number.isFinite(rate)) {
      return 1;
    }

    return Math.min(10, Math.max(0.1, rate));
  }

  #populateVoiceList() {
    if (!this.#supportsSpeech) {
      return;
    }

    this.#voices = speechSynthesis.getVoices();
    const select = this.#voiceSelect;
    if (!select) {
      return;
    }

    const previousVoiceURI = select.value;
    const preferredLang = this.#documentLang();
    const preferredVoice = this.#voiceByURI(previousVoiceURI)
      ?? this.#findVoiceForLang(preferredLang)
      ?? this.#voices.find((voice) => voice.default)
      ?? this.#voices[0]
      ?? null;

    select.replaceChildren();

    for (const voice of this.#voices) {
      const option = document.createElement('option');
      option.textContent = `${voice.name} (${voice.lang})`;
      option.value = voice.voiceURI;
      if (voice === preferredVoice) {
        option.id = 'default-voice';
        option.selected = true;
      }
      select.appendChild(option);
    }
  }

  #resetNodeListState() {
    this.#nodeList = [];
    this.#nodeIndex = 0;
    this.#nodeParent = new WeakMap();
    this.#sentenceSegments = new WeakMap();
  }

  #collectNodeListFromTarget(target, inheritedLang) {
    this.#resetNodeListState();
    this.#collectNodes(target, inheritedLang);
    return this.#nodeList;
  }

  #rangesOverlap(a, b) {
    if (!a || !b) {
      return false;
    }

    return a.compareBoundaryPoints(Range.END_TO_START, b) > 0
      && b.compareBoundaryPoints(Range.END_TO_START, a) > 0;
  }

  #rangeIntersectsSelection(entryRange, selectionRange) {
    if (!entryRange || !selectionRange) {
      return false;
    }

    if (this.#rangesOverlap(entryRange, selectionRange)) {
      return true;
    }

    if (typeof selectionRange.intersectsNode !== 'function') {
      return false;
    }

    return selectionRange.intersectsNode(entryRange.startContainer)
      || selectionRange.intersectsNode(entryRange.endContainer);
  }

  #clipRangeToOverlap(a, b) {
    if (!this.#rangeIntersectsSelection(a, b)) {
      return null;
    }

    const clipped = document.createRange();

    if (a.compareBoundaryPoints(Range.START_TO_START, b) <= 0) {
      clipped.setStart(b.startContainer, b.startOffset);
    } else {
      clipped.setStart(a.startContainer, a.startOffset);
    }

    if (a.compareBoundaryPoints(Range.END_TO_END, b) >= 0) {
      clipped.setEnd(b.endContainer, b.endOffset);
    } else {
      clipped.setEnd(a.endContainer, a.endOffset);
    }

    return clipped.collapsed ? null : clipped;
  }

  #entryDomRange(entry) {
    const range = this.#entryRange(entry);
    if (range) {
      return range;
    }

    const textNode = entry.node;
    if (!textNode) {
      return null;
    }

    if (this.#nodeParent.has(textNode)) {
      const element = this.#nodeParent.get(textNode);
      const syntheticRange = document.createRange();
      syntheticRange.selectNode(element);
      return syntheticRange;
    }

    const nodeRange = document.createRange();
    nodeRange.selectNodeContents(textNode);
    return nodeRange;
  }

  #spanDomRange(span) {
    const range = document.createRange();

    if (span.element) {
      range.selectNode(span.element);
      return range;
    }

    if (!span.node) {
      return null;
    }

    range.setStart(span.node, span.start);
    range.setEnd(span.node, span.end);
    return range;
  }

  #clipTextNodeEntryToRange(entry, selectionRange) {
    const entryRange = this.#entryDomRange(entry);
    const clippedRange = this.#clipRangeToOverlap(entryRange, selectionRange);
    if (!clippedRange || clippedRange.startContainer !== entry.node || clippedRange.endContainer !== entry.node) {
      return null;
    }

    const start = Number.isFinite(entry.start)
      ? Math.max(entry.start, clippedRange.startOffset)
      : clippedRange.startOffset;
    const end = Number.isFinite(entry.end)
      ? Math.min(entry.end, clippedRange.endOffset)
      : clippedRange.endOffset;
    if (start >= end) {
      return null;
    }

    return {
      node: entry.node,
      lang: entry.lang,
      start,
      end,
    };
  }

  #clipSpanEntryToRange(entry, selectionRange) {
    const entryRange = this.#entryDomRange(entry);
    const clippedEntryRange = this.#clipRangeToOverlap(entryRange, selectionRange);
    if (!clippedEntryRange) {
      return null;
    }

    const textParts = [];
    const spanParts = [];

    for (const span of entry.spans) {
      const spanRange = this.#spanDomRange(span);
      if (!spanRange || !this.#rangeIntersectsSelection(spanRange, selectionRange)) {
        continue;
      }

      if (span.element) {
        const text = entry.text.slice(span.runStart, span.runEnd);
        if (text.trim() === '') {
          continue;
        }

        textParts.push(text);
        spanParts.push({
          element: span.element,
          start: 0,
          end: text.length,
        });
        continue;
      }

      const clippedSpanRange = this.#clipRangeToOverlap(spanRange, clippedEntryRange);
      if (!clippedSpanRange || clippedSpanRange.startContainer !== span.node || clippedSpanRange.endContainer !== span.node) {
        continue;
      }

      const start = Math.max(span.start, clippedSpanRange.startOffset);
      const end = Math.min(span.end, clippedSpanRange.endOffset);
      if (start >= end) {
        continue;
      }

      textParts.push(span.node.textContent.slice(start, end));
      spanParts.push({
        node: span.node,
        start,
        end,
      });
    }

    if (spanParts.length === 0) {
      return null;
    }

    const text = textParts.join('');
    if (text.trim() === '') {
      return null;
    }

    let offset = 0;
    const spans = spanParts.map((span, index) => {
      const partText = textParts[index];
      const runStart = offset;
      offset += partText.length;
      return {
        ...span,
        runStart,
        runEnd: offset,
      };
    });

    const clipped = {
      text,
      lang: entry.lang,
      spans,
    };

    const firstTextSpan = spans.find((span) => span.node);
    if (spans.length === 1 && firstTextSpan) {
      clipped.node = firstTextSpan.node;
      clipped.start = firstTextSpan.start;
      clipped.end = firstTextSpan.end;
    } else if (firstTextSpan) {
      clipped.node = firstTextSpan.node;
      clipped.start = firstTextSpan.start;
      clipped.end = firstTextSpan.end;
    }

    return clipped;
  }

  #clipEntryToRange(entry, selectionRange) {
    const entryRange = this.#entryDomRange(entry);
    if (!entryRange || !this.#rangeIntersectsSelection(entryRange, selectionRange)) {
      return null;
    }

    const textNode = entry.node;
    if (
      textNode
      && this.#nodeParent.has(textNode)
      && !entry.spans?.length
      && !Number.isFinite(entry.start)
    ) {
      const element = this.#nodeParent.get(textNode);
      return typeof selectionRange.intersectsNode === 'function' && selectionRange.intersectsNode(element)
        ? entry
        : null;
    }

    if (
      selectionRange.compareBoundaryPoints(Range.START_TO_START, entryRange) <= 0
      && selectionRange.compareBoundaryPoints(Range.END_TO_END, entryRange) >= 0
    ) {
      return entry;
    }

    if (entry.spans?.length) {
      return this.#clipSpanEntryToRange(entry, selectionRange);
    }

    if (textNode && Number.isFinite(entry.start) && Number.isFinite(entry.end)) {
      return this.#clipTextNodeEntryToRange(entry, selectionRange);
    }

    return null;
  }

  #filterNodeListToRange(nodeList, selectionRange) {
    const filtered = [];

    for (const entry of nodeList) {
      const clipped = this.#clipEntryToRange(entry, selectionRange);
      if (clipped && this.#entryText(clipped)) {
        filtered.push(clipped);
      }
    }

    return filtered;
  }

  #pushSynthetic(element, text, lang) {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    const node = document.createTextNode(trimmed);
    this.#nodeParent.set(node, element);
    this.#nodeList.push({ node, lang });
  }

  #syntheticHighlightType(element) {
    switch (element.tagName.toLowerCase()) {
      case 'img':
      case 'video':
      case 'audio':
        return 'element';
      default:
        return 'sentence';
    }
  }

  #getTimeText(timeElement, lang) {
    const visibleText = timeElement.textContent.trim();
    const datetimeValue = timeElement.getAttribute('datetime')?.trim();
    if (!datetimeValue) {
      return visibleText;
    }

    const date = new Date(datetimeValue);
    if (Number.isNaN(date.getTime())) {
      return visibleText;
    }

    const formatted = new Intl.DateTimeFormat(lang, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);

    return /^\d/.test(visibleText) ? formatted : `${visibleText}. ${formatted}`;
  }

  #accessibleName(element) {
    return element.getAttribute('aria-label')?.trim()
      || element.getAttribute('title')?.trim()
      || element.textContent.trim();
  }

  #collectNodes(parent, inheritedLang) {
    const currentLang = parent.getAttribute('lang')?.trim() || inheritedLang;

    next: for (const child of parent.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.textContent.trim() !== '') {
          this.#collectTextNode(child, currentLang);
        }
        continue;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      const tagName = child.nodeName.toLowerCase();
      const childLang = child.getAttribute('lang')?.trim() || currentLang;

      if (child.getAttribute('aria-hidden') === 'true' || child.hasAttribute('hidden')) {
        continue next;
      }

      if (WcSpeech.#SKIP_TAGS.has(tagName)) {
        continue next;
      }

      if (tagName === 'wc-speech') {
        continue next;
      }

      if (WcSpeech.#FLOW_CONTAINER_TAGS.has(tagName)) {
        this.#collectFlow(child, childLang);
        continue next;
      }

      if (tagName === 'abbr') {
        const expansion = child.getAttribute('title')?.trim();
        if (expansion) {
          this.#pushSynthetic(child, expansion, childLang);
          continue next;
        }
      }

      if (tagName === 'img') {
        const alt = child.getAttribute('alt')?.trim();
        if (alt) {
          this.#pushSynthetic(child, `${alt}`, childLang);
        }
        continue next;
      }

      if (tagName === 'time') {
        this.#pushSynthetic(child, this.#getTimeText(child, childLang), childLang);
        continue next;
      }

      if (tagName === 'video' || tagName === 'audio') {
        const name = this.#accessibleName(child);
        this.#pushSynthetic(child, name ? `${tagName}: ${name}` : tagName, childLang);
        continue next;
      }

      if (tagName === 'pre' || tagName === 'code') {
        const codeLang = child.getAttribute('lang')?.trim()
          || this.getAttribute('code-lang')?.trim()
          || 'en';
        const content = child.textContent.trim();
        if (content) {
          this.#pushSynthetic(child, `${content}`, codeLang);
        }
        continue next;
      }

      this.#collectNodes(child, childLang);
    }
  }

  #collectFlow(container, inheritedLang) {
    const containerLang = container.getAttribute('lang')?.trim() || inheritedLang;
    const chunks = [];
    this.#gatherFlowChunks(container, containerLang, chunks);

    let currentRun = null;

    const flushRun = () => {
      if (currentRun?.chunks.length) {
        this.#pushFlowRun(currentRun);
      }
      currentRun = null;
    };

    for (const chunk of chunks) {
      if (chunk.type === 'breaker') {
        flushRun();
        this.#pushFlowBreaker(chunk);
        continue;
      }

      if (chunk.type === 'nested-block') {
        flushRun();
        const childLang = chunk.element.getAttribute('lang')?.trim() || containerLang;
        const nestedTag = chunk.element.nodeName.toLowerCase();
        if (WcSpeech.#FLOW_CONTAINER_TAGS.has(nestedTag)) {
          this.#collectFlow(chunk.element, childLang);
        } else {
          this.#collectNodes(chunk.element, childLang);
        }
        continue;
      }

      if (!currentRun || chunk.lang !== currentRun.lang) {
        flushRun();
        currentRun = { lang: chunk.lang, chunks: [] };
      }

      currentRun.chunks.push(chunk);
    }

    flushRun();
  }

  #gatherFlowChunks(parent, inheritedLang, chunks) {
    for (const child of parent.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.textContent.length > 0) {
          chunks.push({
            type: 'text',
            node: child,
            text: child.textContent,
            lang: inheritedLang,
          });
        }
        continue;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      const tagName = child.nodeName.toLowerCase();
      const childLang = child.getAttribute('lang')?.trim() || inheritedLang;

      if (child.getAttribute('aria-hidden') === 'true' || child.hasAttribute('hidden')) {
        continue;
      }

      if (WcSpeech.#SKIP_TAGS.has(tagName) || tagName === 'wc-speech') {
        continue;
      }

      if (tagName === 'abbr') {
        const expansion = child.getAttribute('title')?.trim();
        if (expansion) {
          chunks.push({
            type: 'expansion',
            element: child,
            text: expansion,
            lang: childLang,
          });
          continue;
        }
        this.#gatherFlowChunks(child, childLang, chunks);
        continue;
      }

      if (WcSpeech.#FLOW_BREAKER_TAGS.has(tagName)) {
        chunks.push({ type: 'breaker', element: child, lang: childLang });
        continue;
      }

      if (WcSpeech.#NESTED_BLOCK_TAGS.has(tagName)) {
        chunks.push({ type: 'nested-block', element: child, lang: childLang });
        continue;
      }

      this.#gatherFlowChunks(child, childLang, chunks);
    }
  }

  #pushFlowBreaker({ element, lang }) {
    const tagName = element.nodeName.toLowerCase();

    if (tagName === 'img') {
      const alt = element.getAttribute('alt')?.trim();
      if (alt) {
        this.#pushSynthetic(element, alt, lang);
      }
      return;
    }

    if (tagName === 'time') {
      this.#pushSynthetic(element, this.#getTimeText(element, lang), lang);
      return;
    }

    if (tagName === 'video' || tagName === 'audio') {
      const name = this.#accessibleName(element);
      this.#pushSynthetic(element, name ? `${tagName}: ${name}` : tagName, lang);
      return;
    }

    if (tagName === 'pre') {
      const codeLang = element.getAttribute('lang')?.trim()
        || this.getAttribute('code-lang')?.trim()
        || 'en';
      const content = element.textContent.trim();
      if (content) {
        this.#pushSynthetic(element, content, codeLang);
      }
    }
  }

  #pushFlowRun({ lang, chunks }) {
    let offset = 0;
    const spanDescriptors = [];
    const normalizedChunks = chunks.map((chunk, index) => {
      let text = chunk.text;
      let nodeStart = 0;

      if (
        chunk.type === 'text'
        && index > 0
        && /\s$/.test(chunks[index - 1].text)
        && /^\s/.test(text)
      ) {
        const leadingWhitespace = /^\s+/.exec(text);
        nodeStart = leadingWhitespace[0].length;
        text = text.slice(nodeStart);
      }

      return { ...chunk, text, nodeStart };
    });

    for (const chunk of normalizedChunks) {
      const chunkStart = offset;
      offset += chunk.text.length;

      if (chunk.type === 'text') {
        spanDescriptors.push({
          kind: 'text',
          node: chunk.node,
          runStart: chunkStart,
          runEnd: offset,
          nodeStart: chunk.nodeStart,
          nodeEnd: chunk.nodeStart + chunk.text.length,
        });
      } else if (chunk.type === 'expansion') {
        spanDescriptors.push({
          kind: 'expansion',
          element: chunk.element,
          runStart: chunkStart,
          runEnd: offset,
        });
      }
    }

    const fullText = normalizedChunks.map((chunk) => chunk.text).join('');
    if (fullText.trim() === '') {
      return;
    }

    const segments = this.#sentenceSegmentsForText(fullText, lang);

    for (const segment of segments) {
      if (fullText.slice(segment.start, segment.end).trim() === '') {
        continue;
      }

      const spans = this.#spansForSegment(spanDescriptors, segment.start, segment.end);
      const text = fullText.slice(segment.start, segment.end);
      const entry = { text, lang, spans };

      if (spans.length === 1 && spans[0].node) {
        entry.node = spans[0].node;
        entry.start = spans[0].start;
        entry.end = spans[0].end;
      } else if (spans[0]?.node) {
        entry.node = spans[0].node;
        entry.start = spans[0].start;
        entry.end = spans[0].end;
      }

      this.#nodeList.push(entry);
    }
  }

  #spansForSegment(spanDescriptors, segStart, segEnd) {
    const spans = [];

    for (const desc of spanDescriptors) {
      if (desc.runEnd <= segStart || desc.runStart >= segEnd) {
        continue;
      }

      const overlapStart = Math.max(segStart, desc.runStart);
      const overlapEnd = Math.min(segEnd, desc.runEnd);

      if (desc.kind === 'text') {
        spans.push({
          node: desc.node,
          start: overlapStart - desc.runStart + desc.nodeStart,
          end: overlapEnd - desc.runStart + desc.nodeStart,
          runStart: overlapStart - segStart,
          runEnd: overlapEnd - segStart,
        });
      } else {
        spans.push({
          element: desc.element,
          start: overlapStart - desc.runStart,
          end: overlapEnd - desc.runStart,
          runStart: overlapStart - segStart,
          runEnd: overlapEnd - segStart,
        });
      }
    }

    return spans;
  }

  #collectTextNode(textNode, lang) {
    const segments = this.#sentenceSegmentsForText(textNode.textContent, lang);
    this.#sentenceSegments.set(textNode, segments);

    for (const segment of segments) {
      if (textNode.textContent.slice(segment.start, segment.end).trim() === '') {
        continue;
      }

      this.#nodeList.push({
        node: textNode,
        lang,
        start: segment.start,
        end: segment.end,
      });
    }
  }

  #voiceByURI(voiceURI) {
    return voiceURI
      ? this.#voices.find((voice) => voice.voiceURI === voiceURI)
      : null;
  }

  #preferredVoiceName() {
    return this.getAttribute('prefer-voice')?.trim().toLowerCase() ?? '';
  }

  #matchesVoicePreference(voice) {
    const preferredVoiceName = this.#preferredVoiceName();
    if (!preferredVoiceName) {
      return false;
    }

    return (
      voice.name.toLowerCase().includes(preferredVoiceName)
      || voice.voiceURI.toLowerCase().includes(preferredVoiceName)
    );
  }

  #findPreferredVoice(voices) {
    return voices.find((voice) => this.#matchesVoicePreference(voice)) ?? null;
  }

  #findVoiceForLang(lang) {
    const prefix = lang.split('-')[0];
    const exactMatches = this.#voices.filter((voice) => voice.lang === lang);
    const prefixMatches = this.#voices.filter((voice) => (
      voice.lang.startsWith(`${prefix}-`) || voice.lang === prefix
    ));
    const broadMatches = this.#voices.filter((voice) => voice.lang.startsWith(prefix));

    return (
      this.#findPreferredVoice(exactMatches)
      ?? this.#findPreferredVoice(prefixMatches)
      ?? this.#findPreferredVoice(broadMatches)
      ?? exactMatches[0]
      ?? prefixMatches[0]
      ?? broadMatches[0]
      ?? null
    );
  }

  #voiceForEntry({ lang }) {
    if (!lang) {
      return this.#defaultVoice;
    }

    if (this.#defaultVoice && this.#languagesMatch(lang, this.#defaultVoice.lang)) {
      return this.#defaultVoice;
    }

    return this.#findVoiceForLang(lang) ?? null;
  }

  #languagesMatch(a, b) {
    if (!a || !b) {
      return false;
    }

    if (a === b) {
      return true;
    }

    const aPrefix = a.split('-')[0];
    const bPrefix = b.split('-')[0];
    return a.startsWith(b) || b.startsWith(a) || aPrefix === bPrefix;
  }

  #clearHighlight() {
    this.#sentenceHighlight?.clear();
    this.#wordHighlight?.clear();
    this.#setHighlightedElement(null);
    this.#lastSentenceRange = null;
  }

  #rangesEqual(a, b) {
    if (!a || !b) {
      return false;
    }

    return (
      a.startContainer === b.startContainer
      && a.endContainer === b.endContainer
      && a.startOffset === b.startOffset
      && a.endOffset === b.endOffset
    );
  }

  #boundaryRangeForEntry(entry, event) {
    const charIndex = event.charIndex;
    const charLength = event.charLength;
    if (
      !Number.isFinite(charIndex)
      || !Number.isFinite(charLength)
      || charLength <= 0
    ) {
      return null;
    }

    const absStart = charIndex;
    const absEnd = charIndex + charLength;

    for (const span of entry.spans) {
      if (absStart < span.runStart || absStart >= span.runEnd) {
        continue;
      }

      if (span.element) {
        return null;
      }

      const localStart = span.start + (absStart - span.runStart);
      const localEnd = Math.min(span.end, span.start + (absEnd - span.runStart));
      if (localStart < 0 || localEnd > span.node.textContent.length || localStart >= localEnd) {
        return null;
      }

      const range = new Range();
      range.setStart(span.node, localStart);
      range.setEnd(span.node, localEnd);
      return range;
    }

    return null;
  }

  #boundaryRange(textNode, event, offset = 0) {
    const charIndex = event.charIndex;
    const charLength = event.charLength;
    const start = offset + charIndex;
    const end = start + charLength;

    if (
      !Number.isFinite(charIndex)
      || !Number.isFinite(charLength)
      || charLength <= 0
      || start < 0
      || end > textNode.textContent.length
    ) {
      return null;
    }

    const range = new Range();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    return range;
  }

  #entryRange(entry) {
    if (entry.spans?.length) {
      return this.#rangeFromSpans(entry.spans);
    }

    if (!Number.isFinite(entry.start) || !Number.isFinite(entry.end)) {
      return null;
    }

    const range = new Range();
    range.setStart(entry.node, entry.start);
    range.setEnd(entry.node, entry.end);
    return range;
  }

  #rangeFromSpans(spans) {
    if (!spans.length) {
      return null;
    }

    const first = spans[0];
    const last = spans.at(-1);
    const range = new Range();

    if (first.element) {
      range.setStartBefore(first.element);
    } else {
      range.setStart(first.node, first.start);
    }

    if (last.element) {
      range.setEndAfter(last.element);
    } else {
      range.setEnd(last.node, last.end);
    }

    return range;
  }

  #entryText(entry) {
    if (typeof entry.text === 'string') {
      return entry.text.trim();
    }

    if (!Number.isFinite(entry.start) || !Number.isFinite(entry.end)) {
      return entry.node.textContent.trim();
    }

    return entry.node.textContent.slice(entry.start, entry.end).trim();
  }

  #wordRangeFromBoundaryRange(range, entry) {
    if (entry.spans?.length) {
      return range;
    }

    const boundaryText = range.toString();
    const trimmedBoundaryText = boundaryText.trim();
    if (trimmedBoundaryText === '') {
      return null;
    }

    const containsWhitespace = /\s/.test(trimmedBoundaryText);
    if (trimmedBoundaryText === this.#entryText(entry) && containsWhitespace) {
      return null;
    }

    if (!containsWhitespace) {
      return range;
    }

    const firstToken = /\S+/.exec(boundaryText);
    if (!firstToken) {
      return null;
    }

    const wordRange = new Range();
    const start = range.startOffset + firstToken.index;
    wordRange.setStart(entry.node, start);
    wordRange.setEnd(entry.node, start + firstToken[0].length);
    return wordRange;
  }

  #sentenceRangeAt(textNode, charIndex, lang) {
    const text = textNode.textContent;
    if (!Number.isFinite(charIndex) || charIndex < 0 || charIndex > text.length) {
      return null;
    }

    const segmentedRange = this.#segmentedSentenceRangeAt(textNode, charIndex, lang);
    if (segmentedRange) {
      return segmentedRange;
    }

    return this.#fallbackSentenceRangeAt(textNode, charIndex);
  }

  #sentenceSegmentsForText(text, lang) {
    if ('Segmenter' in Intl) {
      const segmenter = this.#segmenterFor(lang);
      const segments = Array.from(segmenter.segment(text), ({ segment, index }) => ({
        start: index,
        end: index + segment.length,
      }));

      return mergeAbbreviationSegments(text, segments);
    }

    return fallbackSentenceSegments(text);
  }

  #segmenterFor(lang) {
    const key = lang || this.#defaultLang || '';
    let segmenter = this.#segmenters.get(key);
    if (!segmenter) {
      segmenter = new Intl.Segmenter(key || undefined, { granularity: 'sentence' });
      this.#segmenters.set(key, segmenter);
    }
    return segmenter;
  }

  #segmentedSentenceRangeAt(textNode, charIndex, lang) {
    if (!('Segmenter' in Intl)) {
      return null;
    }

    const segments = this.#sentenceSegments.get(textNode) ?? this.#segmentSentences(textNode, lang);
    const segment = segments.find(({ start, end }) => (
      charIndex >= start && charIndex < end
    ));
    if (!segment) {
      return null;
    }

    const range = new Range();
    range.setStart(textNode, segment.start);
    range.setEnd(textNode, segment.end);
    return range;
  }

  #segmentSentences(textNode, lang) {
    const text = textNode.textContent;
    const segments = this.#sentenceSegmentsForText(text, lang);
    this.#sentenceSegments.set(textNode, segments);
    return segments;
  }

  #fallbackSentenceRangeAt(textNode, charIndex) {
    const text = textNode.textContent;
    const segment = fallbackSentenceSegments(text)
      .find(({ start, end }) => charIndex >= start && charIndex < end);
    if (!segment) {
      return null;
    }

    const range = new Range();
    range.setStart(textNode, segment.start);
    range.setEnd(textNode, segment.end);
    return range;
  }

  #setSentenceHighlight(range) {
    if (this.#rangesEqual(this.#lastSentenceRange, range)) {
      return;
    }

    this.#sentenceHighlight.clear();
    this.#sentenceHighlight.add(range);
    this.#lastSentenceRange = range;
  }

  #setSentenceHighlightAroundWord(sentenceRange, wordRange) {
    if (
      sentenceRange.startContainer !== sentenceRange.endContainer
      || wordRange.startContainer !== wordRange.endContainer
      || sentenceRange.startContainer !== wordRange.startContainer
    ) {
      this.#setSentenceHighlight(sentenceRange);
      return;
    }

    const textNode = sentenceRange.startContainer;
    this.#sentenceHighlight.clear();

    if (sentenceRange.startOffset < wordRange.startOffset) {
      const before = new Range();
      before.setStart(textNode, sentenceRange.startOffset);
      before.setEnd(textNode, wordRange.startOffset);
      this.#sentenceHighlight.add(before);
    }

    if (wordRange.endOffset < sentenceRange.endOffset) {
      const after = new Range();
      after.setStart(textNode, wordRange.endOffset);
      after.setEnd(textNode, sentenceRange.endOffset);
      this.#sentenceHighlight.add(after);
    }

    this.#lastSentenceRange = sentenceRange;
  }

  #setHighlightedElement(element, type = 'sentence') {
    if (this.#lastHighlightedElement === element) {
      if (element) {
        element.dataset.speechSynthHighlight = type;
      }
      return;
    }

    if (this.#lastHighlightedElement) {
      delete this.#lastHighlightedElement.dataset.speechSynthHighlight;
    }

    this.#lastHighlightedElement = element;
    if (element) {
      element.dataset.speechSynthHighlight = type;
    }
  }

  #highlightEntry(entry) {
    const textNode = entry.node;

    if (textNode && this.#nodeParent.has(textNode)) {
      const element = this.#nodeParent.get(textNode);
      this.#wordHighlight?.clear();
      this.#sentenceHighlight?.clear();
      this.#setHighlightedElement(element, this.#syntheticHighlightType(element));
      this.#scheduleFollowInView(element);
      return;
    }

    const range = this.#entryRange(entry);
    const parent = textNode?.parentElement ?? entry.spans?.find((span) => span.node)?.node.parentElement;
    if (!this.#wordHighlight || !this.#sentenceHighlight || !range) {
      this.#setHighlightedElement(parent);
      this.#scheduleFollowInView(range ?? parent);
      return;
    }

    this.#setHighlightedElement(null);
    this.#wordHighlight.clear();
    this.#setSentenceHighlight(range);
    this.#scheduleFollowInView(range);
  }

  #speakMarked() {
    if (this.classList.contains('speaking') && this.#speechSource === 'marked') {
      this.#closeSelectionToolbar();
      if (this.#paused) {
        this.#resumeSpeech();
      } else {
        this.#pauseSpeech();
      }
      return;
    }

    const markedRange = this.#resolveMarkedRange();
    if (!markedRange) {
      return;
    }

    window.getSelection()?.removeAllRanges();
    this.#closeSelectionToolbar();

    const targetSelector = this.getAttribute('target')?.trim();
    if (!targetSelector) {
      this.#reportError('missing-target');
      return;
    }

    this.#target = document.querySelector(targetSelector);
    if (!this.#target) {
      this.#reportError('target-not-found');
      return;
    }

    const documentLang = this.#documentLang();
    if (!documentLang) {
      this.#reportError('missing-lang');
      return;
    }

    this.#resumeNodeIndex = null;

    if (this.classList.contains('speaking')) {
      this.#speakId += 1;
      this.#clearKeepAlive();
      this.#cancelScheduledScroll();
      speechSynthesis.cancel();
      this.#clearHighlight();
      this.classList.remove('speaking');
      this.#paused = false;
      this.#speechSource = null;
    }

    const targetInheritedLang = this.#inheritedLangFrom(this.#target.parentElement) || documentLang;
    const fullList = this.#collectNodeListFromTarget(this.#target, targetInheritedLang);
    this.#nodeList = this.#filterNodeListToRange(fullList, markedRange);

    if (this.#nodeList.length === 0) {
      this.#reportError('empty-content');
      return;
    }

    this.#clearError();

    const voiceIndex = this.#voiceSelect?.selectedIndex ?? -1;
    this.#defaultVoice = voiceIndex >= 0 ? this.#voices[voiceIndex] : null;
    this.#defaultLang = targetInheritedLang;

    this.#nodeIndex = 0;
    this.#speechSource = 'marked';
    this.classList.add('speaking');
    this.#announce(this.#text('status-speaking'));
    this.#setSpeechState('speaking');
    this.#updateControlState();
    this.#dispatch('speech-start', {
      index: 0,
      total: this.#nodeList.length,
    });
    this.#bindEscapeStop();

    const speakId = ++this.#speakId;
    this.#speakEntry(speakId);
  }

  #pauseSpeech() {
    this.#paused = true;
    this.#speakId += 1;
    this.#clearKeepAlive();
    speechSynthesis.cancel();
    this.#announce(this.#text('status-paused'));
    this.#setSpeechState('paused');
    this.#updateControlState();
  }

  #resumeSpeech() {
    this.#paused = false;
    const speakId = ++this.#speakId;
    this.#announce(this.#text('status-speaking'));
    this.#setSpeechState('speaking');
    this.#updateControlState();
    this.#speakEntry(speakId);
  }

  #playpause() {
    if (!this.classList.contains('speaking')) {
      this.#speak();
      return;
    }

    if (this.#paused) {
      this.#resumeSpeech();
    } else {
      this.#pauseSpeech();
    }
  }

  #previousSentence() {
    this.#jumpToSentence(Math.max(0, this.#nodeIndex - 1));
  }

  #nextSentence() {
    this.#jumpToSentence(Math.min(this.#nodeList.length - 1, this.#nodeIndex + 1));
  }

  #jumpToSentence(index) {
    if (!this.classList.contains('speaking') || this.#nodeList.length === 0 || index === this.#nodeIndex) {
      return;
    }

    this.#speakId += 1;
    const speakId = this.#speakId;
    speechSynthesis.cancel();
    this.#clearHighlight();
    this.#paused = false;
    this.#nodeIndex = index;
    this.#updateControlState();
    this.#speakEntry(speakId);
  }

  #speak() {
    const speakId = ++this.#speakId;
    speechSynthesis.cancel();
    this.#clearHighlight();
    this.#paused = false;

    const targetSelector = this.getAttribute('target')?.trim();
    if (!targetSelector) {
      this.#reportError('missing-target');
      return;
    }

    this.#target = document.querySelector(targetSelector);
    if (!this.#target) {
      this.#reportError('target-not-found');
      return;
    }

    const documentLang = this.#documentLang();
    if (!documentLang) {
      this.#reportError('missing-lang');
      return;
    }

    const targetInheritedLang = this.#inheritedLangFrom(this.#target.parentElement) || documentLang;
    const resumeNodeIndex = this.#resumeNodeIndex;
    this.#resumeNodeIndex = null;
    this.#collectNodeListFromTarget(this.#target, targetInheritedLang);

    if (this.#nodeList.length === 0) {
      this.#reportError('empty-content');
      return;
    }

    this.#clearError();

    if (Number.isInteger(resumeNodeIndex)) {
      this.#nodeIndex = Math.min(resumeNodeIndex, this.#nodeList.length - 1);
    }

    const voiceIndex = this.#voiceSelect?.selectedIndex ?? -1;
    this.#defaultVoice = voiceIndex >= 0 ? this.#voices[voiceIndex] : null;
    this.#defaultLang = targetInheritedLang;
    this.#speechSource = 'full';

    this.classList.add('speaking');
    this.#announce(this.#text('status-speaking'));
    this.#setSpeechState('speaking');
    this.#updateControlState();
    this.#dispatch('speech-start', {
      index: this.#nodeIndex,
      total: this.#nodeList.length,
    });
    this.#bindEscapeStop();
    this.#speakEntry(speakId);
  }

  #speakEntry(speakId) {
    if (speakId !== this.#speakId || this.#nodeIndex >= this.#nodeList.length) {
      if (speakId === this.#speakId) {
        this.#unbindEscapeStop();
        this.#clearKeepAlive();
        this.#clearHighlight();
        this.classList.remove('speaking');
        this.#paused = false;
        this.#speechSource = null;
        this.#announce(this.#text('status-finished'));
        this.#setSpeechState('ready');
        this.#updateControlState();
        this.#dispatch('speech-finish', { index: this.#nodeIndex });
      }
      return;
    }

    const entry = this.#nodeList[this.#nodeIndex];
    const textNode = entry.node;
    const text = typeof entry.text === 'string'
      ? entry.text
      : Number.isFinite(entry.start) && Number.isFinite(entry.end)
        ? textNode.textContent.slice(entry.start, entry.end)
        : textNode.textContent;
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = this.#voiceForEntry(entry);
    utterance.rate = this.#rate();

    if (voice) {
      utterance.voice = voice;
    }

    if (entry.lang) {
      utterance.lang = entry.lang;
    }

    this.#highlightEntry(entry);
    this.#startKeepAlive();
    this.#dispatch('sentence-change', {
      index: this.#nodeIndex,
      total: this.#nodeList.length,
      text: text.trim(),
    });

    utterance.addEventListener('end', () => {
      if (speakId !== this.#speakId) {
        return;
      }

      this.#nodeIndex += 1;
      this.#updateControlState();
      this.#speakEntry(speakId);
    });
    utterance.addEventListener('error', (event) => {
      if (speakId !== this.#speakId) {
        return;
      }
      this.#unbindEscapeStop();
      this.#clearKeepAlive();
      this.#clearHighlight();
      this.classList.remove('speaking');
      this.#paused = false;
      this.#speechSource = null;
      this.#updateControlState();
      this.#reportError('synthesis-failed', { error: event.error ?? 'synthesis-failed' });
    });
    utterance.addEventListener('boundary', (event) => {
      if (speakId !== this.#speakId) {
        return;
      }

      const reduceMotion = this.#prefersReducedMotion();

      if (textNode && this.#nodeParent.has(textNode)) {
        const parent = this.#nodeParent.get(textNode);
        this.#wordHighlight?.clear();
        this.#sentenceHighlight?.clear();
        this.#setHighlightedElement(parent, this.#syntheticHighlightType(parent));
        return;
      }

      const parent = textNode?.parentElement
        ?? entry.spans?.find((span) => span.node)?.node.parentElement;
      const range = entry.spans?.length
        ? this.#boundaryRangeForEntry(entry, event)
        : this.#boundaryRange(textNode, event, entry.start ?? 0);
      const isSentenceBoundary = event.name === 'sentence';
      const entryRange = this.#entryRange(entry);

      if (!this.#wordHighlight || !this.#sentenceHighlight) {
        this.#setHighlightedElement(parent);
        if (isSentenceBoundary) {
          this.#scheduleFollowInView(entryRange ?? parent);
        }
        return;
      }

      this.#setHighlightedElement(null);

      if (isSentenceBoundary) {
        this.#wordHighlight.clear();
        if (entryRange) {
          this.#setSentenceHighlight(entryRange);
        } else if (range) {
          this.#setSentenceHighlight(range);
        }
        this.#scheduleFollowInView(entryRange ?? parent);
        return;
      }

      if (reduceMotion) {
        if (entryRange) {
          this.#setSentenceHighlight(entryRange);
        }
        return;
      }

      if (!range) {
        const expansionSpan = entry.spans?.find((span) => (
          span.element
          && event.charIndex >= span.runStart
          && event.charIndex < span.runEnd
        ));
        this.#wordHighlight.clear();
        if (expansionSpan) {
          this.#setHighlightedElement(expansionSpan.element, 'sentence');
        } else if (entryRange) {
          this.#setSentenceHighlight(entryRange);
        }
        return;
      }

      const wordRange = this.#wordRangeFromBoundaryRange(range, entry);
      if (!wordRange) {
        this.#wordHighlight.clear();
        if (entryRange) {
          this.#setSentenceHighlight(entryRange);
        }
        return;
      }

      const sentenceRange = entryRange
        ?? this.#sentenceRangeAt(textNode, (entry.start ?? 0) + event.charIndex, entry.lang);
      if (sentenceRange) {
        this.#setSentenceHighlightAroundWord(sentenceRange, wordRange);
      }
      this.#wordHighlight.clear();
      this.#wordHighlight.add(wordRange);
      this.#scheduleFollowInView(wordRange);
    });

    if (speechSynthesis.paused) {
      speechSynthesis.resume();
    }
    speechSynthesis.speak(utterance);
  }
}

customElements.define('wc-speech', WcSpeech);

export { WcSpeech };
