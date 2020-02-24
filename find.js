'use strict'

function find(v, regex, startFromPath, reverse, path = []) {
  if (typeof v === 'undefined' || v === null) {
    return
  }

  function traverse(entries, startFrom, startFromPath) {
    if (reverse) {
      entries.reverse()
    }

    if (startFrom !== null) {
      while (entries[0][0] != startFrom) {
        entries.shift();
      }
    }

    for (let [key, value] of entries) {
      const nextPath = path.slice()
      nextPath.push(key)

      if (key != startFrom && typeof key == 'string' && regex.test(key)) {
        return nextPath
      }

      const result = find(value, regex, startFromPath, reverse, nextPath)
      if (key == startFrom) {
        startFromPath = null
      }
      if (result) {
        return result
      }
      // continue
    }
  }

  let from = null
  if (Array.isArray(startFromPath)) {
    if (startFromPath.length == 0) {
      // skipping this match, as we're standing on it
      return
    }
    startFromPath = startFromPath.slice()
    from = startFromPath.shift()
  } else {
    startFromPath = null
  }

  if (Array.isArray(v)) {
    const entries = v.map((val, ind) => [ind, val])
    const result = traverse(entries, from, startFromPath)
    if (result) {
      return result
    } else {
      return
    }
  }

  if (typeof v === 'object' && v.constructor === Object) {
    const entries = Object.entries(v)
    const result = traverse(entries, from, startFromPath)
    if (result) {
      return result
    } else {
      return
    }
  }

  if (startFromPath == null && regex.test(v)) {
    return path
  }
}

module.exports = find
