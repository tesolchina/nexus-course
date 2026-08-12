// Minimal YAML subset parser, zero dependencies. Supports exactly what a
// course.yaml needs: nested maps by indentation (2-space), lists ("- item"),
// lists of maps ("- id: l1" + indented keys), scalars, quoted strings,
// block scalars (| and >), and # comments. No anchors, no multi-docs.
//
// Anything fancier should be rejected loudly rather than silently mis-parsed,
// because a wrong parse of course.yaml breaks every student screen.

function parseScalar(raw) {
  let s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return s.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1);
  if (s === "null" || s === "~") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

function stripComment(line) {
  let inS = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inS) {
      if (ch === inS && line[i - 1] !== "\\") inS = null;
    } else if (ch === '"' || ch === "'") {
      inS = ch;
    } else if (ch === "#" && (i === 0 || line[i - 1] === " " || line[i - 1] === "\t")) {
      return line.slice(0, i);
    }
  }
  return line;
}

// Splits "key: value" while respecting quotes inside the value.
function splitKeyValue(line) {
  let inS = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inS) {
      if (ch === inS && line[i - 1] !== "\\") inS = null;
    } else if (ch === '"' || ch === "'") {
      inS = ch;
    } else if (ch === ":" && (i + 1 === line.length || line[i + 1] === " ")) {
      const value = line.slice(i + 1).trim();
      return [line.slice(0, i).trim(), value === "" ? null : value];
    }
  }
  return [line.trim(), null];
}

function tokenize(text) {
  return text.split("\n").map((line) => {
    const clean = stripComment(line.replace(/\t/g, "  "));
    const indent = clean.match(/^ */)[0].length;
    return { indent, content: clean.slice(indent), blank: clean.trim() === "" };
  });
}

export function parseYaml(text) {
  const lines = tokenize(text);
  let pos = 0;

  function peek() {
    return lines[pos];
  }

  // A block is either a map or a list, decided by the first content line.
  function parseBlock(minIndent) {
    while (pos < lines.length && lines[pos].blank) pos++;
    const first = peek();
    if (!first || first.indent < minIndent) return null;
    if (first.content.startsWith("- ")) return parseList(first.indent);
    return parseMap(first.indent);
  }

  function parseList(indent) {
    const items = [];
    while (pos < lines.length) {
      const line = lines[pos];
      if (line.blank) {
        pos++;
        continue;
      }
      if (line.indent < indent) break;
      if (line.indent > indent) throw new Error(`Bad indentation near: "${line.content}"`);
      if (!line.content.startsWith("- ")) break;
      pos++;
      const rest = line.content.slice(2);
      if (rest === "") {
        items.push(parseBlock(indent + 2));
      } else if (rest.endsWith(":")) {
        // "- key:" with indented children -> { key: <child block> }
        const key = rest.slice(0, -1).trim();
        const item = {};
        item[key] = parseBlock(indent + 2);
        items.push(item);
      } else {
        const [k, v] = splitKeyValue(rest);
        if (v === null) {
          items.push(parseScalar(rest));
        } else {
          // "- key: value" + following indented keys -> a map item
          const item = {};
          item[k] = parseValue(v, line.indent + 2);
          const extra = parseMap(indent + 2);
          if (extra) Object.assign(item, extra);
          items.push(item);
        }
      }
    }
    return items;
  }

  function parseMap(indent) {
    const map = {};
    while (pos < lines.length) {
      const line = lines[pos];
      if (line.blank) {
        pos++;
        continue;
      }
      if (line.indent < indent) break;
      if (line.indent > indent) throw new Error(`Bad indentation near: "${line.content}"`);
      if (line.content.startsWith("- ")) break; // a sibling list, not a map key
      const [key, value] = splitKeyValue(line.content);
      if (value === null) {
        if (line.content.endsWith(":")) {
          pos++;
          map[key] = parseBlock(indent + 2);
        } else {
          throw new Error(`Expected "key: value" near: "${line.content}"`);
        }
      } else {
        pos++;
        map[key] = parseValue(value, indent);
      }
    }
    return map;
  }

  function parseValue(value, indent) {
    if (value === "|" || value === ">") {
      const parts = [];
      while (pos < lines.length) {
        const line = lines[pos];
        if (line.blank) {
          parts.push("");
          pos++;
          continue;
        }
        if (line.indent <= indent) break;
        parts.push(line.content);
        pos++;
      }
      const out = parts.join("\n").replace(/\n+$/, "");
      return value === "|" ? out + "\n" : out.replace(/\n/g, " ").trim() + "\n";
    }
    return parseScalar(value);
  }

  return parseBlock(0);
}
