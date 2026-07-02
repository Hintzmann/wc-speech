# wc-speech

**Preview** — early release for developer feedback. The API and markup contract may change.

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

Minimal wiring:

```html
<link rel="stylesheet" href="speech.css">

<button type="button" commandfor="speech" command="--playpause">
  <span data-speech-face="play">Listen</span>
  <span data-speech-face="pause" hidden>Pause</span>
</button>

<wc-speech id="speech" target="#article" hidden prefer-voice="Microsoft"></wc-speech>

<article id="article" lang="en">
  <h1>Readable content</h1>
  <p>Content to speak.</p>
</article>

<script type="module" src="wc-speech.js"></script>
```

Use `wc-speech.min.js` instead of `wc-speech.js` in production if you do not need to read the source.

See `demo/simple/index.html` for this layout, or `demo/advanced/index.html` for the full speech bar, voice picker, and documentation.

Point `target` at **readable content only**. Put the button and `<wc-speech>` **outside** the target when you can so controls are not spoken. If `<wc-speech>` is inside the target, its subtree is skipped automatically.

Set `lang` on `<html>` and on any section that uses another language.

## Expected markup

Voice, speed, and scroll controls use `data-speech-*` hooks on elements **inside** `<wc-speech>`. Play/pause and navigation buttons may live anywhere, wired with `commandfor` and `command`. Buttons are resolved at interaction time, so they can be added to the page after the component connects (for example after a client-side route change).

| Hook | Purpose |
| --- | --- |
| `[data-speech-voice]` | `<select>` populated with available voices |
| `[data-speech-rate]` | Form control with a numeric `.value` (range, select, or number input) for speech speed |
| `[data-speech-scroll]` | Optional checkbox; toggles the `scroll` attribute |
| `[popover]` | Voice and speed options panel |
| `[role="status"]` | Optional live region for Speaking / Paused / Finished |
| `button[commandfor][command]` | Wired to `--show-controls`, `--hide-controls`, `--playpause`, etc. |
| `[data-speech-face="play"]` / `[data-speech-face="pause"]` | Optional faces inside the play/pause button; the component toggles visibility |

See `demo/advanced/index.html` for a complete toolbar example.

## Events

The component dispatches these `CustomEvent`s (they bubble and are composed):

| Event | When | `detail` |
| --- | --- | --- |
| `speech-start` | Reading begins | `{ index, total }` |
| `speech-stop` | Reading stopped manually (`--hide-controls`, `#stopSpeech`) | `{ index }` |
| `speech-finish` | Last sentence completes | `{ index }` |
| `speech-error` | Synthesis fails | `{ index, error }` |
| `sentence-change` | Each sentence starts | `{ index, total, text }` |

```javascript
document.querySelector('wc-speech').addEventListener('sentence-change', (event) => {
  console.log(event.detail.index, event.detail.text);
});
```

## Known limits (preview)

- **One instance per page (enforced)** — only the first connected `<wc-speech>` is active. Additional instances are disabled (`data-speech-blocked="duplicate"`) and log a console warning. When the active instance is removed, the next blocked instance is promoted automatically.
- **Unsupported browsers** — controls are disabled when `speechSynthesis` is unavailable; there is no user-visible message yet.
- **Pause** — pausing cancels the current utterance; resuming re-speaks the current sentence from the start (workaround for unreliable `speechSynthesis.pause()` in some browsers).
- **Long utterances** — a keep-alive heartbeat prevents Chrome from silently cutting off speech after ~15 seconds on a single utterance.
- **Word highlighting** — depends on browser, voice, and the [Custom Highlight API](https://caniuse.com/mdn-api_css_highlights_static). Falls back to sentence highlighting or, for media (`img`, `video`, `audio`), an element outline. Per-word highlights are suppressed when the user prefers reduced motion; sentence-level highlighting still runs.
- **No automated tests yet** — manual testing only.

## Browser support

Requires [speechSynthesis](https://caniuse.com/speech-synthesis) and [SpeechSynthesisUtterance](https://caniuse.com/mdn-api_speechsynthesisutterance). Works best with system voices installed (see voice download links in the demo).

Optional enhancements:

- [Custom Highlight API](https://caniuse.com/mdn-api_css_highlights_static) — word and sentence highlights
- [commandfor](https://caniuse.com/mdn-html_elements_button_commandfor) — declarative buttons (click fallback included)

## Attributes (summary)

| Attribute | Description |
| --- | --- |
| `target` | CSS selector for content to read |
| `prefer-voice` | Prefer voice names/URIs containing this text when auto-selecting in `[data-speech-voice]` |
| `scroll` | Follow along while reading (honours `prefers-reduced-motion`) |
| `code-lang` | Language for `pre` / `code` blocks (default `en`) |
| `label-play`, `label-pause` | Accessible name for play/pause (default English); visible label comes from your `data-speech-face` markup |
| `status-speaking`, `status-paused`, `status-finished` | Status region text |
| `hidden` | Hide toolbar until `--show-controls` |

Full reference: see the **Documentation** section in `demo/advanced/index.html`.

## Skipped content

Not spoken: `wc-speech` subtrees, form controls (`select`, `input`, `textarea`, `button`), `script` / `style` / `noscript`, subtrees with `aria-hidden="true"` or the `hidden` attribute, and images with an empty `alt`. Images with `alt` text are spoken as the alt text. Abbreviations with a `title` attribute are spoken as the expanded form. `<time datetime="…">` speaks visible text and, when useful, a localized date from `datetime`. `pre` and `code` blocks are spoken as their text content in `code-lang` (default English).

## Feedback

This is a soft launch. [Open an issue](https://github.com/Hintzmann/wc-speech/issues) for bugs, integration feedback, or API naming — especially around markup and browser behaviour.

## License

MIT — see [LICENSE](LICENSE).

This project is a **gift**: free to use, modify, and share. If you improve it, consider sharing back. Please do not sell this as-is as a paid product; point people to the free version instead.
