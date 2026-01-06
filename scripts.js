const editor = document.getElementById('editor');
const lineNumbers = document.getElementById('line-numbers');
const resizer = document.getElementById('resizer');
const outputEl = document.getElementById('output');
const copyBtn = document.querySelector('.preview-copy-btn');

const controls = {
  dialect: document.getElementById('dialect'),
  stylePreset: document.getElementById('stylePreset'),
  keywordCase: document.getElementById('keywordCase'),
  dataTypeCase: document.getElementById('dataTypeCase'),
  functionCase: document.getElementById('functionCase'),
  identifiersCase: document.getElementById('identifiersCase'),
  variableCase: document.getElementById('variableCase'),
  quotedIdentifierCase: document.getElementById('quotedIdentifierCase'),
  commaLinebreak: document.getElementById('commaLinebreak'),
  listStyle: document.getElementById('listStyle'),
  stackedAlign: document.getElementById('stackedAlign'),
  andOrUnderWhere: document.getElementById('andOrUnderWhere'),
  removeLinebreakBeforeBeautify: document.getElementById('removeLinebreakBeforeBeautify'),
  trimQuotedCharEachLine: document.getElementById('trimQuotedCharEachLine'),
  trimChar: document.getElementById('trimChar'),
  minify: document.getElementById('minify'),
  removeComments: document.getElementById('removeComments'),
};

const initialSql = `-- Paste SQL on the left
SELECT supplier_name, city
FROM (
  SELECT *
  FROM suppliers
  JOIN addresses ON suppliers.address_id = addresses.id
) AS suppliers
WHERE supplier_id > 500
  AND city IS NOT NULL
ORDER BY supplier_name ASC, city DESC;
`;

editor.value = initialSql;

const debounce = (fn, waitMs) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
};

const updateLineNumbers = () => {
  const lines = editor.value.split('\n').length;
  lineNumbers.innerHTML = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
};

const isUnchanged = (value) => !value || value === 'unchanged';

const applyCase = (text, mode) => {
  if (!text) return text;
  switch (mode) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'initcap':
      return text
        .toLowerCase()
        .replace(/(^|[^a-zA-Z0-9])([a-zA-Z])/g, (m, p1, p2) => p1 + p2.toUpperCase());
    case 'unchanged':
    default:
      return text;
  }
};

const forEachNonQuotedSegment = (sql, fn) => {
  let out = '';
  let i = 0;
  let mode = 'none';
  let segmentStart = 0;

  const flush = (end) => {
    if (end > segmentStart) {
      out += fn(sql.slice(segmentStart, end));
    }
  };

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (mode === 'none') {
      if (ch === "'") {
        flush(i);
        mode = 'single';
        segmentStart = i;
        i++;
        continue;
      }
      if (ch === '"') {
        flush(i);
        mode = 'double';
        segmentStart = i;
        i++;
        continue;
      }
      if (ch === '`') {
        flush(i);
        mode = 'backtick';
        segmentStart = i;
        i++;
        continue;
      }
      if (ch === '[') {
        flush(i);
        mode = 'bracket';
        segmentStart = i;
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (mode === 'single') {
      if (ch === "'" && next === "'") {
        i += 2;
        continue;
      }
      if (ch === "'") {
        out += sql.slice(segmentStart, i + 1);
        mode = 'none';
        segmentStart = i + 1;
      }
      i++;
      continue;
    }

    if (mode === 'double') {
      if (ch === '"' && next === '"') {
        i += 2;
        continue;
      }
      if (ch === '"') {
        out += sql.slice(segmentStart, i + 1);
        mode = 'none';
        segmentStart = i + 1;
      }
      i++;
      continue;
    }

    if (mode === 'backtick') {
      if (ch === '`') {
        out += sql.slice(segmentStart, i + 1);
        mode = 'none';
        segmentStart = i + 1;
      }
      i++;
      continue;
    }

    if (mode === 'bracket') {
      if (ch === ']') {
        out += sql.slice(segmentStart, i + 1);
        mode = 'none';
        segmentStart = i + 1;
      }
      i++;
      continue;
    }
  }

  if (mode === 'none') {
    flush(sql.length);
  } else {
    out += sql.slice(segmentStart);
  }
  return out;
};

const removeSqlComments = (sql) => {
  // Best-effort: avoids touching quoted strings/identifiers
  return forEachNonQuotedSegment(sql, (seg) => {
    return seg
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--.*$/gm, '');
  });
};

