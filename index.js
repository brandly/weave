'use strict'

const fs = require('fs')
const path = require('path')
const dependencyTree = require('./dependency-tree')

const preludePath = path.join(__dirname, 'prelude.js')
const prelude = fs.readFileSync(preludePath, 'utf8').toString().trim()

module.exports = weave

function weave (params) {
  const entry = params.entry
  const viewTree = params.viewTree

  const parsed = path.parse(path.resolve(entry))
  const dir = parsed.dir
  const value = './' + parsed.name

  dependencyTree.build({ raw: value, value, dir }, (error, tree) => {
    if (error) {
      console.trace(error)
      throw error
    } else {
      tree.entry = true

      if (viewTree) {
        dependencyTree.view(tree)
      } else {
        const allDependencies = flattenDependencyTree(tree)
        const moduleIds = allDependencies.map(dep => dep.id)

        const modules = formatModules(allDependencies)
        const conclusion = [modules, '{}', JSON.stringify(moduleIds)].join(',')
        const output = `(${prelude})(${conclusion})`

        console.log(output)
      }
    }
  })
}

function formatModules (dependencies) {
  return `{${dependencies.map(formatSingleModule).join(',')}}`
}

function formatSingleModule (dep) {
  return [
    JSON.stringify(dep.id),
    ':[',
    'function(require,module,exports){\n',
    dep.source,
    '\n},',
    '{' + Object.keys(dep.dependencies || {}).sort().map(function (key) {
      return JSON.stringify(key) + ':' + JSON.stringify(dep.dependencies[key])
    }).join(',') + '}',
    ']'
  ].join('')
}

function flattenDependencyTree (tree) {
  const store = {}
  flattenDependencyTreeHelper(tree, store)

  return Object.keys(store).map(absolute => {
    const current = store[absolute]

    const subDependencies = {}
    current.dependency.dependencies.map((dep) => {
      subDependencies[dep.value] = store[dep.absolute].id
    })

    const final = {
      id: current.id,
      dependencies: subDependencies,
      source: current.dependency.source
    }

    if (current.dependency.entry) {
      final.entry = true
    }

    return final
  })
}

function flattenDependencyTreeHelper (tree, store) {
  if (!store[tree.absolute]) {
    store[tree.absolute] = {
      id: getNextNumber(),
      dependency: tree
    }
    tree.dependencies.forEach((dep) => flattenDependencyTreeHelper(dep, store))
  }
}

let nextNumber = 0
function getNextNumber () {
  return nextNumber++
}
