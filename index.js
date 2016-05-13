'use strict'

const fs = require('fs')
const path = require('path')
const parser = require('esprima')
const _ = require('lodash')
const async = require('async')
const coreModulesNames = require('node-core-module-names')
const debug = require('debug')('weave')
const findAllRequireStatements = require('./find-all-require-statements')

const entry = process.argv[2]

weave(entry)

function weave (entry) {
  // TODO: figure out how to handle initial `dir`
  const dir = path.resolve(getParentDir(entry))
  const value = './' + _.last(entry.split('/'))

  buildDependencyTree({ value, dir }, (error, results) => {
    if (error) {
      console.trace(error)
      throw error
    } else {
      console.log('dependency tree!')
      viewDependencyTree(results)
    }
  })
}

function viewDependencyTree (tree, padding) {
  padding || (padding = '')

  padding ? console.log(padding, tree.absolute) : console.log(tree.absolute)

  const childrenPadding = padding + '-'
  tree.dependencies.forEach(dep => viewDependencyTree(dep, childrenPadding))
}

// TODO: actually implement the spec
// https://nodejs.org/api/modules.html#modules_all_together
function buildDependencyTree (requirement, callback) {
  debug('buildDependencyTree', requirement)

  const value = requirement.value
  const dir = requirement.dir

  if (value.endsWith('.json')) {
    console.warn('Cannot handle json yet', value)
    callback(null, { absolute: value, dependencies: [] })
    return
  }

  if (_.includes(coreModulesNames, value)) {
    // TODO: handle built-in-to-node packages (core modules) like `path` and such
    console.warn('Cannot handle core modules yet:', value)
    callback(null, { absolute: value, dependencies: [] })
    return
  }

  if (value.startsWith('./') || value.startsWith('/') || value.startsWith('../')) {
    loadAsFile(requirement, (error, tree) => {
      if (doesNotExistError(error)) {
        debug('file does not exist', requirement)
        loadAsDirectory(requirement, callback)
      } else if (error) {
        callback(error)
      } else {
        callback(null, tree)
      }
    })
    return
  } else {
    debug('node_module!', value)

    findNodeModulesPath(dir, (error, nodeModulesDir) => {
      if (error) {
        callback(error)
      } else {
        loadAsDirectory(Object.assign({}, requirement, {
          dir: nodeModulesDir
        }), callback)
      }
    })
    return
  }
}

function addDependenciesToFile (params, callback) {
  const source = params.source
  const syntax = params.syntax
  const value = params.value
  const dir = params.dir

  debug('addDependenciesToFile', { value, dir })

  const requiresList = findAllRequireStatements(syntax).map(value => { return { value, dir } })
  debug('requiresList', JSON.stringify(requiresList))

  async.map(requiresList, buildDependencyTree, (error, dependencies) => {
    if (error) {
      callback(error)
    } else {
      const result = {
        absolute: path.resolve(dir, value),
        source,
        syntax,
        dependencies
      }

      callback(null, result)
    }
  })
}

function loadAsFile (requirement, callback) {
  debug('loadAsFile', requirement)

  const value = requirement.value
  const dir = requirement.dir

  const fullPath = path.resolve(dir, value)
  debug('fullPath', fullPath)

  fs.readFile(fullPath, (error, results) => {
    if (doesNotExistError(error) && !value.endsWith('.js')) {
      const withExtension = value + '.js'
      loadAsFile(Object.assign({}, requirement, { value: withExtension }), callback)
    } else if (illegalOperationOnDirectoryError(error)) {
      loadAsDirectory(requirement, callback)
    } else if (error) {
      callback(error)
    } else {
      const source = results.toString()
      const syntax = parser.parse(source)

      // TODO: figure out how to call this
      addDependenciesToFile({ source, syntax, value, dir }, callback)
    }
  })
}

function loadAsDirectory (requirement, callback) {
  debug('loadAsDirectory', requirement)

  const value = requirement.value
  const dir = requirement.dir

  const pkgPath = path.resolve(dir, value, 'package.json')

  fs.open(pkgPath, 'r', (error) => {
    if (doesNotExistError(error)) {
      loadAsFile({
        value: 'index.js',
        dir: path.join(dir, value)
      }, callback)
    } else if (error) {
      callback(error)
    } else {
      // TODO: should i _not_ use require?
      const pkg = require(pkgPath)
      const newDir = path.join(dir, value)
      let newValue = pkg.main || 'index.js'

      if (!newValue.startsWith('./')) {
        newValue = './' + newValue
      }

      buildDependencyTree({ dir: newDir, value: newValue }, callback)
    }
  })
}

function findNodeModulesPath (dir, callback) {
  debug('findNodeModulesPath', dir)

  const attempt = path.resolve(dir, 'node_modules')

  fs.open(attempt, 'r', function (error, fd) {
    if (doesNotExistError(error)) {
      return findNodeModulesPath(getParentDir(dir), callback)
    } else if (error) {
      callback(error)
    } else {
      callback(null, attempt)
    }
  })
}

function doesNotExistError (error) {
  return error && error.code === 'ENOENT'
}

function illegalOperationOnDirectoryError (error) {
  return error && error.code === 'EISDIR'
}

function getParentDir (dir) {
  const splits = dir.split('/')
  const dirs = splits.slice(0, splits.length - 1)
  const result = dirs.join('/')

  debug('getParentDir', dir, result)
  return result
}
