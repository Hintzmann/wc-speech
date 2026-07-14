import { JSDOM } from 'jsdom';

let dom;
let componentLoaded = false;
let activeSpeechMocks;

function applyToGlobal(target, values) {
  for (const [key, value] of Object.entries(values)) {
    target[key] = value;
  }
}

export function removeSpeechMocks() {
  for (const key of ['speechSynthesis', 'SpeechSynthesisUtterance']) {
    delete globalThis[key];
    if (globalThis.window) {
      delete globalThis.window[key];
    }
  }
}

export function installSpeechMocks() {
  const utterances = [];

  const speechSynthesis = {
    speaking: false,
    pending: false,
    paused: false,
    getVoices: () => [{
      name: 'Test Voice',
      lang: 'en-US',
      voiceURI: 'test-voice-en-us',
      default: true,
    }],
    speak(utterance) {
      utterances.push(utterance);
      this.speaking = true;
    },
    cancel() {
      this.speaking = false;
      this.pending = false;
    },
    pause() {},
    resume() {},
    addEventListener() {},
    removeEventListener() {},
  };

  class SpeechSynthesisUtterance {
    constructor(text) {
      this.text = text;
      this.voice = null;
      this.rate = 1;
      this.lang = '';
      this.#listeners = new Map();
    }

    #listeners;

    addEventListener(type, listener) {
      this.#listeners.set(type, listener);
    }

    dispatch(type, event = {}) {
      this.#listeners.get(type)?.(event);
    }
  }

  class Highlight {
    clear() {}

    add() {}
  }

  const cssEscape = globalThis.window?.CSS?.escape
    ?? ((identifier) => String(identifier).replace(/[^a-zA-Z0-9_-]/g, '\\$&'));

  const css = {
    ...(globalThis.window?.CSS ?? {}),
    escape: cssEscape,
    highlights: {
      set() {},
      delete() {},
    },
  };

  const mocks = {
    speechSynthesis,
    SpeechSynthesisUtterance,
    Highlight,
    CSS: css,
  };

  applyToGlobal(globalThis, mocks);
  if (globalThis.window) {
    applyToGlobal(globalThis.window, mocks);
  }

  activeSpeechMocks = {
    utterances,
    fireEnd(utterance) {
      utterance.dispatch('end');
    },
    fireError(utterance, error = 'interrupted') {
      utterance.dispatch('error', { error });
    },
  };

  return activeSpeechMocks;
}

export function speechMocks() {
  return activeSpeechMocks;
}

function installPopoverMocks() {
  const { HTMLElement, Element } = globalThis;

  if (!('popover' in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, 'popover', {
      configurable: true,
      enumerable: true,
      get() {
        return this.getAttribute('popover');
      },
      set(value) {
        if (value === null) {
          this.removeAttribute('popover');
        } else {
          this.setAttribute('popover', String(value));
        }
      },
    });
  }

  if (!HTMLElement.prototype.showPopover) {
    HTMLElement.prototype.showPopover = function showPopover() {
      this._popoverOpen = true;
      this.hidden = false;
      const event = new Event('toggle', { bubbles: true });
      event.newState = 'open';
      event.oldState = 'closed';
      this.dispatchEvent(event);
    };
  }

  if (!HTMLElement.prototype.hidePopover) {
    HTMLElement.prototype.hidePopover = function hidePopover() {
      this._popoverOpen = false;
      this.hidden = true;
      const event = new Event('toggle', { bubbles: true });
      event.newState = 'closed';
      event.oldState = 'open';
      this.dispatchEvent(event);
    };
  }

  const originalMatches = Element.prototype.matches;
  Element.prototype.matches = function matches(selectors) {
    if (selectors === ':popover-open') {
      return Boolean(this._popoverOpen);
    }

    return originalMatches.call(this, selectors);
  };

  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return {
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        right: 0,
        bottom: 0,
      };
    };
  }
}

function assignGlobals(window) {
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.customElements = window.customElements;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLButtonElement = window.HTMLButtonElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.Range = window.Range;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.Event = window.Event;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 0;
  };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.matchMedia = window.matchMedia?.bind(window)
    ?? (() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
}

export function setupDom(bodyHtml) {
  if (!dom) {
    dom = new JSDOM('<!DOCTYPE html><html lang="en"><body></body></html>', {
      url: 'https://example.test/',
    });
    assignGlobals(dom.window);
    installPopoverMocks();
  }

  document.body.innerHTML = bodyHtml;
  return dom;
}

export async function loadComponent() {
  if (componentLoaded) {
    return;
  }

  await import(new URL('../../wc-speech.js', import.meta.url).href);
  componentLoaded = true;
}

export function resetComponentLoader() {
  componentLoaded = false;
}

export function resetSpeechInstance() {
  customElements.get('wc-speech')?._resetInstanceForTests?.();
}
