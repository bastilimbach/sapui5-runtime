const path = require('path')

const packageJson = require(path.join(__dirname, '../../../package.json'))

let resourcesPath = path.resolve(`${__dirname}/../lib/resources`)
if (packageJson.sapui5Runtime && 'version' in packageJson.sapui5Runtime) {
  resourcesPath = path.resolve(`${__dirname}/../lib/${packageJson.sapui5Runtime.version}/resources`)
}

module.exports = resourcesPath
