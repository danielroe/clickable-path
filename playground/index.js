import assert from 'node:assert'
import { createLinker, link, supportsHyperlinks } from 'clickable-path'

const { link: aliased } = createLinker({
  formatter: absolute => absolute.replace(import.meta.dirname, '~'),
})

// eslint-disable-next-line no-console
console.log('supported:', supportsHyperlinks())
// eslint-disable-next-line no-console
console.log('relative:', link('./package.json'))
// eslint-disable-next-line no-console
console.log('aliased:', aliased('./package.json'))
// eslint-disable-next-line no-console
console.log('with line:', link('./index.js', { line: 3, column: 1 }))

assert.strictEqual(link('./package.json', { enabled: false }), 'package.json')
