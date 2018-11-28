const path = require('path')

const packageJson = require(path.join(__dirname, '../../../package.json'))

let resourcesPath = path.resolve(`${__dirname}/../lib/resources`)
if (packageJson.sapui5RuntimeVersion) {
  resourcesPath = path.resolve(`${__dirname}/../lib/${packageJson.sapui5RuntimeVersion}/resources`)
}

module.exports = resourcesPath
