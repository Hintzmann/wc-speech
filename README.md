# wc-speech

**v1.0 release candidate** — the markup contract is stabilizing; [open an issue](https://github.com/Hintzmann/wc-speech/issues) if you integrate before final 1.0.0.

A small web component that adds an in-page **speech tool** for sighted users without text-to-speech software installed. Built on the [Web Speech API](https://caniuse.com/speech-synthesis). Not a replacement for assistive technology.

## Demo

**Live demos:** [hintzmann.github.io/wc-speech/demo/](https://hintzmann.github.io/wc-speech/demo/) — [simple](https://hintzmann.github.io/wc-speech/demo/simple/) · [advanced](https://hintzmann.github.io/wc-speech/demo/advanced/).

**Local preview** — from the repository root:

```bash
npm install
npm start
```

Open [http://localhost:3000/demo/](http://localhost:3000/demo/) and choose **simple** or **advanced**.

## Quick start

Copy these files into your project:

- `wc-speech.js` — the component (required; use for development)
- `wc-speech.min.js` — minified build (optional; use in production)
- `speech.css` — sentence and word highlights (required)
- `speech-advanced.css` — optional fixed speech bar, popover, and toolbar helpers (advanced integration only)

Regenerate the minified file after editing the source:

```bash
npm run build
```

Run the automated test suite (Node.js built-in test runner + jsdom):

```bash
npm test
```

Minimal wiring:

```html
<link rel="stylesheet" href="speech.css">

<wc-speech id="speech" target="#article" hidden aria-hidden="true" prefer-voice="Microsoft">
  <button type="button" commandfor="speech" command="--playpause">
    <span data-speech-face="play">Listen</span>
    <span data-speech-face="pause" hidden>Pause</span>
  </button>
</wc-speech>

<article id="article" lang="en">
  <h1>Readable content</h1>
  <p>Content to speak.</p>
</article>

<script type="module" src="wc-speech.js"></script>
```

Use `wc-speech.min.js` instead of `wc-speech.js` in production if you do not need to read the source.

See `demo/simple/index.html` for this layout, or `demo/advanced/index.html` for the full speech bar, voice picker, and documentation.

Point `target` at **readable content only**. Put `<wc-speech>` **outside** the target when you can. If `<wc-speech>` is inside the target, its subtree is skipped automatically.

The component sets `aria-hidden="true"` on connect so screen readers stay out of the speech tool. Use `hidden` on `<wc-speech>` only as a pre-init cloak; it is removed when the component connects. In the advanced layout, put `hidden` on the speech bar (`.speech-bar` or `[data-speech-bar]`) to collapse the toolbar until `--show-controls`.

Set `lang` on `<html>` and on any section that uses another language.

## Expected markup

Voice, speed, and scroll controls use `data-speech-*` hooks on elements **inside** `<wc-speech>`. Play/pause and navigation buttons may live anywhere, wired with `commandfor` and `command`. Buttons are resolved at interaction time, so they can be added to the page after the component connects (for example after a client-side route change).

| Hook | Purpose |
| --- | --- |
| `[data-speech-voice]` | `<select>` populated with available voices |
| `[data-speech-rate]` | Form control with a numeric `.value` (range, select, or number input) for speech speed |
| `[data-speech-scroll]` | Optional checkbox; toggles the `scroll` attribute |
| `[popover]` | Voice and speed options panel |
| `[popover][role="toolbar"]` | Optional selection toolbar; shown when the user marks text in `target` |
| `[data-speech-bar]` / `.speech-bar` | Optional toolbar container; `hidden` toggled by `--show-controls` / `--hide-controls` |
| `[role="status"]` | Optional live region (ineffective when `aria-hidden="true"` is on `<wc-speech>`) |
| `[data-speech-error]` | Optional persistent error message area (shown when speech cannot start or synthesis fails) |
| `data-speech-state` | Host attribute set by the component: `ready`, `speaking`, `paused`, `unsupported`, or `error` |
| `button[commandfor][command]` | Wired to `--show-controls`, `--hide-controls`, `--playpause`, `--speech-marked`, etc. |
| `[data-speech-face="play"]` / `[data-speech-face="pause"]` | Optional faces inside the play/pause button; the component toggles visibility |

See `demo/advanced/index.html` for a complete toolbar example.

## Events

The component dispatches these `CustomEvent`s (they bubble and are composed):

| Event | When | `detail` |
| --- | --- | --- |
| `speech-start` | Reading begins | `{ index, total }` |
| `speech-stop` | Reading stopped manually (`Escape`, `--hide-controls`, `#stopSpeech`) | `{ index }` |
| `speech-finish` | Last sentence completes | `{ index }` |
| `speech-error` | Synthesis fails or speech cannot start | `{ index, code, message, error? }` |
| `sentence-change` | Each sentence starts | `{ index, total, text }` |

```javascript
document.querySelector('wc-speech').addEventListener('sentence-change', (event) => {
  console.log(event.detail.index, event.detail.text);
});
```

## Known limits

- **One instance per page (enforced)** — only the first connected `<wc-speech>` is active. Additional instances are disabled (`data-speech-blocked="duplicate"`) and log a console warning. When the active instance is removed, the next blocked instance is promoted automatically.
- **Pause** — pausing cancels the current utterance; resuming re-speaks the current sentence from the start (workaround for unreliable `speechSynthesis.pause()` in some browsers).
- **Long utterances** — a keep-alive heartbeat prevents Chrome from silently cutting off speech after ~15 seconds on a single utterance.
- **Word highlighting** — depends on browser, voice, and the [Custom Highlight API](https://caniuse.com/mdn-api_css_highlights_static). Falls back to sentence highlighting or, for media (`img`, `video`, `audio`), an element outline. Per-word highlights are suppressed when the user prefers reduced motion; sentence-level highlighting still runs.

## Browser support

Requires [speechSynthesis](https://caniuse.com/speech-synthesis) and [SpeechSynthesisUtterance](https://caniuse.com/mdn-api_speechsynthesisutterance). Works best with system voices installed (see voice download links in the demo).

Optional enhancements:

- [Custom Highlight API](https://caniuse.com/mdn-api_css_highlights_static) — word and sentence highlights
- [commandfor](https://caniuse.com/mdn-html_elements_button_commandfor) — declarative buttons (click fallback included)
- [Popover API](https://caniuse.com/mdn-html_global_attributes_popover) — selection toolbar and voice options panel

## Selection read-aloud

Add a `[popover][role="toolbar"]` element inside `<wc-speech>` with a button wired to `command="--speech-marked"`. When the user marks text inside `target`, a popover appears above the selection. Only the marked text is read; the rest of the page is not spoken. `popover="auto"` provides light dismiss on click outside or <kbd>Escape</kbd>. Marked text uses flat `selection.toString()` (inline semantics such as abbr expansion are not applied).

## Attributes (summary)

| Attribute | Description |
| --- | --- |
| `target` | CSS selector for content to read |
| `prefer-voice` | Prefer voice names/URIs containing this text when auto-selecting in `[data-speech-voice]` |
| `scroll` | Follow along while reading (honours `prefers-reduced-motion`) |
| `code-lang` | Language for `pre` / `code` blocks (default `en`) |
| `label-play`, `label-pause` | Accessible name for play/pause when faces are icon-only (default English) |
| `status-speaking`, `status-paused`, `status-finished` | Status region text when `[role="status"]` is used |
| `error-unsupported`, `error-missing-lang`, `error-missing-target`, `error-target-not-found`, `error-empty-content`, `error-synthesis-failed` | User-visible error messages (override for i18n) |
| `hidden` | Pre-init cloak on `<wc-speech>` (removed on connect); on the speech bar, hides the toolbar until `--show-controls` |
| `aria-hidden` | Set to `true` on connect; keeps assistive technology out of the speech tool |

Full reference: see the **Documentation** section in `demo/advanced/index.html`.

## Skipped content

Not spoken: `wc-speech` subtrees, form controls (`select`, `input`, `textarea`, `button`), `script` / `style` / `noscript`, subtrees with `aria-hidden="true"` or the `hidden` attribute, and images with an empty `alt`. Images with `alt` text are spoken as the alt text. Abbreviations with a `title` attribute are spoken as the expanded form. `<time datetime="…">` speaks visible text and, when useful, a localized date from `datetime`. `pre` and `code` blocks are spoken as their text content in `code-lang` (default English).

## Feedback

[Open an issue](https://github.com/Hintzmann/wc-speech/issues) for bugs, integration feedback, or API naming — especially around markup and browser behaviour.

## License

MIT — see [LICENSE](LICENSE).

This project is a **gift**: free to use, modify, and share. If you improve it, consider sharing back. Please do not sell this as-is as a paid product; point people to the free version instead.
