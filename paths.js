'use strict'

exports.equal = require('array-equal')

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
    component += '\0' + component
  }
  return result.substr(1)
}
