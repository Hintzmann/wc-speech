class WcSpeech extends HTMLElement {
  static observedAttributes = ['prefer-voice', 'target', 'scroll', 'label-play', 'label-pause'];

  static #strings = {
    'label-play': 'Play',
    'label-pause': 'Pause',
    'status-speaking': 'Speaking',
    'status-paused': 'Paused',
    'status-finished': 'Finished',
  };

  static #instance = null;

  #voiceSelect;
  #rateControl;
  #optionsPopover;
  #statusRegion;
  #scrollCheckbox;
  #commandButtons = new Map();
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
  #lastSentenceNode = null;
  #lastSentenceStart = -1;
  #lastSentenceEnd = -1;
  #supportsSpeech = false;
  #registered = false;
  #paused = false;
  #speakId = 0;
  #keepAliveTimer = null;
  #scrollRaf = 0;
  #scrollTarget = null;
  #optionsOpenBeforePointerDown = false;
  #onVoicesChanged = () => this.#populateVoiceList();
  #onCommandButtonClick = (event) => this.#handleCommandButtonClick(event);
  #onPointerDown = (event) => this.#handlePointerDown(event);
  #onOptionsToggle = () => this.#updateOptionsButton();
  #onScrollToggle = () => this.toggleAttribute('scroll', Boolean(this.#scrollCheckbox?.checked));

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
    this.#scrollCheckbox?.removeEventListener('change', this.#onScrollToggle);
    document.removeEventListener('pointerdown', this.#onPointerDown, { capture: true });
    document.removeEventListener('click', this.#onCommandButtonClick);

    this.#speakId += 1;
    this.#clearKeepAlive();
    this.#cancelScheduledScroll();

    if (this.#supportsSpeech) {
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
    this.#cacheCommandButtons();
    this.#applyButtonTitles();
    this.#resolveControls();
    this.#optionsPopover = this.#resolveOptionsPopover();
    this.#statusRegion = this.#resolveStatusRegion();

    if (this.#scrollCheckbox) {
      this.#scrollCheckbox.checked = this.hasAttribute('scroll');
    }

    this.#setControlsDisabled(true);
  }

  #activate() {
    this.removeAttribute('data-speech-blocked');
    this.#cacheCommandButtons();
    this.#applyButtonTitles();
    this.#resolveControls();
    this.#optionsPopover = this.#resolveOptionsPopover();
    this.#statusRegion = this.#resolveStatusRegion();
    this.#supportsSpeech = this.#supportsSpeechSynthesis();

    if (this.#scrollCheckbox) {
      this.#scrollCheckbox.checked = this.hasAttribute('scroll');
    }

    if (!this.#supportsSpeech) {
      this.#setControlsDisabled(true);
      return;
    }

    this.#optionsPopover?.addEventListener('toggle', this.#onOptionsToggle);
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

  #warnMissingDocumentLang() {
    console.warn('wc-speech: Missing lang attribute on the html element. Speech synthesis was not started.');
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
    for (const button of this.#commandButtons.values()) {
      button.toggleAttribute('disabled', disabled);
    }
  }

  #cacheCommandButtons() {
    this.#commandButtons.clear();
    for (const button of document.querySelectorAll('button[commandfor][command]')) {
      if (button.getAttribute('commandfor') !== this.id) {
        continue;
      }
      const command = button.getAttribute('command');
      if (!this.#commandButtons.has(command)) {
        this.#commandButtons.set(command, button);
      }
    }
  }

  #buttonForCommand(command) {
    return this.#commandButtons.get(command) ?? null;
  }

  #updateControlState() {
    const isActive = this.#supportsSpeech && this.classList.contains('speaking');
    const isPaused = this.#supportsSpeech && this.#paused;
    const playPause = this.#buttonForCommand('--playpause');
    const previous = this.#buttonForCommand('--previous-sentence');
    const next = this.#buttonForCommand('--next-sentence');

    this.#voiceSelect?.toggleAttribute('disabled', !this.#supportsSpeech);
    this.#rateControl?.toggleAttribute('disabled', !this.#supportsSpeech);
    this.#scrollCheckbox?.toggleAttribute('disabled', !this.#supportsSpeech);
    playPause?.toggleAttribute('disabled', !this.#supportsSpeech);
    previous?.toggleAttribute('disabled', !isActive || this.#nodeIndex <= 0);
    next?.toggleAttribute('disabled', !isActive || this.#nodeIndex >= this.#nodeList.length - 1);

    if (playPause) {
      const action = !isActive || isPaused ? 'play' : 'pause';
      this.#syncPlayPauseButton(playPause, action);
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

  #announce(message) {
    const region = this.#statusRegion;
    if (!region) {
      return;
    }

    // Force re-announcement when the same status string is set twice in a row.
    region.textContent = '';
    requestAnimationFrame(() => {
      region.textContent = message;
    });
  }

  #text(name) {
    return this.getAttribute(name) ?? WcSpeech.#strings[name];
  }

  #applyButtonTitles() {
    for (const button of this.#commandButtons.values()) {
      const label = button.getAttribute('aria-label');
      if (label && !button.hasAttribute('title')) {
        button.setAttribute('title', label);
      }
    }
  }

  #resolveOptionsPopover() {
    return this.querySelector('[popover]');
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
    const topInset = (this.hidden ? 0 : this.getBoundingClientRect().bottom) + margin;
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
    this.hidden = false;
    (source ?? this.#buttonForCommand('--show-controls'))?.toggleAttribute('hidden', true);
    this.#updateControlState();
    this.#buttonForCommand('--playpause')?.focus();
  }

  #hideControls() {
    this.#stopSpeech();
    this.#closeOptions();
    this.hidden = true;

    const showButton = this.#buttonForCommand('--show-controls');
    showButton?.removeAttribute('hidden');
    showButton?.focus();
  }

  #stopSpeech() {
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
    this.#announce('');
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
    const skipTags = new Set(['select', 'input', 'textarea', 'button', 'script', 'style', 'noscript']);

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

      if (skipTags.has(tagName)) {
        continue next;
      }

      if (tagName === 'wc-speech') {
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
    this.#lastSentenceNode = null;
    this.#lastSentenceStart = -1;
    this.#lastSentenceEnd = -1;
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
    if (!Number.isFinite(entry.start) || !Number.isFinite(entry.end)) {
      return null;
    }

    const range = new Range();
    range.setStart(entry.node, entry.start);
    range.setEnd(entry.node, entry.end);
    return range;
  }

  #entryText(entry) {
    if (!Number.isFinite(entry.start) || !Number.isFinite(entry.end)) {
      return entry.node.textContent.trim();
    }

    return entry.node.textContent.slice(entry.start, entry.end).trim();
  }

  #wordRangeFromBoundaryRange(range, entry) {
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

      return this.#mergeAbbreviationSegments(text, segments);
    }

    return this.#fallbackSentenceSegments(text);
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

  #mergeAbbreviationSegments(text, segments) {
    const merged = [];

    for (const segment of segments) {
      const previous = merged.at(-1);
      if (previous && this.#endsWithAbbreviation(text.slice(previous.start, previous.end))) {
        previous.end = segment.end;
      } else {
        merged.push({ ...segment });
      }
    }

    return merged;
  }

  #endsWithAbbreviation(text) {
    const trimmed = text.trimEnd();
    const initialism = /(?:^|[\s(["'“])(?:\p{L}\.){2,}$/u;
    const commonAbbreviation = /(?:f\.eks|m\.fl|bl\.a|ca|etc|nr|pkt|fig|dr|prof|mr|mrs|ms|st)\.$/iu;
    return initialism.test(trimmed) || commonAbbreviation.test(trimmed);
  }

  #isSentenceBreak(text, index) {
    if (text[index] !== '.') {
      return true;
    }

    let start = index;
    let end = index + 1;
    while (start > 0 && /[\p{L}.]/u.test(text[start - 1])) {
      start -= 1;
    }
    while (end < text.length && /[\p{L}.]/u.test(text[end])) {
      end += 1;
    }

    return !this.#endsWithAbbreviation(text.slice(start, end));
  }

  #fallbackSentenceRangeAt(textNode, charIndex) {
    const text = textNode.textContent;
    const segment = this.#fallbackSentenceSegments(text)
      .find(({ start, end }) => charIndex >= start && charIndex < end);
    if (!segment) {
      return null;
    }

    const range = new Range();
    range.setStart(textNode, segment.start);
    range.setEnd(textNode, segment.end);
    return range;
  }

  #fallbackSentenceSegments(text) {
    const sentenceEnd = /[.!?]/;
    const sentenceClose = /["')\]}»”’]/;
    const segments = [];
    let start = 0;

    for (let i = 0; i < text.length; i += 1) {
      if (sentenceEnd.test(text[i]) && this.#isSentenceBreak(text, i)) {
        let end = i + 1;
        while (end < text.length && sentenceClose.test(text[end])) {
          end += 1;
        }

        segments.push({ start, end });
        start = end;
        while (start < text.length && /\s/.test(text[start])) {
          start += 1;
        }
      }
    }

    if (start < text.length) {
      segments.push({ start, end: text.length });
    }

    return segments.map((segment) => {
      let end = segment.end;
      while (end > segment.start && /\s/.test(text[end - 1])) {
        end -= 1;
      }
      return { start: segment.start, end };
    }).filter(({ start: segmentStart, end }) => segmentStart < end);
  }

  #setSentenceHighlight(textNode, range) {
    if (
      this.#lastSentenceNode === textNode
      && this.#lastSentenceStart === range.startOffset
      && this.#lastSentenceEnd === range.endOffset
    ) {
      return;
    }

    this.#sentenceHighlight.clear();
    this.#sentenceHighlight.add(range);
    this.#lastSentenceNode = textNode;
    this.#lastSentenceStart = range.startOffset;
    this.#lastSentenceEnd = range.endOffset;
  }

  #setSentenceHighlightAroundWord(textNode, sentenceRange, wordRange) {
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

    this.#lastSentenceNode = textNode;
    this.#lastSentenceStart = sentenceRange.startOffset;
    this.#lastSentenceEnd = sentenceRange.endOffset;
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

    if (this.#nodeParent.has(textNode)) {
      const element = this.#nodeParent.get(textNode);
      this.#wordHighlight?.clear();
      this.#sentenceHighlight?.clear();
      this.#setHighlightedElement(element, this.#syntheticHighlightType(element));
      this.#scheduleFollowInView(element);
      return;
    }

    const parent = textNode.parentElement;
    const range = this.#entryRange(entry);
    if (!this.#wordHighlight || !this.#sentenceHighlight || !range) {
      this.#setHighlightedElement(parent);
      this.#scheduleFollowInView(range ?? parent);
      return;
    }

    this.#setHighlightedElement(null);
    this.#wordHighlight.clear();
    this.#setSentenceHighlight(textNode, range);
    this.#scheduleFollowInView(range);
  }

  #playpause() {
    if (!this.classList.contains('speaking')) {
      this.#speak();
      return;
    }

    if (this.#paused) {
      this.#paused = false;
      const speakId = ++this.#speakId;
      this.#announce(this.#text('status-speaking'));
      this.#updateControlState();
      this.#speakEntry(speakId);
    } else {
      this.#paused = true;
      this.#speakId += 1;
      this.#clearKeepAlive();
      speechSynthesis.cancel();
      this.#announce(this.#text('status-paused'));
      this.#updateControlState();
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

    const targetSelector = this.getAttribute('target');
    this.#target = targetSelector ? document.querySelector(targetSelector) : null;
    if (!this.#target) {
      return;
    }

    const documentLang = this.#documentLang();
    if (!documentLang) {
      this.#warnMissingDocumentLang();
      return;
    }

    const targetInheritedLang = this.#inheritedLangFrom(this.#target.parentElement) || documentLang;
    const resumeNodeIndex = this.#resumeNodeIndex;
    this.#resumeNodeIndex = null;
    this.#nodeList = [];
    this.#nodeIndex = 0;
    this.#nodeParent = new WeakMap();
    this.#sentenceSegments = new WeakMap();
    this.#collectNodes(this.#target, targetInheritedLang);

    if (this.#nodeList.length === 0) {
      return;
    }

    if (Number.isInteger(resumeNodeIndex)) {
      this.#nodeIndex = Math.min(resumeNodeIndex, this.#nodeList.length - 1);
    }

    const voiceIndex = this.#voiceSelect?.selectedIndex ?? -1;
    this.#defaultVoice = voiceIndex >= 0 ? this.#voices[voiceIndex] : null;
    this.#defaultLang = targetInheritedLang;

    this.classList.add('speaking');
    this.#announce(this.#text('status-speaking'));
    this.#updateControlState();
    this.#dispatch('speech-start', {
      index: this.#nodeIndex,
      total: this.#nodeList.length,
    });
    this.#speakEntry(speakId);
  }

  #speakEntry(speakId) {
    if (speakId !== this.#speakId || this.#nodeIndex >= this.#nodeList.length) {
      if (speakId === this.#speakId) {
        this.#clearKeepAlive();
        this.#clearHighlight();
        this.classList.remove('speaking');
        this.#paused = false;
        this.#announce(this.#text('status-finished'));
        this.#updateControlState();
        this.#dispatch('speech-finish', { index: this.#nodeIndex });
      }
      return;
    }

    const entry = this.#nodeList[this.#nodeIndex];
    const textNode = entry.node;
    const text = Number.isFinite(entry.start) && Number.isFinite(entry.end)
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
      this.#clearKeepAlive();
      this.#clearHighlight();
      this.classList.remove('speaking');
      this.#paused = false;
      this.#announce('');
      this.#updateControlState();
      this.#dispatch('speech-error', {
        index: this.#nodeIndex,
        error: event.error ?? 'synthesis-failed',
      });
    });
    utterance.addEventListener('boundary', (event) => {
      if (speakId !== this.#speakId) {
        return;
      }

      const reduceMotion = this.#prefersReducedMotion();
      const offset = entry.start ?? 0;

      if (this.#nodeParent.has(textNode)) {
        const parent = this.#nodeParent.get(textNode);
        this.#wordHighlight?.clear();
        this.#sentenceHighlight?.clear();
        this.#setHighlightedElement(parent, this.#syntheticHighlightType(parent));
        return;
      }

      const parent = textNode.parentElement;
      const range = this.#boundaryRange(textNode, event, offset);
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
          this.#setSentenceHighlight(textNode, entryRange);
        } else if (range) {
          this.#setSentenceHighlight(textNode, range);
        }
        this.#scheduleFollowInView(entryRange ?? parent);
        return;
      }

      if (reduceMotion) {
        if (entryRange) {
          this.#setSentenceHighlight(textNode, entryRange);
        }
        return;
      }

      if (!range) {
        this.#wordHighlight.clear();
        if (entryRange) {
          this.#setSentenceHighlight(textNode, entryRange);
        }
        return;
      }

      const wordRange = this.#wordRangeFromBoundaryRange(range, entry);
      if (!wordRange) {
        this.#wordHighlight.clear();
        if (entryRange) {
          this.#setSentenceHighlight(textNode, entryRange);
        }
        return;
      }

      const sentenceRange = entryRange
        ?? this.#sentenceRangeAt(textNode, offset + event.charIndex, entry.lang);
      if (sentenceRange) {
        this.#setSentenceHighlightAroundWord(textNode, sentenceRange, wordRange);
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