const trimQuotedCharEachLine = (sql, quotedChar) => {
  if (!quotedChar) return sql;
  const qc = quotedChar[0];
  return sql
    .split(/\r?\n/)
    .map((line) => {
      let out = line;
      if (out.startsWith(qc)) out = out.slice(1);
      if (out.endsWith(qc)) out = out.slice(0, -1);
      return out;
    })
    .join('\n');
};

const minifySql = (sql) => {
  // Best-effort minify outside quoted segments.
  const squashed = forEachNonQuotedSegment(sql, (seg) => {
    return seg
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s*([(),;=<>+\-*/])\s*/g, '$1')
      .replace(/\s+/g, ' ');
  });
  return squashed.trim();
};

const applyCommaLinebreakStyle = (sql, commaMode) => {
  if (commaMode === 'after') return sql;

  if (commaMode === 'before') {
    return sql.replace(/,\n(\s*)(\S)/g, (m, ws, ch) => `\n${ws},${ch}`);
  }

  if (commaMode === 'beforeSpace') {
    return sql.replace(/,\n(\s*)(\S)/g, (m, ws, ch) => `\n${ws}, ${ch}`);
  }

  return sql;
};

const collapseSelectListIfNeeded = (sql, listStyle) => {
  if (listStyle !== 'notStacked') return sql;

  // Best-effort: collapse only the top-level SELECT list (first SELECT...FROM block)
  const match = sql.match(/\bSELECT\b[\s\S]*?\bFROM\b/);
  if (!match) return sql;

  const block = match[0];
  const collapsed = block
    .replace(/\n\s{2,}/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\bSELECT\b\s*/i, 'SELECT ')
    .replace(/\s*\bFROM\b/i, '\nFROM');

  return sql.replace(block, collapsed);
};

