'use strict'

function* find(v, regex, path = []) {
  if (typeof v === 'undefined' || v === null) {
    return
  }

  if (Array.isArray(v)) {
    let i = 0
    for (let value of v) {
      const nextPath = path.slice()
      nextPath.push(i++)
      yield* find(value, regex, nextPath)
    }
    return
  }

  if (typeof v === 'object' && v.constructor === Object) {
    const entries = Object.entries(v)
    for (let [key, value] of entries) {
      const nextPath = path.slice()
      nextPath.push(key)

      if (regex.test(key)) {
        yield nextPath
      }

      yield* find(value, regex, nextPath)
    }
    return
  }

  if (regex.test(v)) {
    yield path
  }
}

module.exports = find
