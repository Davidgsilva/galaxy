const blessed = require('blessed');

function createShell({ welcome, placeholder = '> Try "write a test for index.js"', onSubmit, onResize }) {
  const screen = blessed.screen({ 
    smartCSR: true, 
    title: 'Beacon - AI-powered Yocto Assistant',
    cursor: {
      artificial: true,
      shape: 'line',
      blink: true
    }
  });

  // Output pane - scrollable area above input
  const output = blessed.box({
    top: 0,
    left: 0,
    right: 0,
    bottom: 4, // Leave space for input box (height 3 + 1 for label)
    content: '',
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: ' ',
      track: {
        bg: 'grey'
      },
      style: {
        bg: 'grey',
        fg: 'white'
      }
    },
    style: {
      fg: 'white',
      bg: null // Use terminal's native background
    }
  });

  // Input label
  const inputLabel = blessed.text({
    bottom: 3,
    left: 1,
    width: 'shrink',
    height: 1,
    content: 'Input',
    style: {
      fg: 'grey',
      bg: null // Use terminal's native background
    }
  });

  // Input box - critical styling to avoid blue backgrounds
  const input = blessed.textarea({
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    inputOnFocus: true,
    mouse: true,
    keys: true,
    padding: {
      left: 1,
      right: 1,
      top: 0,
      bottom: 0
    },
    border: {
      type: 'line'
    },
    style: {
      fg: 'white',
      bg: null, // Use terminal's native background
      border: {
        fg: 'grey'
      },
      focus: {
        fg: 'white',
        bg: null, // Use terminal's native background - NO BLUE!
        border: {
          fg: 'cyan' // Only the border changes color on focus
        }
      }
    }
  });

  // Append elements to screen
  screen.append(output);
  screen.append(inputLabel);
  screen.append(input);

  // Placeholder handling
  let placeholderActive = true;
  let streamBuffer = '';
  let streamTimer = null;

  function updatePlaceholder() {
    if (placeholderActive) {
      input.setValue(placeholder);
      input.style.fg = 'grey';
    }
  }

  function clearPlaceholder() {
    if (placeholderActive) {
      input.clearValue();
      input.style.fg = 'white';
      placeholderActive = false;
      screen.render();
    }
  }

  function restorePlaceholder() {
    if (input.getValue().trim() === '') {
      placeholderActive = true;
      updatePlaceholder();
      screen.render();
    }
  }

  // Input event handlers
  input.on('focus', () => {
    clearPlaceholder();
  });

  input.on('blur', () => {
    restorePlaceholder();
  });

  // Key handlers for input
  input.key(['enter'], (ch, key) => {
    if (key.shift) {
      // Shift+Enter: insert newline
      input.insertText('\n');
      return;
    }

    // Enter: submit message
    const value = input.getValue().trim();
    if (value === '' || (placeholderActive && value === placeholder)) {
      return; // Don't submit empty or placeholder text
    }

    // Clear input and restore placeholder
    input.clearValue();
    placeholderActive = true;
    updatePlaceholder();

    // Submit the message
    if (onSubmit) {
      onSubmit(value);
    }

    // Keep focus on input and render
    input.focus();
    screen.render();
  });

  // Handle typing to clear placeholder
  input.on('keypress', (ch, key) => {
    if (key && (key.name === 'enter' || key.name === 'return')) {
      return; // Already handled above
    }
    
    if (placeholderActive && ch && ch.match(/\S/)) {
      clearPlaceholder();
    }
  });

  // Global key handlers
  screen.key(['C-c'], () => {
    screen.emit('beacon-exit');
  });

  // Tab focuses input
  screen.key(['tab'], () => {
    input.focus();
    screen.render();
  });

  // Resize handling
  screen.on('resize', () => {
    // Adjust layout on resize
    const height = screen.height;
    const inputHeight = 3;
    const labelHeight = 1;
    
    output.height = height - inputHeight - labelHeight;
    
    if (onResize) {
      onResize({ width: screen.width, height: screen.height });
    }
    
    screen.render();
  });

  // Initialize with welcome message
  if (welcome) {
    output.setContent(welcome);
  }

  // Set initial placeholder and focus
  updatePlaceholder();
  input.focus();
  screen.render();

  // Streaming buffer management
  function flushStreamBuffer() {
    if (streamBuffer) {
      const currentContent = output.getContent();
      output.setContent(currentContent + streamBuffer);
      output.setScrollPerc(100);
      streamBuffer = '';
      screen.render();
    }
  }

  function scheduleStreamFlush() {
    if (streamTimer) {
      clearTimeout(streamTimer);
    }
    streamTimer = setTimeout(flushStreamBuffer, 50); // 50ms buffer for smooth streaming
  }

  // Public API
  const api = {
    // Write a complete line to output
    write(line = '') {
      if (streamBuffer) {
        flushStreamBuffer(); // Flush any pending stream content first
      }
      
      const currentContent = output.getContent();
      const newContent = currentContent + (currentContent ? '\n' : '') + line;
      output.setContent(newContent);
      output.setScrollPerc(100);
      screen.render();
    },

    // Write raw text (for streaming) - buffered
    writeRaw(text = '') {
      streamBuffer += text;
      scheduleStreamFlush();
    },

    // Write info message (grey)
    info(message) {
      api.write(`{grey-fg}${message}{/grey-fg}`);
    },

    // Write error message (red)
    error(message) {
      api.write(`{red-fg}❌ ${message}{/red-fg}`);
    },

    // Write success message (green)
    success(message) {
      api.write(`{green-fg}✅ ${message}{/green-fg}`);
    },

    // Write user message (cyan)
    user(message) {
      api.write(`{cyan-fg}> ${message}{/cyan-fg}`);
    },

    // Write assistant header
    assistant() {
      api.write(`{blue-fg}🤖 Beacon:{/blue-fg}`);
    },

    // Clear output
    clear() {
      output.setContent('');
      screen.render();
    },

    // Focus input
    focus() {
      input.focus();
      screen.render();
    },

    // Set placeholder text
    setPlaceholder(text) {
      placeholder = text;
      if (placeholderActive) {
        updatePlaceholder();
      }
    },

    // Clean destroy
    destroy() {
      if (streamTimer) {
        clearTimeout(streamTimer);
      }
      try {
        screen.destroy();
      } catch (error) {
        // Ignore errors during cleanup
      }
    },

    // Expose internals for advanced usage
    screen,
    input,
    output
  };

  return api;
}

module.exports = { createShell };