const applyFunctionInitCap = (sql, mode) => {
  if (mode !== 'initcap') return sql;

  // Best-effort: Title-case function names before '(' (outside quotes)
  return forEachNonQuotedSegment(sql, (seg) => {
    return seg.replace(/\b([A-Za-z_][A-Za-z0-9_$]*)\s*\(/g, (m, fn) => {
      const formatted = applyCase(fn, 'initcap');
      return m.replace(fn, formatted);
    });
  });
};

const applyVariableCase = (sql, mode) => {
  if (isUnchanged(mode)) return sql;
  return forEachNonQuotedSegment(sql, (seg) => {
    return seg.replace(/([@:][$A-Za-z_][A-Za-z0-9_$]*)/g, (m) => {
      const prefix = m[0];
      const rest = m.slice(1);
      return prefix + applyCase(rest, mode);
    });
  });
};

const applyIdentifierCaseBestEffort = (sql, cfg) => {
  // Lightweight, heuristic-only casing. If you need precise table/column/alias
  // casing, it requires a real SQL parser.
  let out = sql;

  // Table names after FROM/JOIN/UPDATE/INTO
  if (!isUnchanged(cfg.identifiersCase)) {
    out = forEachNonQuotedSegment(out, (seg) => {
      return seg.replace(
        /(\bFROM\b|\bJOIN\b|\bUPDATE\b|\bINTO\b)\s+([A-Za-z_][A-Za-z0-9_$\.]*)(?=\b|\s|\n)/gi,
        (m, kw, id) => `${kw} ${applyCase(id, cfg.identifiersCase)}`
      );
    });
  }

  // Aliases after AS
  if (!isUnchanged(cfg.identifiersCase)) {
    out = forEachNonQuotedSegment(out, (seg) => {
      return seg.replace(/\bAS\b\s+([A-Za-z_][A-Za-z0-9_$]*)/gi, (m, id) => {
        return m.replace(id, applyCase(id, cfg.identifiersCase));
      });
    });
  }

  // Columns in simple SELECT lists: lines that start with indentation and a token
  if (!isUnchanged(cfg.identifiersCase)) {
    out = out
      .split('\n')
      .map((line) => {
        const m = line.match(/^(\s+)([A-Za-z_][A-Za-z0-9_$\.]*)(\s*,?\s*)(.*)$/);
        if (!m) return line;
        const [, indent, token, mid, rest] = m;
        if (/^(FROM|WHERE|GROUP|ORDER|HAVING|LIMIT|JOIN|ON)\b/i.test(token)) return line;
        if (token === '*') return line;
        return `${indent}${applyCase(token, cfg.identifiersCase)}${mid}${rest}`;
      })
      .join('\n');
  }

  return out;
};

const getFormatterOptions = (cfg) => {
  const opts = {
    language: cfg.dialect,
  };

  if (!isUnchanged(cfg.keywordCase)) opts.keywordCase = cfg.keywordCase;
  if (!isUnchanged(cfg.dataTypeCase)) opts.dataTypeCase = cfg.dataTypeCase;

  // sql-formatter supports upper/lower for functionCase.
  // InitCap is handled as a post-step.
  if (cfg.functionCase === 'upper' || cfg.functionCase === 'lower') {
    opts.functionCase = cfg.functionCase;
  }

  // Note: We intentionally avoid sql-formatter's experimental identifierCase here.
  // We apply identifier casing as a post-step (best-effort) so quoted identifiers
  // can remain unchanged.

  // Preset styles
  if (cfg.stylePreset === 'indented') {
    opts.tabWidth = 4;
  } else {
    opts.tabWidth = 2;
  }

  if (cfg.stylePreset === 'collapsed') {
    opts.expressionWidth = 200;
  }

  // Alignment presets
  if (cfg.stylePreset === 'rightAligned' || cfg.stackedAlign === 'right') {
    opts.indentStyle = 'tabularRight';
  } else if (cfg.stackedAlign === 'left') {
    opts.indentStyle = 'tabularLeft';
  }

  // AND/OR newline placement
  opts.logicalOperatorNewline = cfg.andOrUnderWhere ? 'before' : 'after';

  return opts;
};

const setOutput = (sql) => {
  outputEl.textContent = sql;
  if (window.hljs) {
    try {
      window.hljs.highlightElement(outputEl);
    } catch (e) {
      // ignore highlighting errors
    }
  }
};

const formatAndRender = () => {
  const cfg = {
    dialect: controls.dialect.value,
    stylePreset: controls.stylePreset.value,
    keywordCase: controls.keywordCase.value,
    dataTypeCase: controls.dataTypeCase.value,
    functionCase: controls.functionCase.value,
    identifiersCase: controls.identifiersCase.value,
    variableCase: controls.variableCase.value,
    quotedIdentifierCase: controls.quotedIdentifierCase.value,
    commaLinebreak: controls.commaLinebreak.value,
    listStyle: controls.listStyle.value,
    stackedAlign: controls.stackedAlign.value,
    andOrUnderWhere: controls.andOrUnderWhere.checked,
    removeLinebreakBeforeBeautify: controls.removeLinebreakBeforeBeautify.checked,
    trimQuotedCharEachLine: controls.trimQuotedCharEachLine.checked,
    trimChar: controls.trimChar.value,
    minify: controls.minify.checked,
    removeComments: controls.removeComments.checked,
  };

  let sql = editor.value;

  if (cfg.removeLinebreakBeforeBeautify) {
    sql = sql.replace(/\r?\n+/g, ' ').replace(/\s{2,}/g, ' ');
  }

  if (cfg.trimQuotedCharEachLine) {
    sql = trimQuotedCharEachLine(sql, cfg.trimChar);
  }

  if (cfg.removeComments) {
    sql = removeSqlComments(sql);
  }

  try {
    let out;

    if (cfg.minify) {
      out = minifySql(sql);
    } else {
      const options = getFormatterOptions(cfg);
      if (!window.sqlFormatter || typeof window.sqlFormatter.format !== 'function') {
        throw new Error('sql-formatter library did not load');
      }
      out = window.sqlFormatter.format(sql, options);
      out = collapseSelectListIfNeeded(out, cfg.listStyle);
      if (cfg.stylePreset === 'commasBefore') {
        out = applyCommaLinebreakStyle(out, 'beforeSpace');
      } else {
        out = applyCommaLinebreakStyle(out, cfg.commaLinebreak);
      }
    }

    // Post-processing casing
    out = applyFunctionInitCap(out, cfg.functionCase);
    out = applyVariableCase(out, cfg.variableCase);
    out = applyIdentifierCaseBestEffort(out, cfg);

    setOutput(out);
  } catch (err) {
    setOutput(`-- Formatting error\n-- ${String(err && err.message ? err.message : err)}`);
  }
};

const scheduleRender = debounce(formatAndRender, 80);

editor.addEventListener('input', () => {
  updateLineNumbers();
  scheduleRender();
});

editor.addEventListener('scroll', () => {
  lineNumbers.scrollTop = editor.scrollTop;
});

Object.values(controls).forEach((el) => {
  el.addEventListener('change', scheduleRender);
  el.addEventListener('input', scheduleRender);
});

// Copy output
window.copyPreviewContent = async () => {
  const text = outputEl.textContent || '';
  try {
    await navigator.clipboard.writeText(text);
    if (copyBtn) {
      copyBtn.classList.add('copied');
      setTimeout(() => copyBtn.classList.remove('copied'), 900);
    }
  } catch (err) {
    // Fallback
    const temp = document.createElement('textarea');
    temp.value = text;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    document.body.removeChild(temp);
  }
};

// Resizer functionality (kept from template)
let isResizing = false;
resizer.addEventListener('mousedown', () => {
  isResizing = true;
  resizer.classList.add('resizing');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;

  const container = document.querySelector('.workspace');
  const containerRect = container.getBoundingClientRect();
  const leftPanel = container.querySelector('.panel:first-child');
  const rightPanel = container.querySelector('.right-panel');

  const offsetX = e.clientX - containerRect.left;
  const totalWidth = containerRect.width;
  const leftWidth = (offsetX / totalWidth) * 100;

  if (leftWidth > 20 && leftWidth < 80) {
    leftPanel.style.flex = `0 0 ${leftWidth}%`;
    rightPanel.style.flex = `0 0 ${100 - leftWidth}%`;
  }
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    resizer.classList.remove('resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

updateLineNumbers();
formatAndRender();

// Modal Functions
window.openModal = (modalId) => {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
  }
};

window.closeModal = (modalId) => {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
  }
};

// Close modal on outside click
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal(modal.id);
    }
  });
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal.active').forEach(modal => {
      closeModal(modal.id);
    });
  }
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal.active').forEach(modal => {
      closeModal(modal.id);
    });
  }
});

