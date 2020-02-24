'use strict'
const fs = require('fs')
const tty = require('tty')
const blessed = require('@medv/blessed')
const stringWidth = require('string-width')
const reduce = require('./reduce')
const print = require('./print')
const find = require('./find')
const config = require('./config')

module.exports = function start(filename, source, prev = {}) {
  // Current rendered object on a screen.
  let json = prev.json || source

  // Contains map from row number to expand path.
  // Example: {0: '', 1: '.foo', 2: '.foo[0]'}
  let index = new Map()

  // Contains expanded paths. Example: ['', '.foo']
  // Empty string represents root path.
  const expanded = prev.expanded || new Set()
  expanded.add('')

  // Current filter code.
  let currentCode = null

  // Current search regexp and generator.
  let highlight = null
  let findGen = null
  let currentPath = null

  let ttyReadStream, ttyWriteStream

  // Reopen tty
  if (process.platform === 'win32') {
    const cfs = process.binding('fs')
    ttyReadStream = tty.ReadStream(cfs.open('conin$', fs.constants.O_RDWR | fs.constants.O_EXCL, 0o666))
    ttyWriteStream = tty.WriteStream(cfs.open('conout$', fs.constants.O_RDWR | fs.constants.O_EXCL, 0o666))
  } else {
    const ttyFd = fs.openSync('/dev/tty', 'r+')
    ttyReadStream = tty.ReadStream(ttyFd)
    ttyWriteStream = tty.WriteStream(ttyFd)
  }

  const program = blessed.program({
    input: ttyReadStream,
    output: ttyWriteStream,
  })

  const screen = blessed.screen({
    program: program,
    smartCSR: true,
    fullUnicode: true,
  })

  const box_height = config.useRuler ? '100%-2' : '100%'

  const box = blessed.box({
    parent: screen,
    tags: false,
    left: 0,
    top: 0,
    width: '100%',
    height: box_height,
    mouse: true,
    keys: true,
    vi: true,
    ignoreArrows: true,
    alwaysScroll: true,
    scrollable: true,
  })

  const input = blessed.textbox({
    parent: screen,
    bottom: 0,
    left: 0,
    height: 1,
    width: '100%',
  })

  const search = blessed.textbox({
    parent: screen,
    bottom: 0,
    left: 0,
    height: 1,
    width: '100%',
  })

  const statusBar = blessed.box({
    parent: screen,
    tags: false,
    bottom: 0,
    left: 0,
    height: 1,
    width: '100%',
  })

  const ruler = config.useRuler && blessed.box({
    parent: screen,
    fg: config.ruler.fg,
    bg: config.ruler.bg,
    tags: false,
    align: 'right',
    bottom: 1,
    right: 0,
    height: 1,
    width: 16,
  })

  const pathBar = config.useRuler && blessed.box({
    parent: screen,
    fg: config.ruler.path,
    bg: config.ruler.bg,
    tags: false,
    align: 'left',
    bottom: 1,
    left: 0,
    height: 1,
    width: '100%-16',
  })

  const autocomplete = blessed.list({
    parent: screen,
    width: 6,
    height: 7,
    left: 1,
    bottom: 1,
    style: config.list,
  })

  screen.title = filename
  box.focus()
  input.hide()
  search.hide()
  statusBar.hide()
  autocomplete.hide()

  process.stdout.on('resize', () => {
    // Blessed has a bug with resizing the terminal. I tried my best to fix it but was not succeeded.
    // For now exit and print seem like a reasonable alternative, as it not usable after resize.
    // If anyone can fix this bug it will be cool.
    printJson({expanded})
  })

  screen.key(['escape', 'q', 'C-c'], function () {
    exit()
  })

  input.on('submit', function () {
    if (autocomplete.hidden) {
      const code = input.getValue()
      if (/^\//.test(code)) {
        // Forgive a mistake to the user. This looks like user wanted to search something.
        apply('')
        applyPattern(code)
      } else {
        apply(code)
      }
    } else {
      // Autocomplete selected
      let code = input.getValue()
      let replace = autocomplete.getSelected()
      if (/^[a-z]\w*$/i.test(replace)) {
        replace = '.' + replace
      } else {
        replace = `["${replace}"]`
      }
      code = code.replace(/\.\w*$/, replace)

      input.setValue(code)
      autocomplete.hide()
      update(code)

      // Keep editing code
      input.readInput()
    }
  })

  input.on('cancel', function () {
    if (autocomplete.hidden) {
      const code = input.getValue()
      apply(code)
    } else {
      // Autocomplete not selected
      autocomplete.hide()
      render()

      // Keep editing code
      input.readInput()
    }
  })

  input.on('update', function (code) {
    if (currentCode === code) {
      return
    }
    currentCode = code
    if (index.size < 10000) { // Don't live update in we have a big JSON file.
      update(code)
    }
    complete(code)
  })

  input.key('up', function () {
    if (!autocomplete.hidden) {
      autocomplete.up()
      render()
    }
  })

  input.key('down', function () {
    if (!autocomplete.hidden) {
      autocomplete.down()
      render()
    }
  })

  input.key('C-u', function () {
    input.setValue('')
    update('')
    render()
  })

  input.key('C-w', function () {
    let code = input.getValue()
    code = code.replace(/[\.\[][^\.\[]*$/, '')
    input.setValue(code)
    update(code)
    render()
  })

  search.on('submit', function (pattern) {
    applyPattern(pattern)
  })

  search.on('cancel', function () {
    highlight = null
    currentPath = null

    search.hide()
    search.setValue('')

    box.height = box_height
    box.focus()

    program.cursorPos(0, 0)
    render()
  })

  box.key('.', function () {
    hideStatusBar()
    box.height = config.useRuler ? box_height : '100%-1'
    input.show()
    if (input.getValue() === '') {
      input.setValue('.')
      complete('.')
    }
    input.readInput()
    render()
  })

  box.key('/', function () {
    hideStatusBar()
    box.height = config.useRuler ? box_height : '100%-1'
    search.show()
    search.setValue('/')
    search.readInput()
    render()
  })

  box.key('e', function () {
    hideStatusBar()
    expanded.clear()
    for (let path of dfs(json)) {
      if (expanded.size < 1000) {
        expanded.add(path)
      } else {
        break
      }
    }
    render()
  })

  box.key('S-e', function () {
    hideStatusBar()
    expanded.clear()
    expanded.add('')
    render()

    // Make sure cursor stay on JSON object.
    const [n] = getLine(program.y)
    if (typeof n === 'undefined' || !index.has(n)) {
      // No line under cursor
      let rest = [...index.keys()]
      if (rest.length > 0) {
        const next = Math.max(...rest)
        let y = box.getScreenNumber(next) - box.childBase
        if (y <= 0) {
          y = 0
        }
        const line = box.getScreenLine(y + box.childBase)
        program.cursorPos(y, line.search(/\S/))
      }
    }
  })

  box.key('n', function () {
    hideStatusBar()
    findNext()
  })

  // High, Middle, Low cursor movement
  box.key('S-h', function () {
    hideStatusBar()
    program.showCursor()
    const line = box.getScreenLine(box.childBase)
    program.cursorPos(0, line.search(/\S/))
  })

  box.key('S-m', function () {
    hideStatusBar()
    program.showCursor()
    const lastLine = box.height < box.getScrollHeight() ? box.height : box.getScrollHeight()
    const offset = lastLine / 2
    const line = box.getScreenLine(box.childBase + offset)
    program.cursorPos(offset, line.search(/\S/))
  })

  box.key('S-l', function () {
    hideStatusBar()
    program.showCursor()
    const lastLine = box.height < box.getScrollHeight() ? box.height : box.getScrollHeight()
    const line = box.getScreenLine(box.childBase + lastLine - 1)
    program.cursorPos(lastLine - 1, line.search(/\S/))
  })


  // Scrolls to and sets cursor at first line of object
  box.key('g', function () {
    hideStatusBar()
    program.showCursor()
    box.scrollTo(0)

    const line = box.getScreenLine(0)
    program.cursorPos(0)
    render()
  })

  // Scrolls to and sets cursor on last line of object
  box.key('S-g', function () {
    const lastLine = box.getScrollHeight() - 1

    hideStatusBar()
    program.showCursor()
    box.scrollTo(lastLine)

    program.cursorPos(box.height < box.getScrollHeight() ? box.height - 1 : lastLine)
    render()
  })

  box.key(['up', 'k'], function () {
    hideStatusBar()
    program.showCursor()
    const [n] = getLine(program.y)

    let next
    for (let [i,] of index) {
      if (i < n && (typeof next === 'undefined' || i > next)) {
        next = i
      }
    }

    if (typeof next !== 'undefined') {
      let y = box.getScreenNumber(next) - box.childBase
      if (y <= 0) {
        box.scroll(-1)
        y = 0
      }

      const line = box.getScreenLine(y + box.childBase)
      program.cursorPos(y, line.search(/\S/))
    }
    render()
  })

  // Half page up
  box.key(['C-u','u'], function () {
    hideStatusBar()
    program.showCursor()
    const page = Math.round(box.height / 2)

    box.scroll(-page || -1)

    let y = program.y
    if (box.getScroll() == 0) {
      y -= page
    } else {
      y = box.height - 1
    }

    if (y < 0) {
      y = 0
    }

    const line = box.getScreenLine(y + box.childBase)
    program.cursorPos(y, line.search(/\S/))
    render()
  })

  // Full page up (backwards)
  box.key(['C-b','b','pageup'], function () {
    hideStatusBar()
    program.showCursor()
    box.scroll(-box.height || -1)

    let y = box.height - 1
    if (box.getScroll() < box.height) {
      y -= box.height
    }
    if (y < 0) {
      y = 0
    }

    const line = box.getScreenLine(y + box.childBase)
    program.cursorPos(y, line.search(/\S/))
    render()
  })

  box.key(['down', 'j'], function () {
    hideStatusBar()
    program.showCursor()
    const [n] = getLine(program.y)

    let next
    for (let [i,] of index) {
      if (i > n && (typeof next === 'undefined' || i < next)) {
        next = i
      }
    }

    if (typeof next !== 'undefined') {
      let y = box.getScreenNumber(next) - box.childBase
      if (y >= box.height) {
        box.scroll(1)
        y = box.height - 1
      }

      const line = box.getScreenLine(y + box.childBase)
      program.cursorPos(y, line.search(/\S/))
    }
    render()
  })

  // Half page down
  box.key(['C-d','d'], function () {
    hideStatusBar()
    program.showCursor()
    const page = Math.floor(box.height / 2)
    const lastLine = box.getScrollHeight()

    let y = program.y
    if(box.childBase + page < lastLine - page) {
      box.scroll(page)
      y = 0
    } else if (box.height < lastLine) {
      box.scroll(page)
      if (y + page > box.height) {
        y = box.height - 1
      } else {
        y += page
        if(y >= box.height) {
          y = box.height - 1
        }
      }
    } else {
      y = lastLine - 1
    }

    const line = box.getScreenLine(y + box.childBase)
    program.cursorPos(y, line && line.search(/\S/))
    render()
  })

  // Full page down (forwards)
  box.key(['C-f','f','pagedown'], function () {
    hideStatusBar()
    program.showCursor()
    const lastLine = box.getScrollHeight()

    let y = program.y
    if(box.childBase + box.height < lastLine - box.height) {
      box.scroll(box.height)
      y = 0
    } else if (box.height < lastLine) {
      box.scroll(box.height)
      y = box.height - 1
    } else {
      y = lastLine - 1
    }

    const line = box.getScreenLine(y + box.childBase)
    program.cursorPos(y, line.search(/\S/))
    render()
  })

  const isExpanded = y => expanded.has(index.get(y + box.childBase))

  // Next expanded object/array
  box.key('}', function() {
    hideStatusBar()
    const [n] = getLine(program.y)
    if(n < box.getScrollHeight() - 1) {
      let y = program.y

      program.showCursor()
      do {
        y += 1
        if(y >= box.height) {
          box.scroll(box.height || 1)
          // don't jump cursor to top when scrolling to patial last page
          y = n < box.getScrollHeight() - box.height ? 0 : n % box.height
        }
      } while(!isExpanded(y) && y + box.childBase < box.getScrollHeight() - 1)

      const line = box.getScreenLine(y + box.childBase)
      program.cursorPos(y, line && line.search(/\S/))
      render()
    }
  })

  // Previous expanded object/array
  box.key('{', function() {
    hideStatusBar()
    const [n] = getLine(program.y)
    if(box.childBase > 0 || program.y > 0) {
      let y = program.y

      program.showCursor()
      do {
        y -= 1
        if(y < 0) {
          box.scroll(-box.height || -1)
          // don't jump cursor to bottom when scrolling to patial first page
          y = n < box.height ? n - 1 : box.height
        }
      } while(!isExpanded(y) && n > 1)

      const line = box.getScreenLine(y + box.childBase)
      program.cursorPos(y, line && line.search(/\S/))
      render()
    }
  })

  box.key(['right', 'l'], function () {
    hideStatusBar()
    const [n, line] = getLine(program.y)
    program.showCursor()
    program.cursorPos(program.y, line.search(/\S/))
    const path = index.get(n)
    if (!expanded.has(path)) {
      expanded.add(path)
      render()
    }
  })

  // Expand everything under cursor.
  box.key(['S-right','S-o'], function () {
    hideStatusBar()
    const [n, line] = getLine(program.y)
    program.showCursor()
    program.cursorPos(program.y, line.search(/\S/))
    const path = index.get(n)
    const subJson = reduce(json, 'this' + path)
    for (let p of dfs(subJson, path)) {
      if (expanded.size < 1000) {
        expanded.add(p)
      } else {
        break
      }
    }
    render()
  })

  box.key(['left', 'h'], function () {
    hideStatusBar()
    const [n, line] = getLine(program.y)
    program.showCursor()
    program.cursorPos(program.y, line.search(/\S/))

    // Find path at current cursor position.
    const path = index.get(n)

    if (expanded.has(path)) {
      // Collapse current path.
      expanded.delete(path)
      render()
    } else {
      // If there is no expanded paths on current line,
      // collapse parent path of current location.
      if (typeof path === 'string') {
        // Trip last part (".foo", "[0]") to get parent path.
        const parentPath = path.replace(/(\.[^\[\].]+|\[\d+\])$/, '')
        if (expanded.has(parentPath)) {
          expanded.delete(parentPath)
          render()

          // Find line number of parent path, and if we able to find it,
          // move cursor to this position of just collapsed parent path.
          for (let y = program.y; y >= 0; --y) {
            const [n, line] = getLine(y)
            if (index.get(n) === parentPath) {
              program.cursorPos(y, line.search(/\S/))
              break
            }
          }
        }
      }
    }
  })

  box.on('click', function (mouse) {
    hideStatusBar()
    const [n, line] = getLine(mouse.y)
    if (mouse.x >= stringWidth(line)) {
      return
    }

    program.hideCursor()
    program.cursorPos(mouse.y, line.search(/\S/))
    autocomplete.hide()

    const path = index.get(n)
    if (expanded.has(path)) {
      expanded.delete(path)
    } else {
      expanded.add(path)
    }
    render()
  })

  box.on('scroll', function () {
    hideStatusBar()
  })

  box.key('p', function () {
    printJson({expanded})
  })

  box.key('S-p', function () {
    printJson()
  })

  function printJson(options = {}) {
    screen.destroy()
    program.disableMouse()
    program.destroy()
    setTimeout(() => {
      const [text] = print(json, options)
      console.log(text)
      process.exit(0)
    }, 10)
  }

  function getLine(y) {
    const dy = box.childBase + y
    const n = box.getNumber(dy)
    const line = box.getScreenLine(dy)
    if (typeof line === 'undefined') {
      return [n, '']
    }
    return [n, line]
  }

  function apply(code) {
    if (code && code.length !== 0) {
      try {
        json = reduce(source, code)
      } catch (e) {
        // pass
      }
    } else {
      box.height = box_height
      input.hide()
      json = source
    }
    box.focus()
    program.cursorPos(0, 0)
    render()
  }

  function complete(inputCode) {
    const match = inputCode.match(/\.(\w*)$/)
    const code = /^\.\w*$/.test(inputCode) ? '.' : inputCode.replace(/\.\w*$/, '')

    let json
    try {
      json = reduce(source, code)
    } catch (e) {
    }

    if (match) {
      if (typeof json === 'object' && json.constructor === Object) {
        const keys = Object.keys(json)
          .filter(key => key.startsWith(match[1]))
          .slice(0, 1000) // With lots of items, list takes forever to render.

        // Hide if there is nothing to show or
        // don't show if there is complete match.
        if (keys.length === 0 || (keys.length === 1 && keys[0] === match[1])) {
          autocomplete.hide()
          return
        }

        autocomplete.width = Math.max(...keys.map(key => key.length)) + 1
        autocomplete.height = Math.min(7, keys.length)
        autocomplete.left = Math.min(
          screen.width - autocomplete.width,
          code.length === 1 ? 1 : code.length + 1
        )

        let selectFirst = autocomplete.items.length !== keys.length
        autocomplete.setItems(keys)

        if (selectFirst) {
          autocomplete.select(autocomplete.items.length - 1)
        }
        if (autocomplete.hidden) {
          autocomplete.show()
        }
      } else {
        autocomplete.clearItems()
        autocomplete.hide()
      }
    }
  }

  function update(code) {
    if (code && code.length !== 0) {
      try {
        const pretender = reduce(source, code)
        if (
          typeof pretender !== 'undefined'
          && typeof pretender !== 'function'
          && !(pretender instanceof RegExp)
        ) {
          json = pretender
        }
      } catch (e) {
        // pass
      }
    }
    if (code === '') {
      json = source
    }

    if (highlight) {
      findGen = find(json, highlight)
    }
    render()
  }

  function applyPattern(pattern) {
    let regex
    let m = pattern.match(/^\/(.*)\/([gimuy]*)$/)
    if (m) {
      try {
        regex = new RegExp(m[1], m[2])
      } catch (e) {
        showStatusBar('Invalid regexp')
      }
    } else {
      m = pattern.match(/^\/(.*)$/)
      if (m) {
        try {
          regex = new RegExp(m[1], 'gi')
        } catch (e) {
          showStatusBar('Invalid regexp')
        }
      }
    }
    highlight = regex

    search.hide()

    if (highlight) {
      findGen = find(json, highlight)
      findNext()
    } else {
      findGen = null
      currentPath = null
    }
    search.setValue('')

    box.height = box_height
    box.focus()

    program.cursorPos(0, 0)
    render()
  }

  function findNext() {
    if (!findGen) {
      return
    }

    const {value: path, done} = findGen.next()

    if (done) {
      showStatusBar('Pattern not found')
    } else {

      currentPath = ''
      for (let p of path) {
        expanded.add(currentPath += p)
      }
      render()

      for (let [k, v] of index) {
        if (v === currentPath) {
          let y = box.getScreenNumber(k)

          // Scroll one line up for better view and make sure it's not negative.
          if (--y < 0) {
            y = 0
          }

          box.scrollTo(y)
          render()
        }
      }

      // Set cursor to current path.
      // We need timeout here to give our terminal some time.
      // Without timeout first cursorPos call does not working,
      // it looks like an ugly hack and it is an ugly hack.
      setTimeout(() => {
        for (let [k, v] of index) {
          if (v === currentPath) {
            let y = box.getScreenNumber(k) - box.childBase
            if (y <= 0) {
              y = 0
            }
            const line = box.getScreenLine(y + box.childBase)
            program.cursorPos(y, line.search(/\S/))
            render()
          }
        }
      }, 100)
    }
  }

  function updateRuler() {
    const y = box.childBase + program.y
    const [n] = getLine(program.y)
    const path = index.get(n) || ''
    const scrollPercent = ((y / (box.getScrollHeight() - 1)) * 100).toFixed(0)
    const compressPath = p => {
      if(pathBar.strWidth(path) < pathBar.width) {
        return p
      } else {
        return '…' + p.substring(path.length - pathBar.width + 1)
      }
    }
    pathBar.show()
    pathBar.setContent(`${compressPath(path)}`)
    ruler.show()
    ruler.setContent(`${box.childBase + program.y}\t${scrollPercent}%`)
    screen.render()
  }

  function showStatusBar(status) {
    statusBar.show()
    statusBar.setContent(config.statusBar(` ${status} `))
    render()
  }

  function hideStatusBar() {
    if (!statusBar.hidden) {
      statusBar.hide()
      statusBar.setContent('')
      render()
    }
  }

  function render() {
    let content
    [content, index] = print(json, {expanded, highlight, currentPath})

    if (typeof content === 'undefined') {
      content = 'undefined'
    }

    box.setContent(content)
    config.useRuler && updateRuler() 
    screen.render()
  }

  function exit() {
    // If exit program immediately, stdin may still receive
    // mouse events which will be printed in stdout.
    program.disableMouse()
    setTimeout(() => process.exit(0), 10)
  }

  render()
}

function* bfs(json) {
  const queue = [[json, '']]

  while (queue.length > 0) {
    const [v, path] = queue.shift()

    if (!v) {
      continue
    }

    if (Array.isArray(v)) {
      yield path
      let i = 0
      for (let item of v) {
        const p = path + '[' + (i++) + ']'
        queue.push([item, p])
      }
    }

    if (typeof v === 'object' && v.constructor === Object) {
      yield path
      for (let [key, value] of Object.entries(v)) {
        const p = path + '.' + key
        queue.push([value, p])
      }
    }
  }
}

function* dfs(v, path = '') {
  if (!v) {
    return
  }

  if (Array.isArray(v)) {
    yield path
    let i = 0
    for (let item of v) {
      yield* dfs(item, path + '[' + (i++) + ']')
    }
  }

  if (typeof v === 'object' && v.constructor === Object) {
    yield path
    for (let [key, value] of Object.entries(v)) {
      yield* dfs(value, path + '.' + key)
    }
  }
}
