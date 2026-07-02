export function endsWithAbbreviation(text) {
  const trimmed = text.trimEnd();
  const initialism = /(?:^|[\s(["'“])(?:\p{L}\.){2,}$/u;
  const commonAbbreviation = /(?:f\.eks|m\.fl|bl\.a|ca|etc|nr|pkt|fig|dr|prof|mr|mrs|ms|st)\.$/iu;
  return initialism.test(trimmed) || commonAbbreviation.test(trimmed);
}

export function isSentenceBreak(text, index) {
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

  return !endsWithAbbreviation(text.slice(start, end));
}

export function mergeAbbreviationSegments(text, segments) {
  const merged = [];

  for (const segment of segments) {
    const previous = merged.at(-1);
    if (previous && endsWithAbbreviation(text.slice(previous.start, previous.end))) {
      previous.end = segment.end;
    } else {
      merged.push({ ...segment });
    }
  }

  return merged;
}

export function fallbackSentenceSegments(text) {
  const sentenceEnd = /[.!?]/;
  const sentenceClose = /["')\]}»”’]/;
  const segments = [];
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    if (sentenceEnd.test(text[i]) && isSentenceBreak(text, i)) {
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