// Case button handlers
document.querySelectorAll('.case-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const button = e.currentTarget;
    const setting = button.dataset.setting;
    const value = button.dataset.value;
    
    // Remove active class from siblings
    const group = button.parentElement;
    group.querySelectorAll('.case-btn').forEach(b => b.classList.remove('active'));
    
    // Add active class to clicked button
    button.classList.add('active');
    
    // Update hidden select element
    const selectEl = document.getElementById(setting);
    if (selectEl) {
      selectEl.value = value;
      // Trigger change event to update formatting
      const event = new Event('change', { bubbles: true });
      selectEl.dispatchEvent(event);
    }
  });
});

// Toolbar icon button handlers (Database, Styles)
document.querySelectorAll('.toolbar-icon-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const button = e.currentTarget;
    const setting = button.dataset.setting;
    const value = button.dataset.value;
    
    // Remove active class from siblings in same group
    const group = button.parentElement;
    group.querySelectorAll('.toolbar-icon-btn').forEach(b => b.classList.remove('active'));
    
    // Add active class to clicked button
    button.classList.add('active');
    
    // Update hidden select element
    const selectEl = document.getElementById(setting);
    if (selectEl) {
      selectEl.value = value;
      // Trigger change event to update formatting
      const event = new Event('change', { bubbles: true });
      selectEl.dispatchEvent(event);
    }
  });
});

// Table Modal Functions
let selectedTableAlign = 'left';

