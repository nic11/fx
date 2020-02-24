'use strict'
const indent = require('indent-string')
const config = require('./config')
const paths = require('./paths')

function format(value, style, highlightStyle, regexp, transform = x => x) {
  if (!regexp) {
    return style(transform(value))
  }
  const marked = value
    .replace(regexp, s => '<highlight>' + s + '<highlight>')

  return transform(marked)
    .split(/<highlight>/g)
    .map((s, i) => i % 2 !== 0 ? highlightStyle(s) : style(s))
    .join('')
}

function print(input, options = {}) {
  const {expanded, highlight, currentPath} = options
  const index = new Map()
  let row = 0

  function doPrint(v, path = []) {
    index.set(row, path)

    // Code for highlighting parts become cumbersome.
    // Maybe we should refactor this part.
    const highlightStyle = (path) => paths.equal(currentPath, path) ? config.highlightCurrent : config.highlight
    const formatStyle = (v, style) => format(v, style, highlightStyle(path), highlight)
    const formatText = (v, style, path) => {
      return format(v, style, highlightStyle(path), highlight, JSON.stringify)
    }

    const eol = () => {
      row++
      return '\n'
    }

    if (typeof v === 'undefined') {
      return void 0
    }

    if (v === null) {
      return formatStyle(JSON.stringify(v), config.null)
    }

    if (typeof v === 'number' && Number.isFinite(v)) {
      return formatStyle(JSON.stringify(v), config.number)
    }

    if (typeof v === 'object' && v.isLosslessNumber) {
      return formatStyle(v.toString(), config.number)
    }

    if (typeof v === 'boolean') {
      return formatStyle(JSON.stringify(v), config.boolean)

    }

    if (typeof v === 'string') {
      return formatText(v, config.string, path)
    }

    if (Array.isArray(v)) {
      let output = config.bracket('[')
      const len = v.length

      if (len > 0) {
        if (expanded && !expanded.has(paths.toZeroSeparatedString(path))) {
          output += '\u2026'
        } else {
          output += eol()
          let i = 0
          for (let item of v) {
            const value = typeof item === 'undefined' ? null : item // JSON.stringify compatibility
            const newPath = path.slice()
            newPath.push(i)
            output += indent(doPrint(value, newPath), config.space)
            output += i++ < len - 1 ? config.comma(',') : ''
            output += eol()
          }
        }
      }

      return output + config.bracket(']')
    }

    if (typeof v === 'object' && v.constructor === Object) {
      let output = config.bracket('{')

      const entries = Object.entries(v).filter(([key, value]) => typeof value !== 'undefined') // JSON.stringify compatibility
      const len = entries.length

      if (len > 0) {
        if (expanded && !expanded.has(paths.toZeroSeparatedString(path))) {
          output += '\u2026'
        } else {
          output += eol()
          let i = 0
          for (let [key, value] of entries) {
            const newPath = path.slice()
            newPath.push(key)
            const part = formatText(key, config.key, newPath) + config.colon(':') + ' ' + doPrint(value, newPath)
            output += indent(part, config.space)
            output += i++ < len - 1 ? config.comma(',') : ''
            output += eol()
          }
        }
      }

      return output + config.bracket('}')
    }

    return JSON.stringify(v, null, config.space)
  }

  return [doPrint(input), index]
}

module.exports = print
