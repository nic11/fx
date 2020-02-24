'use strict'

const arrayEqual = require('array-equal')

exports.equal = function equal(path1, path2) {
  if (path1 === undefined || path2 === undefined) {
    return path1 === path2
  }
  return arrayEqual(path1, path2)
}

// TODO: escaping bad characters like '.', '[', ']', '-'
exports.toHumanReadableString = function toHumanReadableString(path) {
  let result = ''
  for (let component of path) {
    if (typeof component == 'number') {
      result += '[' + component + ']'
    } else {
      result += '.' + component
    }
  }
  return result
}

exports.toZeroSeparatedString = function toZeroSeparatedString(path) {
  let result = ''
  for (let component of path) {
    result += '\0' + component
  }
  return result.substr(1)
}