function selectAlign(align) {
  selectedTableAlign = align;
  document.querySelectorAll('.align-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`.align-btn[data-align="${align}"]`).classList.add('active');
}

function insertTable() {
  const rows = parseInt(document.getElementById('tableRows').value);
  const cols = parseInt(document.getElementById('tableCols').value);
  const align = selectedTableAlign;
  
  if (!rows || !cols || rows < 1 || cols < 1) {
    alert('Please enter valid numbers for rows and columns');
    return;
  }
  
  // Alignment characters
  let alignChar = '---';
  if (align === 'center') alignChar = ':---:';
  else if (align === 'right') alignChar = '---:';
  else if (align === 'left') alignChar = ':---';
  
  // Build table
  let table = '\n';
  
  // Header row
  table += '|';
  for (let i = 1; i <= cols; i++) {
    table += ` Header ${i} |`;
  }
  table += '\n';
  
  // Separator row
  table += '|';
  for (let i = 0; i < cols; i++) {
    table += ` ${alignChar} |`;
  }
  table += '\n';
  
  // Data rows
  for (let r = 1; r <= rows; r++) {
    table += '|';
    for (let c = 1; c <= cols; c++) {
      table += ` Cell ${r},${c} |`;
    }
    table += '\n';
  }
  
  insertAtCursor(table, '', '');
  closeModal('tableModal');
}

// Image Modal Functions
let selectedImageFile = null;

const imageUploadArea = document.getElementById('imageUploadArea');
const imageFileInput = document.getElementById('imageFileInput');

if (imageUploadArea && imageFileInput) {
  imageUploadArea.addEventListener('click', () => {
    imageFileInput.click();
  });

  imageFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      handleImageFile(file);
    }
  });

  // Drag and drop functionality
  imageUploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    imageUploadArea.classList.add('drag-over');
  });

  imageUploadArea.addEventListener('dragleave', () => {
    imageUploadArea.classList.remove('drag-over');
  });

  imageUploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    imageUploadArea.classList.remove('drag-over');
    
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleImageFile(file);
    }
  });
}

function handleImageFile(file) {
  selectedImageFile = file;
  
  // Show preview
  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = document.getElementById('imagePreview');
    if (preview) {
      preview.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
    }
  };
  reader.readAsDataURL(file);
  
  // Clear URL input
  const imageUrl = document.getElementById('imageUrl');
  if (imageUrl) {
    imageUrl.value = '';
  }
}

function insertImage() {
  const altTextEl = document.getElementById('imageAlt');
  const imageUrlEl = document.getElementById('imageUrl');
  
  if (!altTextEl || !imageUrlEl) return;
  
  const altText = altTextEl.value || 'image';
  let imageUrl = imageUrlEl.value;
  
  // If file is selected, convert to base64
  if (selectedImageFile) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const markdown = `![${altText}](${e.target.result})`;
      const selection = window.imageSelection || { start: editor.selectionStart, end: editor.selectionEnd };
      
      editor.value = editor.value.substring(0, selection.start) + markdown + editor.value.substring(selection.end);
      editor.selectionStart = editor.selectionEnd = selection.start + markdown.length;
      
      saveToHistory();
      updateLineNumbers();
      render();
      editor.focus();
      
      closeModal('imageModal');
      selectedImageFile = null;
    };
    reader.readAsDataURL(selectedImageFile);
  } else if (imageUrl) {
    const markdown = `![${altText}](${imageUrl})`;
    const selection = window.imageSelection || { start: editor.selectionStart, end: editor.selectionEnd };
    
    editor.value = editor.value.substring(0, selection.start) + markdown + editor.value.substring(selection.end);
    editor.selectionStart = editor.selectionEnd = selection.start + markdown.length;
    
    saveToHistory();
    updateLineNumbers();
    render();
    editor.focus();
    
    closeModal('imageModal');
  } else {
    alert('Please select an image or enter an image URL');
  }
}

// Link Modal Functions
function insertLink() {
  const linkTextEl = document.getElementById('linkText');
  const linkUrlEl = document.getElementById('linkUrl');
  
  if (!linkTextEl || !linkUrlEl) return;
  
  const linkText = linkTextEl.value;
  const linkUrl = linkUrlEl.value;
  
  if (!linkText || !linkUrl) {
    alert('Please enter both link text and URL');
    return;
  }
  
  const markdown = `[${linkText}](${linkUrl})`;
  const selection = window.linkSelection || { start: editor.selectionStart, end: editor.selectionEnd };
  
  editor.value = editor.value.substring(0, selection.start) + markdown + editor.value.substring(selection.end);
  editor.selectionStart = editor.selectionEnd = selection.start + markdown.length;
  
  saveToHistory();
  updateLineNumbers();
  render();
  editor.focus();
  
  closeModal('linkModal');
}

// Code Block Modal Functions
function insertCodeBlock() {
  const languageEl = document.getElementById('codeLanguage');
  const contentEl = document.getElementById('codeContent');
  
  if (!languageEl || !contentEl) return;
  
  const language = languageEl.value;
  const content = contentEl.value;
  
  const langSpec = language ? language : '';
  const codeText = content || 'your code here';
  const markdown = `\n\`\`\`${langSpec}\n${codeText}\n\`\`\`\n`;
  
  const selection = window.codeBlockSelection || { start: editor.selectionStart, end: editor.selectionEnd };
  
  editor.value = editor.value.substring(0, selection.start) + markdown + editor.value.substring(selection.end);
  
  // Position cursor inside the code block
  if (!content) {
    const cursorPos = selection.start + langSpec.length + 5; // After ```lang\n
    editor.selectionStart = cursorPos;
    editor.selectionEnd = cursorPos + 14; // Select "your code here"
  } else {
    editor.selectionStart = editor.selectionEnd = selection.start + markdown.length;
  }
  
  saveToHistory();
  updateLineNumbers();
  render();
  editor.focus();
  
  closeModal('codeBlockModal');
}

// Code editor helper functions
function updateCodeLineNumbers() {
  const codeContent = document.getElementById('codeContent');
  const lineNumbers = document.getElementById('codeLineNumbers');
  const lines = codeContent.value.split('\n').length;
  lineNumbers.innerHTML = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
}

function syncCodeScroll() {
  const codeContent = document.getElementById('codeContent');
  const lineNumbers = document.getElementById('codeLineNumbers');
  lineNumbers.scrollTop = codeContent.scrollTop;
}

function pasteCodeBlock() {
  navigator.clipboard.readText().then(text => {
    const codeContent = document.getElementById('codeContent');
    const start = codeContent.selectionStart;
    const end = codeContent.selectionEnd;
    const currentValue = codeContent.value;
    
    codeContent.value = currentValue.substring(0, start) + text + currentValue.substring(end);
    codeContent.selectionStart = codeContent.selectionEnd = start + text.length;
    updateCodeLineNumbers();
    codeContent.focus();
  }).catch(err => {
    console.log('Paste failed, use Ctrl+V');
  });
}

function clearCodeBlock() {
  const codeContent = document.getElementById('codeContent');
  if (!codeContent) return;
  codeContent.value = '';
  updateCodeLineNumbers();
  codeContent.focus();
}

// Code editor helper functions
function updateCodeLineNumbers() {
  const codeContent = document.getElementById('codeContent');
  const lineNumbers = document.getElementById('codeLineNumbers');
  if (!codeContent || !lineNumbers) return;
  const lines = codeContent.value.split('\n').length;
  lineNumbers.innerHTML = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
}

function syncCodeScroll() {
  const codeContent = document.getElementById('codeContent');
  const lineNumbers = document.getElementById('codeLineNumbers');
  if (!codeContent || !lineNumbers) return;
  lineNumbers.scrollTop = codeContent.scrollTop;
}

function pasteCodeBlock() {
  navigator.clipboard.readText().then(text => {
    const codeContent = document.getElementById('codeContent');
    if (!codeContent) return;
    const start = codeContent.selectionStart;
    const end = codeContent.selectionEnd;
    const currentValue = codeContent.value;
    
    codeContent.value = currentValue.substring(0, start) + text + currentValue.substring(end);
    codeContent.selectionStart = codeContent.selectionEnd = start + text.length;
    updateCodeLineNumbers();
    codeContent.focus();
  }).catch(err => {
    console.log('Paste failed, use Ctrl+V');
  });
}

// Copy preview content
function copyPreviewContent() {
  const preview = document.getElementById('preview');
  const button = document.querySelector('.preview-copy-btn');
  
  const htmlContent = preview.innerHTML;
  const textContent = preview.innerText;
  
  const blob = new Blob([htmlContent], { type: 'text/html' });
  const plainBlob = new Blob([textContent], { type: 'text/plain' });
  
  const clipboardItem = new ClipboardItem({
    'text/html': blob,
    'text/plain': plainBlob
  });
  
  navigator.clipboard.write([clipboardItem]).then(() => {
    button.classList.add('copied');
    setTimeout(() => button.classList.remove('copied'), 2000);
  }).catch(() => {
    navigator.clipboard.writeText(textContent).then(() => {
      button.classList.add('copied');
      setTimeout(() => button.classList.remove('copied'), 2000);
    }).catch(err => console.error('Failed to copy:', err));
  });
}

